/**
 * scripts/probe-cycles.ts — follow-up probe
 * ---------------------------------------------------------------------------
 * `npm run probe` reported four design-critical failures. This script tests
 * whether they are actually ONE failure with a single root cause, and whether
 * a workaround exists.
 *
 * HYPOTHESIS
 *   CognoDB applies NODE uniqueness to variable-length patterns: a matched
 *   path may never revisit a node. Neo4j applies RELATIONSHIP uniqueness: a
 *   path may revisit a node, it just may not reuse an edge.
 *
 * IF TRUE
 *   `(a)-[:R*3..3]->(a)` can never match, because it requires arriving back
 *   at `a` -- a revisited node, by definition. Cycle detection as written is
 *   not merely unsupported, it is unexpressible in that form. The reduce()
 *   and all() failures are collateral: both probes matched on that same
 *   cycle, so they returned no rows and never exercised the function at all.
 *
 * THE PROPOSED WORKAROUND
 *   Decompose the cycle. A variable-length path a -> ... -> b never revisits
 *   a node, so it is legal; then match the closing edge b -> a as a SEPARATE
 *   pattern. Together they describe exactly the same cycle, and the engine is
 *   never asked to revisit a node inside one variable-length segment.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/probe-cycles.ts
 */

import neo4j from 'neo4j-driver'

const URI = process.env.COGNODB_URI
const PASSWORD = process.env.COGNODB_PASSWORD
if (!URI || !PASSWORD) {
  console.error('\n  Missing credentials. cp .env.example .env.local and fill it in.\n')
  process.exit(1)
}

const driver = neo4j.driver(
  URI,
  neo4j.auth.basic(process.env.COGNODB_USER ?? 'cognodb', PASSWORD),
  { disableLosslessIntegers: true },
)

/* Same triangle as the main probe: a -> b -> c -> a, plus a chord a -> c.
 * Leg amounts 10 + 20 + 30 = 60 around the cycle. */
const FIXTURE = `
  CREATE (a:ProbeX {v: 'probe-a'})
  CREATE (b:ProbeX {v: 'probe-b'})
  CREATE (c:ProbeX {v: 'probe-c'})
  CREATE (a)-[:PROBE_REL {amount: 10.0}]->(b)
  CREATE (b)-[:PROBE_REL {amount: 20.0}]->(c)
  CREATE (c)-[:PROBE_REL {amount: 30.0}]->(a)
  CREATE (a)-[:OTHER_REL {amount: 99.0}]->(c)
`

type T = { group: string; name: string; cypher: string; params?: Record<string, unknown>; note: string }

