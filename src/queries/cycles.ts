/**
 * src/queries/cycles.ts — Q4: money that leaves an account and comes back
 * ---------------------------------------------------------------------------
 * The strongest "no clean relational equivalent" evidence in the project, and
 * the query that had to be rewritten after probing the live engine.
 *
 * WHAT THE OBVIOUS VERSION LOOKS LIKE, AND WHY IT CANNOT WORK HERE
 *
 *   MATCH cycle = (a:Account)-[t:TRANSFERRED*3..5]->(a)      -- returns nothing
 *
 * CognoDB applies NODE uniqueness to variable-length patterns: a matched path
 * may never revisit a node. Neo4j applies RELATIONSHIP uniqueness, where a
 * path may revisit a node so long as it does not reuse an edge. Under node
 * uniqueness a closed walk is unmatchable BY DEFINITION -- arriving back at
 * the start is a revisited node. This is a semantic difference, not a bug, and
 * it is the reason scripts/probe.ts exists.
 *
 * THE DECOMPOSITION
 *
 *   an ACYCLIC variable-length segment   a -> ... -> b     (node-unique: legal)
 *   plus a separately matched edge       b -> a            (rule does not apply)
 *
 * The two patterns together describe exactly the cycle we wanted, and the
 * engine is never asked to revisit a node inside one variable-length segment.
 * Legs = segment length + 1, so *2..3 finds cycles of 3 or 4 transfers.
 *
 * WHY THE DEPTH STOPS AT 3, MEASURED RATHER THAN GUESSED
 *
 *   *2..4 (up to 5 legs)   11.9s   48 rows
 *   *2..3 (up to 4 legs)    3.2s   28 rows
 *
 * Each extra hop multiplies the search by the average out-degree, and on a
 * burstable 0.5 vCPU instance the fourth hop costs 3.7x for cycles that are
 * already found at a shorter length by another rotation. Confining the path to
 * the candidate set was also tried and made it SLOWER (16.1s) -- the extra
 * predicate is evaluated per path, after the expansion it was meant to avoid.
 */

import { readQuery } from '@/lib/db'

export type TransferCycle = {
  accounts: string[]
  legs: number
  totalMoved: number
}

/**
 * Step 1 — narrow the starting set.
 *
 * A cycle needs at least one small transfer IN and one small transfer OUT, so
 * any account without both cannot begin one. Running the traversal from every
 * account instead times out: `Neo.TransientError.General.OutOfTimeError`.
 */
export async function cycleCandidates(maxLegAmount: number): Promise<string[]> {
  const rows = await readQuery<{ accountId: string }>(
    `MATCH (a:Account)-[out:TRANSFERRED]->()
     WHERE out.amount <= $maxLegAmount
     WITH DISTINCT a
     MATCH ()-[inc:TRANSFERRED]->(a)
     WHERE inc.amount <= $maxLegAmount
     RETURN DISTINCT a.id AS accountId`,
    { maxLegAmount },
  )
  return rows.map((r) => r.accountId)
}

/**
 * Step 2 — the traversal, ANCHORED.
 *
 * Note the first line. Binding `a` before expanding is not stylistic: writing
 * `MATCH p = (a:Account)-[:TRANSFERRED*2..4]->(b) WHERE a.id IN $ids` expands
 * from every account in the database and then discards all but the candidates,
 * which times out. Bind first, expand second.
 *
 * `relationships(p)` rather than a `-[t:TRANSFERRED*2..4]-` variable: on
 * CognoDB that variable binds to a Path, not a list, so `all(r IN t ...)`
 * raises "all() requires list, got Path".
 */
export async function transferCycles(
  accountIds: string[],
  maxLegAmount: number,
  limit = 200,
): Promise<TransferCycle[]> {
  if (accountIds.length === 0) return []

  const raw = await readQuery<TransferCycle>(
    `MATCH (a:Account) WHERE a.id IN $accountIds
     MATCH p = (a)-[:TRANSFERRED*2..3]->(b:Account)
     MATCH (b)-[closing:TRANSFERRED]->(a)
     WITH p, closing, relationships(p) AS legs
     WHERE all(r IN legs WHERE r.amount <= $maxLegAmount)
       AND closing.amount <= $maxLegAmount
     RETURN [n IN nodes(p) | n.id]                                   AS accounts,
            size(legs) + 1                                           AS legs,
            reduce(s = 0.0, r IN legs | s + r.amount) + closing.amount AS totalMoved
     ORDER BY legs DESC
     LIMIT $limit`,
    { accountIds, maxLegAmount, limit },
  )

  return dedupeRotations(raw)
}

/**
 * The same loop is returned once per starting node and once per rotation:
 * A->B->C->A, B->C->A->B and C->A->B->C are one cycle reported three times.
 * Sorting the member ids gives a rotation-independent key.
 */
export function dedupeRotations(cycles: TransferCycle[]): TransferCycle[] {
  const seen = new Set<string>()
  const out: TransferCycle[] = []
  for (const c of cycles) {
    const key = [...c.accounts].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}
