/**
 * src/queries/traversal.ts — Q2 (multi-hop expansion) and Q3 (path to fraud)
 * ---------------------------------------------------------------------------
 * Q2 is the brief's explicit MULTI-HOP TRAVERSAL requirement.
 * Q3 is the headline "awkward for a relational database" query.
 */

import { z } from 'zod'
import { readQuery } from '@/lib/db'
import { LINK_TYPES, MAX_IDENTIFIER_DEGREE } from './constants'

/* ===========================================================================
 * Q2 · Expand a neighbourhood — the Investigation Canvas
 *
 * THE ONE PLACE A VALUE IS INTERPOLATED INTO CYPHER, AND WHY IT IS SAFE
 *
 * Cypher does not permit a parameter as the bound of a variable-length
 * pattern. `-[:REL*1..$depth]-` is a syntax error, confirmed by
 * scripts/probe.ts, which runs it deliberately and reports EXPECTED-FAIL.
 *
 * The bound must therefore be a literal in the query text. Rather than build
 * the string at call time from caller input, every permitted depth gets its
 * own query string, built once at module load and frozen. The caller's depth
 * is validated against a Zod enum before it can index the map, so the only
 * strings that ever reach the engine are the three written below. A value
 * outside the enum throws before touching the database.
 *
 * Selecting a constant from a fixed set is not string concatenation. Note that
 * relationship TYPES are not interpolated at all -- CognoDB accepts them as a
 * list parameter, which the probe verified.
 * ======================================================================== */

export const DepthSchema = z.enum(['1', '2', '3'])
export type Depth = z.infer<typeof DepthSchema>

export type GraphNode = {
  id: string
  label: string
  status: string | null
}

export type GraphEdge = {
  source: GraphNode
  target: GraphNode
  kind: string
}

/**
 * `hops` counts ACCOUNT-to-account steps. Each one passes through an
 * identifier node, so the relationship depth is always twice the hop count --
 * which is also why path lengths in this graph are reliably even.
 */
function expandQuery(hops: 1 | 2 | 3): string {
  const relDepth = hops * 2
  return `
    MATCH (seed:Account {id: $accountId})
    MATCH p = (seed)-[:$linkTypes*1..${relDepth}]-(other)
    WHERE all(n IN nodes(p)
              WHERE NOT n:Identifier OR COUNT { (n)<--() } <= $maxDegree)
    WITH p LIMIT $maxPaths
    UNWIND relationships(p) AS r
    WITH DISTINCT r
    RETURN { id:     coalesce(startNode(r).id, startNode(r).value),
             label:  [l IN labels(startNode(r)) WHERE l <> 'Identifier'][0],
             status: startNode(r).status }                            AS source,
           { id:     coalesce(endNode(r).id, endNode(r).value),
             label:  [l IN labels(endNode(r)) WHERE l <> 'Identifier'][0],
             status: endNode(r).status }                              AS target,
           type(r)                                                    AS kind
  `
}

const EXPAND_BY_DEPTH: Readonly<Record<Depth, string>> = Object.freeze({
  '1': expandQuery(1),
  '2': expandQuery(2),
  '3': expandQuery(3),
})

/**
 * Returns a distinct EDGE LIST rather than paths. That is exactly the shape a
 * force-directed graph component consumes, and the node set is derivable from
 * it -- so one query feeds the whole canvas.
 */
export async function expandNeighbourhood(
  accountId: string,
  depth: Depth,
  maxPaths = 400,
): Promise<GraphEdge[]> {
  return readQuery<GraphEdge>(EXPAND_BY_DEPTH[depth], {
    accountId,
    linkTypes: LINK_TYPES,
    maxDegree: MAX_IDENTIFIER_DEGREE,
    maxPaths,
  })
}

/* ===========================================================================
 * Q3 · Shortest path to a known fraud account — THE HEADLINE QUERY
 *
 * The question: "is this account connected to anything we have already
 * confirmed as fraud, and if so, how?"
 *
 * An analyst does not want a boolean. They need the chain -- this applicant
 * shares a device with ACC-4471, which paid out to the same bank account as
 * ACC-2210, which is confirmed fraud. That chain IS the evidence, and it is
 * what a relational database cannot hand back. SQL returns rows; this returns
 * a route.
 *
 * The SQL equivalent is a recursive CTE in which you hand-write cycle
 * prevention, hand-track depth, and hand-pick the minimum per target -- and
 * even then you get the length, not the path, unless you also accumulate the
 * route as a string as you go.
 * ======================================================================== */

export type FraudPath = {
  fraudAccount: string
  hops: number
  chain: Array<{ label: string; value: string }>
  links: string[]
}

export async function pathToKnownFraud(
  accountId: string,
  maxHops = 4,
  limit = 5,
): Promise<FraudPath[]> {
  // Relationship depth is twice the hop count; *..8 is 4 account hops.
  const relDepth = Math.min(Math.max(maxHops, 1), 5) * 2

  return readQuery<FraudPath>(
    `MATCH (a:Account {id: $accountId})
     MATCH (fraud:Account)-[:FLAGGED_AS]->(:FraudCase)
     WHERE fraud.id <> a.id
     MATCH p = shortestPath((a)-[:$linkTypes*..${relDepth}]-(fraud))
     RETURN fraud.id                                     AS fraudAccount,
            length(p) / 2                                AS hops,
            [n IN nodes(p) |
              { label: [l IN labels(n) WHERE l <> 'Identifier'][0],
                value: coalesce(n.id, n.value) }]        AS chain,
            [r IN relationships(p) | type(r)]            AS links
     ORDER BY hops ASC
     LIMIT $limit`,
    { accountId, linkTypes: LINK_TYPES, limit },
  )
}

/**
 * Q3b · Shortest path between any two accounts — the Path Finder screen.
 * The purest demonstration of the thing SQL cannot do, and nearly free once
 * the query above exists.
 */
export async function pathBetween(
  fromId: string,
  toId: string,
  maxHops = 5,
): Promise<FraudPath | null> {
  const relDepth = Math.min(Math.max(maxHops, 1), 6) * 2
  const [row] = await readQuery<FraudPath>(
    `MATCH (a:Account {id: $fromId}), (b:Account {id: $toId})
     MATCH p = shortestPath((a)-[:$linkTypes*..${relDepth}]-(b))
     RETURN b.id                                         AS fraudAccount,
            length(p) / 2                                AS hops,
            [n IN nodes(p) |
              { label: [l IN labels(n) WHERE l <> 'Identifier'][0],
                value: coalesce(n.id, n.value) }]        AS chain,
            [r IN relationships(p) | type(r)]            AS links`,
    { fromId, toId, linkTypes: LINK_TYPES },
  )
  return row ?? null
}
