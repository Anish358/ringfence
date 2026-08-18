/**
 * scripts/probe.ts — CognoDB feature probe
 * ---------------------------------------------------------------------------
 * Run this BEFORE designing anything that depends on Cypher features.
 *
 * CognoDB implements openCypher over Bolt, not Neo4j's full proprietary
 * surface. Several features this application's design leans on — variable
 * length paths with multiple relationship types, shortestPath, cycle patterns,
 * COUNT {} subqueries — cannot be confirmed from the documentation alone.
 * Guessing wrong is only discovered once a screen is built on top of a query
 * that does not parse, which is the expensive way to find out.
 *
 * The probe answers three questions:
 *   1. Can we connect at all, and what server are we actually talking to?
 *   2. Which Cypher constructs parse and execute?
 *   3. For the traversal constructs, do they return the RIGHT ANSWER — not
 *      merely parse — against a known 3-node graph with a known 3-cycle?
 *
 * Question 3 is why this probe seeds a tiny fixture graph first. A traversal
 * probe run against an empty database returns 0 rows and reports PASS whether
 * the feature works or silently matches nothing.
 *
 * Output: a console table, plus docs/probe-results.json and
 * docs/cognodb-probe.md (pasteable straight into the README).
 *
 *   npm run probe
 */

import neo4j, { Driver, Session } from 'neo4j-driver'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Environment
//
// Read directly from process.env rather than through src/lib/env.ts. The probe
// must be runnable before the application's env module exists, and it needs to
// fail with its own instructions rather than the app's.
// ---------------------------------------------------------------------------

const URI = process.env.COGNODB_URI
const USER = process.env.COGNODB_USER ?? 'cognodb'
const PASSWORD = process.env.COGNODB_PASSWORD

