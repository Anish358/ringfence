/**
 * src/lib/detect.ts — the detection pipeline
 * ---------------------------------------------------------------------------
 * Three queries and one in-process algorithm, in the order they depend on
 * each other. This is the function Ring Radar renders.
 */

import { accountFacts, sharedIdentifierGroups } from '@/queries/rings'
import { cycleCandidates, transferCycles } from '@/queries/cycles'
import { buildRings, type Ring } from './cluster'

/** Transfers above this are ordinary payments, not ring-maintenance noise. */
export const MAX_CYCLE_LEG = 2_000

export async function detectRings(): Promise<Ring[]> {
  // 1. Shared identifiers, super-nodes already excluded by the query.
  const groups = await sharedIdentifierGroups()

  // 2. Money loops. Narrowing the start set first is not optional -- running
  //    the traversal from every account times out on a free-tier instance.
  const candidates = await cycleCandidates(MAX_CYCLE_LEG)
  const cycles = await transferCycles(candidates, MAX_CYCLE_LEG)

  // 3. Per-account figures for scoring and for the ring cards.
  const involved = [
    ...new Set([...groups.flatMap((g) => g.accountIds), ...cycles.flatMap((c) => c.accounts)]),
  ]
  const facts = await accountFacts(involved)

  // 4. Components and scores, in process.
  return buildRings(groups, cycles, facts)
}

export async function findRing(id: string): Promise<Ring | null> {
  const rings = await detectRings()
  return rings.find((r) => r.id === id) ?? null
}
