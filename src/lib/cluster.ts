/**
 * src/lib/cluster.ts — union-find and ring scoring
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT CYPHER
 *
 * Grouping connected accounts into rings is the weakly-connected-components
 * problem. In Neo4j you would call gds.wcc(). The Graph Data Science library
 * is a Neo4j extension, not part of openCypher, and scripts/probe.ts confirms
 * it is absent on CognoDB -- along with APOC.
 *
 * So Cypher returns the EDGES and this file derives the components. On a few
 * hundred groups that is single-digit milliseconds, it is unit-testable, and
 * it is explicit rather than a black box. Stating the tradeoff is a better
 * answer than pretending there was no choice.
 */

import { LINK_WEIGHTS, MIN_RING_SIZE } from '@/queries/constants'
import type { LinkType } from '@/queries/constants'
import type { AccountFacts, SharedGroup } from '@/queries/rings'
import type { TransferCycle } from '@/queries/cycles'

export type RingSignal = { code: string; label: string; detail: string }

export type Ring = {
  /** Derived from the smallest member id, so it is STABLE across recomputes. */
  id: string
  displayId: string
  memberIds: string[]
  risk: number
  /** Rupees already drawn by members -- money that is out the door. */
  exposure: number
  /** Undrawn limit on still-active members -- money that could still leave. */
  atRisk: number
  sharedBy: Array<{ kind: LinkType; value: string; count: number }>
  linkTypes: LinkType[]
  confirmedCount: number
  activeCount: number
  cycles: TransferCycle[]
  signals: RingSignal[]
  breakdown: Record<string, number>
}

/* -- union-find -------------------------------------------------------------
 * Feed it pairs, get back groups. Path compression keeps find() near O(1).
 * ------------------------------------------------------------------------ */

class UnionFind {
  private parent = new Map<string, string>()

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    const p = this.parent.get(x)!
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root) // path compression
    return root
  }

  union(x: string, y: string): void {
    const rx = this.find(x)
    const ry = this.find(y)
    if (rx !== ry) this.parent.set(rx, ry)
  }

  groups(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    for (const key of this.parent.keys()) {
      const root = this.find(key)
      if (!out.has(root)) out.set(root, new Set())
      out.get(root)!.add(key)
    }
    return out
  }
}

/**
 * Ring membership comes from TWO edge sources, deliberately.
 *
 * Shared identifiers alone would miss a ring whose members share nothing and
 * exist only in the money movement -- exactly ring 4 in the seed data. Unioning
 * transfer cycles in means a cycle is a first-class detector rather than a
 * badge printed on a ring that identifiers already found.
 */
export function buildRings(
  groups: SharedGroup[],
  cycles: TransferCycle[],
  facts: AccountFacts[],
): Ring[] {
  const uf = new UnionFind()

  for (const g of groups) {
    const [first, ...rest] = g.accountIds
    for (const other of rest) uf.union(first, other)
  }
  for (const c of cycles) {
    const [first, ...rest] = c.accounts
    for (const other of rest) uf.union(first, other)
  }

  const factsById = new Map(facts.map((f) => [f.id, f]))
  const components = [...uf.groups().values()].filter((m) => m.size >= MIN_RING_SIZE)

  return components
    .map((members) => scoreRing(members, groups, cycles, factsById))
    .sort((a, b) => b.risk - a.risk || b.exposure - a.exposure)
}

/**
 * The risk score.
 *
 * This is domain judgment expressed as arithmetic, and it is the difference
 * between a detector with judgment and a threshold. Every term is separately
 * reported in `breakdown` so the UI can show WHY a ring scored what it did --
 * an analyst who cannot see the reasoning will not trust the number.
 */