if (!URI || !PASSWORD) {
  console.error(
    '\n  Missing CognoDB credentials.\n\n' +
      '    cp .env.example .env.local\n' +
      '    # then fill in COGNODB_URI and COGNODB_PASSWORD\n\n' +
      '  Values come from the instance detail page at console.cognodb.com.\n',
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Probe definitions
// ---------------------------------------------------------------------------

type Probe = {
  /** Short name shown in the results table. */
  name: string
  /** The Cypher to execute. One statement only. */
  cypher: string
  /** Parameters, if the statement takes any. */
  params?: Record<string, unknown>
  /** Why this build cares. Printed beside failures so the impact is obvious. */
  why: string
  /**
   * A failure here forces a design change before any application code is
   * written. Non-critical failures are nice-to-know.
   */
  critical?: boolean
  /**
   * Optional correctness assertion on the returned rows. Returning a string
   * turns a parse-level PASS into a WRONG — the feature exists but does not
   * behave as the design assumes. Return null when satisfied.
   */
  check?: (rows: Record<string, unknown>[]) => string | null
  /**
   * Some probes exist to CONFIRM a limitation. Marking one `expectFailure`
   * inverts the reporting so an error reads as the expected outcome.
   */
  expectFailure?: boolean
}

type Group = { title: string; probes: Probe[] }

/** Assert a single scalar in the first row. */
const expectScalar =
  (key: string, want: unknown) =>
  (rows: Record<string, unknown>[]): string | null => {
    if (rows.length === 0) return 'no rows returned'
    const got = rows[0][key]
    return got === want ? null : `expected ${key}=${String(want)}, got ${String(got)}`
  }

/** Assert a numeric column in the first row is at least `min`. */
const expectAtLeast =
  (key: string, min: number) =>
  (rows: Record<string, unknown>[]): string | null => {
    if (rows.length === 0) return 'no rows returned'
    const got = Number(rows[0][key])
    return got >= min ? null : `expected ${key} >= ${min}, got ${got}`
  }

const GROUPS: Group[] = [
  {
    title: 'Connectivity',
    probes: [
      {
        name: 'connect',
        cypher: 'RETURN 1 AS ok',
        why: 'Liveness. Also backs the /api/health endpoint.',
        critical: true,
        check: expectScalar('ok', 1),
      },
      {
        name: 'dbms.components()',
        cypher: 'CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition',
        why: 'Identifies the engine and version behind CognoDB. Informational.',
      },
    ],
  },

  {
    title: 'Schema — constraints and indexes',
    probes: [
      {
        name: 'CONSTRAINT … REQUIRE',
        cypher:
          'CREATE CONSTRAINT probe_req IF NOT EXISTS FOR (n:ProbeX) REQUIRE n.v IS UNIQUE',
        why: 'Neo4j 5 constraint syntax. The seed script needs one of REQUIRE/ASSERT.',
        critical: true,
      },
      {
        name: 'CONSTRAINT … ASSERT',
        cypher:
          'CREATE CONSTRAINT probe_assert IF NOT EXISTS FOR (n:ProbeY) ASSERT n.v IS UNIQUE',
        why: 'Legacy Neo4j 4 syntax. The fallback if REQUIRE is rejected.',
      },
      {
        name: 'CREATE INDEX',
        cypher: 'CREATE INDEX probe_idx IF NOT EXISTS FOR (n:ProbeX) ON (n.n)',
        why: 'MERGE without a backing index does a full label scan. On 0.5 vCPU that is fatal.',
        critical: true,
      },
      {
        name: 'SHOW CONSTRAINTS',
        cypher: 'SHOW CONSTRAINTS YIELD name RETURN count(name) AS constraints',
        why: 'Lets the seed script verify its own schema step instead of assuming it worked.',
      },
    ],
  },

  {
    title: 'Write primitives — what the seed script needs',
    probes: [
      {
        name: 'UNWIND $rows batch',
        cypher: 'UNWIND $rows AS r CREATE (:ProbeTmp {v: r.v, n: r.n}) RETURN count(*) AS created',
        params: { rows: [{ v: 'u1', n: 1 }, { v: 'u2', n: 2 }] },
        why: 'The only sane way to bulk load. One write per row would take hours.',
        critical: true,
        check: expectScalar('created', 2),
      },
      {
        name: 'SET n += $map',
        cypher: 'MATCH (n:ProbeTmp {v: "u1"}) SET n += $props RETURN n.extra AS extra',
        params: { props: { extra: 'set-from-map' } },
        why: 'Lets the loader push a whole property bag per row instead of naming each field.',
        critical: true,
        check: expectScalar('extra', 'set-from-map'),
      },
      {
        name: 'MERGE + ON CREATE / ON MATCH',
        cypher:
          'MERGE (n:ProbeTmp {v: "u1"}) ON CREATE SET n.created = true ON MATCH SET n.matched = true RETURN n.matched AS matched',
        why: 'Get-or-create is what makes the seed script idempotent and re-runnable.',
        critical: true,
        check: expectScalar('matched', true),
      },
      {
        name: 'multi-label CREATE',
        cypher: 'CREATE (n:ProbeTmp:ProbeShared {v: "multi"}) RETURN size(labels(n)) AS labelCount',
        why: 'Identifier nodes carry two labels, e.g. :Device:Identifier. Decision 4 of the model.',
        critical: true,
        check: expectScalar('labelCount', 2),
      },
      {
        name: 'SET n:Label (add label)',
        cypher: 'MATCH (n:ProbeTmp {v: "u2"}) SET n:ProbeShared RETURN size(labels(n)) AS labelCount',
        why: 'Alternative to a per-kind loader pass when adding :Identifier after MERGE.',
        check: expectScalar('labelCount', 2),
      },
      {
        // CognoDB accepts a parameterised relationship type where Neo4j 5 does
        // not, and CREATE honours it correctly.
        name: 'CREATE with $relType',
        cypher: 'MATCH (a:ProbeTmp {v:"u1"}), (b:ProbeTmp {v:"u2"}) CREATE (a)-[r:$relType]->(b) RETURN type(r) AS t',
        params: { relType: 'PROBE_DYNAMIC' },
        why: 'If honoured, reads need no interpolated relationship types at all.',
        check: expectScalar('t', 'PROBE_DYNAMIC'),
      },
      {
        // ...but MERGE does NOT. It ignores the parameterised type when
        // deciding whether a relationship already exists, so it will happily
        // return a relationship of a COMPLETELY DIFFERENT type instead of
        // creating the one you asked for. Silent data corruption in a loader.
        //
        // Hence: the seed script MERGEs with a literal type interpolated from
        // LINK_TYPES (a compile-time `as const`), and only reads parameterise.
        name: 'MERGE with $relType (hazard)',
        cypher: 'MATCH (a:ProbeTmp {v:"u1"}), (b:ProbeTmp {v:"u2"}) MERGE (a)-[r:$relType]->(b) RETURN type(r) AS t',
        params: { relType: 'PROBE_MERGED' },
        // Not flagged critical: the design already accounts for it. A WRONG
        // here is the finding, not an outstanding problem.
        why: 'Expect WRONG. MERGE matches an existing relationship of another type instead of creating this one. The seed script therefore uses literal types.',
        check: expectScalar('t', 'PROBE_MERGED'),
      },
    ],
  },

  {
    title: 'Traversal — the design-critical group',
    probes: [
      {
        name: 'var-length *1..3',
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL*1..3]->(b:ProbeX) RETURN count(p) AS paths',
        why: 'The multi-hop requirement in the brief. Everything on the Investigation Canvas needs it.',
        critical: true,
        // Two, not three: a->b and a->b->c. The third route a->b->c->a is
        // rejected because it revisits a -- see the simple-path probe below.
        check: expectScalar('paths', 2),
      },
      {
        name: 'var-length, multi-type',
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL|OTHER_REL*1..3]-(b:ProbeX) RETURN count(p) AS paths',
        why: 'A ring mixes device / address / bank / IP hops in ONE pattern. Without type disjunction the whole model falls apart.',
        critical: true,
        check: expectAtLeast('paths', 3),
      },
      {
        name: 'undirected var-length',
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL*2..2]-(b:ProbeX) RETURN count(p) AS paths',
        why: 'Account -> identifier <- Account is traversed against edge direction on the second leg.',
        critical: true,
        check: expectAtLeast('paths', 1),
      },
      {
        name: 'shortestPath()',
        cypher:
          'MATCH (a:ProbeX {v:"probe-a"}), (b:ProbeX {v:"probe-c"}) MATCH p = shortestPath((a)-[:PROBE_REL*..6]-(b)) RETURN length(p) AS len',
        why: 'Q3, the headline "awkward for SQL" query. A fallback exists if this is missing.',
        critical: true,
        check: expectScalar('len', 1),
      },
      {
        name: 'allShortestPaths()',
        cypher:
          'MATCH (a:ProbeX {v:"probe-a"}), (b:ProbeX {v:"probe-c"}) MATCH p = allShortestPaths((a)-[*..4]-(b)) RETURN count(p) AS paths',
        why: 'Nice-to-have for Path Finder when several equally short routes exist.',
      },
      {
        // THE most consequential finding of this probe.
        //
        // Neo4j applies RELATIONSHIP uniqueness to variable-length patterns: a
        // path may revisit a node, it just may not reuse an edge. CognoDB
        // applies NODE uniqueness -- a matched path may never revisit a node.
        //
        // A closed walk (a)-[*3]->(a) requires arriving back at `a`, which IS a
        // revisited node. So it can never match here. Not a bug, a semantic
        // difference, and asserting 0 documents it rather than hiding it.
        name: 'closed walk (expect 0)',
        cypher: 'MATCH c = (a:ProbeX)-[:PROBE_REL*3..3]->(a) RETURN count(c) AS cycles',
        why: 'Confirms simple-path semantics. Q4 cannot use this form and uses the decomposed one below.',
        check: expectScalar('cycles', 0),
      },
      {
        // The workaround, and the shape Q4 actually ships.
        //
        // Split the cycle in two. The variable-length segment a -> ... -> b is
        // acyclic, so it satisfies node uniqueness; the closing edge b -> a is
        // matched as a SEPARATE pattern, where the rule does not apply. The two
        // together describe exactly the cycle we wanted.
        name: 'cycle, decomposed',
        cypher:
          'MATCH p = (a:ProbeX)-[:PROBE_REL*2..4]->(b:ProbeX) MATCH (b)-[closing:PROBE_REL]->(a) RETURN count(*) AS cycles',
        why: 'Q4, circular money movement. The "no clean SQL equivalent" claim rests on this.',
        critical: true,
        check: expectAtLeast('cycles', 1),
      },
      {
        // The one that removes interpolation from every read query: a LIST of
        // relationship types, passed as a parameter, filtering correctly.
        name: 'type disjunction as $param',
        cypher: 'MATCH p = (a:ProbeX)-[:$types*1..2]->(b) RETURN count(p) AS paths',
        params: { types: ['PROBE_REL', 'OTHER_REL'] },
        why: 'Lets LINK_TYPES travel as $linkTypes instead of being interpolated into read queries.',
        critical: true,
        check: expectAtLeast('paths', 7),
      },
      {
        name: 'depth as $param (expect fail)',
        cypher: 'MATCH p = (a:ProbeX)-[:PROBE_REL*1..$depth]-(b) RETURN count(p) AS paths',
        params: { depth: 3 },
        why: 'Expected to FAIL. Confirms why depth uses a frozen map of pre-built queries, not concatenation.',
        expectFailure: true,
      },
    ],
  },

  {
    title: 'Functions and clauses the queries use',
    probes: [
      {
        name: 'list comprehension over path',
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL*1..2]->(b) RETURN [n IN nodes(p) | n.v] AS chain LIMIT 1',
        why: 'How Q3 turns a path into the evidence chain the analyst reads.',
        critical: true,
      },
      {
        name: 'label filter comprehension',
        cypher:
          "MATCH (n:ProbeX) RETURN [l IN labels(n) WHERE l <> 'ProbeShared'][0] AS specific LIMIT 1",
        why: 'Recovers the specific identifier kind (:Device) from a node also labelled :Identifier.',
        critical: true,
      },
      {
        name: 'reduce() over a path',
        // Note relationships(p), NOT the `t` in -[t:REL*2..2]->. On CognoDB
        // that variable binds to a Path, not a list of relationships, so
        // passing it to all()/reduce() raises "requires list, got Path".
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL*2..2]->(b) RETURN reduce(s = 0.0, r IN relationships(p) | s + r.amount) AS total',
        why: 'Sums the money moved around a transfer cycle.',
        critical: true,
        check: expectScalar('total', 30),
      },
      {
        name: 'all() predicate over rels',
        cypher:
          'MATCH p = (a:ProbeX)-[:PROBE_REL*2..2]->(b) WHERE all(r IN relationships(p) WHERE r.amount <= 100) RETURN count(p) AS paths',
        why: '"Every leg is small" — the filter that separates a fraud loop from ordinary payments.',
        critical: true,
        check: expectAtLeast('paths', 1),
      },
      {
        name: 'pattern predicate in WHERE',
        cypher: 'MATCH (a:ProbeX) WHERE (a)-[:PROBE_REL]->() RETURN count(a) AS n',
        why: 'Modern replacement for the deprecated exists(). Used to test "is this account flagged".',
        critical: true,
        check: expectAtLeast('n', 1),
      },
      {
        name: 'COUNT {} subquery',
        cypher:
          'MATCH (a:ProbeX) WHERE COUNT { (a)--() } > 1 RETURN count(a) AS n',
        why: 'Degree filter. This is how we exclude super-nodes (a college IP with 40 accounts) from traversals.',
        critical: true,
        check: expectAtLeast('n', 1),
      },
      {
        name: 'CALL {} subquery',
        cypher: 'CALL { MATCH (n:ProbeX) RETURN count(n) AS c } RETURN c',
        why: 'Would let ring scoring run in one round trip instead of several.',
      },
      {
        name: 'EXISTS {} subquery',
        cypher: 'MATCH (a:ProbeX) WHERE EXISTS { (a)-[:PROBE_REL]->() } RETURN count(a) AS n',
        why: 'More expressive alternative to the pattern predicate above.',
      },
      {
        name: 'head(collect()) ordering',
        cypher:
          'MATCH p = (a:ProbeX {v:"probe-a"})-[:PROBE_REL*1..3]->(b:ProbeX) WITH b, p ORDER BY length(p) ASC WITH b, head(collect(p)) AS best RETURN count(best) AS n',
        why: 'The shortestPath fallback. Keeps the shortest PATH, which min(length(p)) would throw away.',
        critical: true,
        check: expectAtLeast('n', 1),
      },
      {
        name: 'collect(DISTINCT …)',
        cypher: 'MATCH (n:ProbeX) RETURN collect(DISTINCT n.v) AS vs',
        why: 'Rolls the shared identifier values for a pair into one row in Q1.',
        critical: true,
      },
      {
        name: 'startNode / endNode / type',
        cypher:
          'MATCH ()-[r:PROBE_REL]->() RETURN startNode(r).v AS s, endNode(r).v AS e, type(r) AS t LIMIT 1',
        why: 'Turns a path into the edge list the force-graph component consumes.',
        critical: true,
      },
      {
        name: 'datetime() temporal',
        cypher: 'RETURN datetime() AS now, date() AS today',
        why: 'Decides whether timestamps are stored as temporal types or as ISO strings + epoch millis.',
      },
      {
        name: 'duration.between()',
        cypher:
          'RETURN duration.between(datetime("2026-01-01T00:00:00Z"), datetime("2026-01-04T00:00:00Z")).days AS days',
        why: 'The dormant bust-out ring is a timing signature: N accounts drawing max within 72 hours.',
        check: expectScalar('days', 3),
      },
    ],
  },

  {
    title: 'Extensions — expected absent, confirmed not assumed',
    probes: [
      {
        name: 'APOC',
        cypher: 'RETURN apoc.version() AS v',
        why: 'If present, apoc.path.expand would give configurable traversals. Not counted on.',
      },
      {
        name: 'GDS',
        cypher: 'RETURN gds.version() AS v',
        why: 'If present, gds.wcc would replace the union-find in the app layer. Not counted on.',
      },
      {
        name: 'full-text index',
        cypher:
          "CREATE FULLTEXT INDEX probe_ft IF NOT EXISTS FOR (n:ProbeX) ON EACH [n.v]",
        why: 'Would enable fuzzy address matching instead of rule-based normalisation.',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Fixture graph
//
// Three nodes in a directed triangle, plus one chord. Small enough to create
// and tear down in a second, structured enough that a traversal probe returning
// zero rows is a genuine failure rather than an empty database.
//
//        probe-a ──PROBE_REL──▶ probe-b
//           ▲  │                   │
//           │  └───OTHER_REL───┐   │ PROBE_REL
//           │                  ▼   ▼
//           └────PROBE_REL──── probe-c
//
// One 3-cycle: a → b → c → a, with leg amounts 10 + 20 + 30 = 60.
// ---------------------------------------------------------------------------

const FIXTURE = `
  CREATE (a:ProbeX:ProbeShared {v: 'probe-a', n: 1})
  CREATE (b:ProbeX:ProbeShared {v: 'probe-b', n: 2})
  CREATE (c:ProbeX:ProbeShared {v: 'probe-c', n: 3})
  CREATE (a)-[:PROBE_REL {amount: 10.0}]->(b)
  CREATE (b)-[:PROBE_REL {amount: 20.0}]->(c)
  CREATE (c)-[:PROBE_REL {amount: 30.0}]->(a)
  CREATE (a)-[:OTHER_REL]->(c)
`

/** Everything the probe creates, so teardown leaves no trace. */
const TEARDOWN = [
  'MATCH (n:ProbeX) DETACH DELETE n',
  'MATCH (n:ProbeY) DETACH DELETE n',
  'MATCH (n:ProbeTmp) DETACH DELETE n',
  'DROP CONSTRAINT probe_req IF EXISTS',
  'DROP CONSTRAINT probe_assert IF EXISTS',
  'DROP INDEX probe_idx IF EXISTS',
  'DROP INDEX probe_ft IF EXISTS',
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Status = 'PASS' | 'FAIL' | 'WRONG' | 'EXPECTED-FAIL' | 'UNEXPECTED-PASS'

type Result = {
  group: string
  name: string
  status: Status
  critical: boolean
  why: string
  detail: string
}

/**
 * Run one probe in its own session.
 *
 * A session is used per probe rather than one for the whole run because a
 * failed statement can leave a session in a state that poisons every
 * subsequent statement — which would turn the first failure into a cascade of
 * misleading failures. Sessions are cheap; connections come from the pool.
 */
async function runProbe(driver: Driver, group: string, p: Probe): Promise<Result> {
  const session: Session = driver.session()
  const base = { group, name: p.name, critical: p.critical ?? false, why: p.why }

  try {
    const res = await session.run(p.cypher, p.params ?? {})
    const rows = res.records.map((r) => r.toObject() as Record<string, unknown>)

    if (p.expectFailure) {
      return { ...base, status: 'UNEXPECTED-PASS', detail: 'succeeded — the design assumption was wrong' }
    }

    const complaint = p.check?.(rows) ?? null
    if (complaint) return { ...base, status: 'WRONG', detail: complaint }

    return { ...base, status: 'PASS', detail: summarise(rows) }
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0].slice(0, 110)
    if (p.expectFailure) return { ...base, status: 'EXPECTED-FAIL', detail: msg }
    return { ...base, status: 'FAIL', detail: msg }
  } finally {
    await session.close()
  }
}

/** One-line preview of what came back, for the results table. */
function summarise(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '0 rows'
  const first = rows[0]
  const parts = Object.entries(first)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  return parts.join(' ').slice(0, 70)
}

const ICON: Record<Status, string> = {
  PASS: '  ok  ',
  FAIL: ' FAIL ',
  WRONG: ' WRONG',
  'EXPECTED-FAIL': ' n/a  ',
  'UNEXPECTED-PASS': ' !!   ',
}

async function main() {
  const driver = neo4j.driver(URI!, neo4j.auth.basic(USER, PASSWORD!), {
    disableLosslessIntegers: true,
  })

  // verifyConnectivity fails fast with a clear reason — wrong host, bad TLS,
  // bad credentials — instead of surfacing as a confusing error inside the
  // first probe.
  try {
    await driver.verifyConnectivity()
  } catch (e) {
    const err = e as Error & { code?: string }
    console.error(`\n  Could not reach CognoDB.\n\n    ${err.code ?? 'error'}: ${err.message.split('\n')[0]}\n`)
    console.error(
      '  Check that:\n' +
        '    - COGNODB_URI starts with bolt+s:// and matches the console exactly\n' +
        '    - the instance is running (console.cognodb.com)\n' +
        '    - COGNODB_PASSWORD is the value shown at instance creation\n',
    )
    await driver.close()
    process.exit(1)
  }

  console.log(`\n  Connected to ${URI!.replace(/\/\/.*@/, '//')}\n`)

  // Fixture first — traversal probes are meaningless against an empty graph.
  const setup = driver.session()
  try {
    await setup.run('MATCH (n:ProbeX) DETACH DELETE n') // in case a prior run died
    await setup.run(FIXTURE)
  } finally {
    await setup.close()
  }

  const results: Result[] = []
  for (const group of GROUPS) {
    for (const p of group.probes) {
      results.push(await runProbe(driver, group.title, p))
    }
  }

  // Teardown is best-effort: a failed DROP must not mask the probe results.
  const cleanup = driver.session()
  for (const stmt of TEARDOWN) {
    try {
      await cleanup.run(stmt)
    } catch {
      /* ignore — nothing to drop */
    }
  }
  await cleanup.close()
  await driver.close()

  report(results)
}

function report(results: Result[]) {
  let current = ''
  for (const r of results) {
    if (r.group !== current) {
      current = r.group
      console.log(`\n  ${current}`)
      console.log(`  ${'-'.repeat(76)}`)
    }
    const flag = r.critical ? '*' : ' '
    console.log(`  ${ICON[r.status]} ${flag} ${r.name.padEnd(28)} ${r.detail}`)
  }

  const broken = results.filter(
    (r) => r.critical && (r.status === 'FAIL' || r.status === 'WRONG'),
  )
  const surprises = results.filter((r) => r.status === 'UNEXPECTED-PASS')

  console.log(`\n  ${'='.repeat(78)}`)
  console.log(`  * = design-critical.  ${results.filter((r) => r.status === 'PASS').length}/${results.length} passed.`)

  if (broken.length > 0) {
    console.log(`\n  ${broken.length} DESIGN-CRITICAL failure(s) — the plan must change before writing app code:\n`)
    for (const b of broken) console.log(`    - ${b.name}: ${b.why}\n      ${b.detail}`)
  } else {
    console.log('\n  No design-critical failures. The planned queries are all supported.')
  }

  if (surprises.length > 0) {
    console.log(`\n  ${surprises.length} probe(s) expected to fail but succeeded — worth revisiting:`)
    for (const s of surprises) console.log(`    - ${s.name}`)
  }
  console.log()

  writeArtifacts(results)
}

/** Persist results so the README can quote them and a later session can read them. */
function writeArtifacts(results: Result[]) {
  const jsonPath = resolve(process.cwd(), 'docs/probe-results.json')
  const mdPath = resolve(process.cwd(), 'docs/cognodb-probe.md')
  mkdirSync(dirname(jsonPath), { recursive: true })

  writeFileSync(jsonPath, JSON.stringify({ uri: URI!.split('@').pop(), results }, null, 2))

  const rows = results
    .map(
      (r) =>
        `| ${r.group} | \`${r.name}\` | ${r.status} | ${r.why} |`,
    )
    .join('\n')

  writeFileSync(
    mdPath,
    `# CognoDB feature probe\n\n` +
      `Generated by \`npm run probe\`. Every Cypher construct this application ` +
      `depends on, verified against a live CognoDB \`c0\` instance rather than assumed ` +
      `from documentation.\n\n` +
      `\`PASS\` = parses, executes, and returns the expected result against a known ` +
      `fixture graph. \`n/a\` = confirmed unsupported, and the design accounts for it.\n\n` +
      `| Area | Construct | Result | Why this build cares |\n` +
      `|---|---|---|---|\n${rows}\n`,
  )

  console.log(`  Written: docs/probe-results.json, docs/cognodb-probe.md\n`)
}

main().catch((e) => {
  console.error('\n  Probe crashed:', e)
  process.exit(1)
})