const TESTS: T[] = [
  // -- Are reduce() and all() actually broken, or were they just starved? ----
  {
    group: 'A. Functions in isolation (no cycle involved)',
    name: 'reduce() on a literal list',
    cypher: 'RETURN reduce(s = 0, x IN [1,2,3] | s + x) AS total',
    note: 'expect total=6. If this passes, reduce() was never the problem.',
  },
  {
    group: 'A. Functions in isolation (no cycle involved)',
    name: 'all() on a literal list',
    cypher: 'RETURN all(x IN [1,2,3] WHERE x > 0) AS ok',
    note: 'expect ok=true.',
  },
  {
    group: 'A. Functions in isolation (no cycle involved)',
    name: 'reduce() over relationships(p)',
    cypher:
      "MATCH p = (a:ProbeX {v:'probe-a'})-[:PROBE_REL*2..2]->(b) RETURN reduce(s = 0.0, r IN relationships(p) | s + r.amount) AS total",
    note: 'expect total=30 (10+20). Proves reduce works on a real path.',
  },

  // -- Which uniqueness rule does the engine use? ---------------------------
  {
    group: 'B. Path semantics — node uniqueness vs relationship uniqueness',
    name: '*3..3 from probe-a',
    cypher:
      "MATCH p = (a:ProbeX {v:'probe-a'})-[:PROBE_REL*3..3]->(b) RETURN count(p) AS n",
    note: 'The only 3-hop route is a->b->c->a. n=0 means node uniqueness. n=1 means relationship uniqueness.',
  },
  {
    group: 'B. Path semantics — node uniqueness vs relationship uniqueness',
    name: 'enumerate *1..3 paths',
    cypher:
      "MATCH p = (a:ProbeX {v:'probe-a'})-[:PROBE_REL*1..3]->(b) RETURN collect([x IN nodes(p) | x.v]) AS routes",
    note: 'Shows exactly which routes the engine will and will not walk.',
  },

  // -- Can we express a cycle some other way? -------------------------------
  {
    group: 'C. Cycle detection — alternative formulations',
    name: 'explicit 3-leg cycle, distinct vars',
    cypher:
      'MATCH (a:ProbeX)-[r1:PROBE_REL]->(b:ProbeX)-[r2:PROBE_REL]->(c:ProbeX)-[r3:PROBE_REL]->(a) RETURN count(*) AS n',
    note: 'expect n=3 (same triangle, once per starting rotation). No variable-length segment at all.',
  },
  {
    group: 'C. Cycle detection — alternative formulations',
    name: 'explicit 3-leg + amounts',
    cypher:
      'MATCH (a:ProbeX)-[r1:PROBE_REL]->(b:ProbeX)-[r2:PROBE_REL]->(c:ProbeX)-[r3:PROBE_REL]->(a) WHERE all(r IN [r1,r2,r3] WHERE r.amount <= 100) RETURN [a.v,b.v,c.v] AS accts, r1.amount+r2.amount+r3.amount AS total LIMIT 1',
    note: 'expect total=60. Confirms all() and arithmetic work on an explicit cycle.',
  },
  {
    group: 'C. Cycle detection — alternative formulations',
    name: 'DECOMPOSED: var-length path + closing edge',
    cypher:
      'MATCH p = (a:ProbeX)-[t:PROBE_REL*2..4]->(b:ProbeX) MATCH (b)-[closing:PROBE_REL]->(a) RETURN count(*) AS n',
    note: 'THE CANDIDATE FIX. The var-length segment a->..->b never revisits a node; the closing edge is matched separately.',
  },
  {
    group: 'C. Cycle detection — alternative formulations',
    name: 'DECOMPOSED: full result shape',
    cypher: `
      MATCH p = (a:ProbeX)-[t:PROBE_REL*2..4]->(b:ProbeX)
      MATCH (b)-[closing:PROBE_REL]->(a)
      WHERE all(r IN t WHERE r.amount <= $maxLeg) AND closing.amount <= $maxLeg
      RETURN [n IN nodes(p) | n.v]                                   AS accounts,
             size(t) + 1                                             AS legs,
             reduce(s = 0.0, r IN t | s + r.amount) + closing.amount AS totalMoved
      ORDER BY legs DESC LIMIT 5`,
    params: { maxLeg: 100 },
    note: 'expect legs=3, totalMoved=60. This is the exact shape Q4 needs.',
  },
  {
    group: 'C. Cycle detection — alternative formulations',
    name: 'DECOMPOSED via pattern predicate',
    cypher:
      'MATCH p = (a:ProbeX)-[t:PROBE_REL*2..4]->(b:ProbeX) WHERE (b)-[:PROBE_REL]->(a) RETURN count(*) AS n',
    note: 'Cheaper variant if we do not need the closing edge properties.',
  },

  // -- The unexpected pass: dynamic relationship types ----------------------
  {
    group: 'D. Relationship type as a parameter',
    name: 'CREATE with $relType',
    cypher:
      "MATCH (a:ProbeX {v:'probe-a'}), (b:ProbeX {v:'probe-b'}) CREATE (a)-[r:$relType]->(b) RETURN type(r) AS t",
    params: { relType: 'DYNAMIC_TYPE' },
    note: 'The main probe said this SUCCEEDS. Does it create the RIGHT type, or a literal named $relType?',
  },
  {
    group: 'D. Relationship type as a parameter',
    name: 'MERGE with $relType',
    cypher:
      "MATCH (a:ProbeX {v:'probe-a'}), (b:ProbeX {v:'probe-c'}) MERGE (a)-[r:$relType]->(b) RETURN type(r) AS t",
    params: { relType: 'MERGED_TYPE' },
    note: 'MERGE is what the seed script actually uses.',
  },
  {
    group: 'D. Relationship type as a parameter',
    name: 'MATCH with $relType',
    cypher: 'MATCH (a:ProbeX)-[r:$relType]->(b) RETURN count(r) AS n',
    params: { relType: 'PROBE_REL' },
    note: 'If reads work too, ZERO interpolation is needed anywhere.',
  },
  {
    group: 'D. Relationship type as a parameter',
    name: 'var-length with $relType',
    cypher: 'MATCH p = (a:ProbeX)-[:$relType*1..2]->(b) RETURN count(p) AS n',
    params: { relType: 'PROBE_REL' },
    note: 'Probably fails — variable-length is a different parser path.',
  },
  {
    group: 'D. Relationship type as a parameter',
    name: 'node label as $param',
    cypher: 'MATCH (n:$label) RETURN count(n) AS n',
    params: { label: 'ProbeX' },
    note: 'Same question for labels.',
  },

  // -- Confirm the queries that survived ------------------------------------
  {
    group: 'E. Confirming what still works',
    name: 'shortestPath, multi-type, bounded',
    cypher:
      "MATCH (a:ProbeX {v:'probe-a'}), (b:ProbeX {v:'probe-b'}) MATCH p = shortestPath((a)-[:PROBE_REL|OTHER_REL*..6]-(b)) RETURN length(p) AS len, [n IN nodes(p) | n.v] AS chain",
    note: 'Q3 headline query, in its real multi-type form.',
  },
  {
    group: 'E. Confirming what still works',
    name: 'degree filter with COUNT {}',
    cypher: 'MATCH (n:ProbeX) WHERE COUNT { (n)--() } >= 3 RETURN count(n) AS n',
    note: 'Super-node exclusion. Needs to work on a bound variable.',
  },
]

async function main() {
  const setup = driver.session()
  try {
    await setup.run('MATCH (n:ProbeX) DETACH DELETE n')
    await setup.run(FIXTURE)
  } finally {
    await setup.close()
  }

  let group = ''
  for (const t of TESTS) {
    if (t.group !== group) {
      group = t.group
      console.log(`\n  ${group}\n  ${'-'.repeat(76)}`)
    }
    const s = driver.session()
    try {
      const res = await s.run(t.cypher, t.params ?? {})
      const rows = res.records.map((r) => r.toObject())
      const out =
        rows.length === 0
          ? '(no rows)'
          : JSON.stringify(rows.length === 1 ? rows[0] : rows).slice(0, 150)
      console.log(`   ok    ${t.name.padEnd(34)} ${out}`)
      console.log(`         ${' '.repeat(34)} ${t.note}`)
    } catch (e) {
      console.log(`   FAIL  ${t.name.padEnd(34)} ${(e as Error).message.split('\n')[0].slice(0, 100)}`)
      console.log(`         ${' '.repeat(34)} ${t.note}`)
    } finally {
      await s.close()
    }
  }

  const cleanup = driver.session()
  try {
    await cleanup.run('MATCH (n:ProbeX) DETACH DELETE n')
  } finally {
    await cleanup.close()
  }
  await driver.close()
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