function scoreRing(
  memberSet: Set<string>,
  allGroups: SharedGroup[],
  allCycles: TransferCycle[],
  factsById: Map<string, AccountFacts>,
): Ring {
  const memberIds = [...memberSet].sort()
  const members = memberIds.map((id) => factsById.get(id)).filter(Boolean) as AccountFacts[]

  const sharedBy = allGroups
    .filter((g) => g.accountIds.some((id) => memberSet.has(id)))
    .map((g) => ({
      kind: g.kind,
      value: g.value,
      count: g.accountIds.filter((id) => memberSet.has(id)).length,
    }))
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count)

  const cycles = allCycles.filter((c) => c.accounts.every((id) => memberSet.has(id)))
  const linkTypes = [...new Set(sharedBy.map((s) => s.kind))]

  // How much shared infrastructure, weighted by how incriminating each kind is.
  // A device shared by 6 accounts contributes 0.9 x 5; an address shared by 2
  // contributes 0.45 x 1.
  const signal = sharedBy.reduce((sum, s) => sum + LINK_WEIGHTS[s.kind] * (s.count - 1), 0)

  const confirmedCount = members.filter((m) => m.isConfirmedFraud).length
  const activeCount = members.filter((m) => m.status === 'ACTIVE').length

  // Co-timed drawdown: three or more members taking nearly their whole limit
  // inside 72 hours. This is the bust-out signature.
  const draws = members
    .filter((m) => m.lastDrawAtMs !== null && m.drawnAmount >= m.creditLimit * 0.9)
    .map((m) => m.lastDrawAtMs!)
    .sort((a, b) => a - b)
  let coTimed = false
  for (let i = 0; i + 2 < draws.length; i++) {
    if (draws[i + 2] - draws[i] <= 72 * 3_600_000) { coTimed = true; break }
  }

  const breakdown = {
    // Shared infrastructure, the dominant term.
    structural: Math.min(45, signal * 4),
    // Mixing KINDS of identifier is far more suspicious than repeating one.
    // A family shares an address; a ring shares a device AND a bank account.
    diversity: (linkTypes.length - 1) * 6,
    size: Math.min(12, Math.max(0, (memberIds.length - 2) * 1.5)),
    cycles: cycles.length > 0 ? 20 : 0,
    knownFraud: confirmedCount > 0 ? 12 : 0,
    coTimedDrawdown: coTimed ? 10 : 0,
  }

  const risk = Math.max(0, Math.min(100, Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0))))

  const signals: RingSignal[] = []
  if (cycles.length > 0) {
    signals.push({ code: 'CYCLES', label: 'Circular transfers', detail: `${cycles.length} money loop${cycles.length > 1 ? 's' : ''} between members` })
  }
  if (linkTypes.length >= 3) {
    signals.push({ code: 'MIXED', label: 'Mixed identifiers', detail: `${linkTypes.length} different kinds of shared identifier` })
  }
  if (coTimed) {
    signals.push({ code: 'BURST', label: 'Co-timed drawdown', detail: 'Three or more members drew their full limit within 72 hours' })
  }
  if (confirmedCount > 0) {
    signals.push({ code: 'KNOWN', label: 'Confirmed fraud inside', detail: `${confirmedCount} member${confirmedCount > 1 ? 's' : ''} already confirmed` })
  }
  if (sharedBy.length > 0 && sharedBy.every((s) => s.count === memberIds.length) && linkTypes.length === 1 && linkTypes[0] === 'RESIDES_AT') {
    signals.push({ code: 'HOUSEHOLD', label: 'Possible household', detail: 'One shared address and nothing else — often a family' })
  }

  // Stable id from the smallest member. An index into a risk-sorted array
  // would change every time a decision is written back, breaking every URL.
  const smallest = memberIds[0]
  const numeric = smallest.replace(/^\D+/, '')

  return {
    id: `r-${smallest.toLowerCase()}`,
    displayId: `RING-${numeric}`,
    memberIds,
    risk,
    exposure: members.reduce((s, m) => s + m.drawnAmount, 0),
    atRisk: members.filter((m) => m.status === 'ACTIVE').reduce((s, m) => s + Math.max(0, m.creditLimit - m.drawnAmount), 0),
    sharedBy,
    linkTypes,
    confirmedCount,
    activeCount,
    cycles,
    signals,
    breakdown,
  }
}
