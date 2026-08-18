/**
 * src/lib/graph-model.ts — turn query rows into what the canvas draws
 * ---------------------------------------------------------------------------
 * Kept out of the component so the shaping rules are testable and stated once.
 *
 * The important rule: an identifier is only drawn if TWO OR MORE ring members
 * touch it. Every account also has private identifiers -- its own phone, its
 * own address -- and drawing those turns a legible ring into a hairball where
 * each account trails four dead-end spokes. What the analyst needs to see is
 * the shared infrastructure, because that is the evidence.
 */

import type { MemberLink, InternalTransfer } from '@/queries/subgraph'

export type CanvasNode = {
  id: string
  kind: 'Account' | 'Device' | 'Address' | 'BankAccount' | 'IPAddress'
  label: string
  status?: string
  /** How many accounts in the WHOLE graph touch this identifier. */
  degree?: number
  /** How many of THIS ring's members touch it. */
  sharedBy?: number
  isSeed?: boolean
}

export type CanvasLink = {
  source: string
  target: string
  kind: string
  amount?: number
}

export type CanvasGraph = {
  nodes: CanvasNode[]
  links: CanvasLink[]
  /** Private identifiers omitted, reported so the omission is visible. */
  hiddenPrivateIdentifiers: number
}

export function buildCanvasGraph(
  memberIds: string[],
  links: MemberLink[],
  transfers: InternalTransfer[],
): CanvasGraph {
  const members = new Set(memberIds)

  // Count how many ring members touch each identifier value.
  const touchedBy = new Map<string, Set<string>>()
  for (const l of links) {
    if (!members.has(l.accountId)) continue
    if (!touchedBy.has(l.value)) touchedBy.set(l.value, new Set())
    touchedBy.get(l.value)!.add(l.accountId)
  }

  const shared = new Set([...touchedBy.entries()].filter(([, s]) => s.size >= 2).map(([v]) => v))
  const hiddenPrivateIdentifiers = touchedBy.size - shared.size

  const nodes = new Map<string, CanvasNode>()
  const out: CanvasLink[] = []

  for (const id of memberIds) {
    const status = links.find((l) => l.accountId === id)?.status
    nodes.set(id, { id, kind: 'Account', label: id, status })
  }

  for (const l of links) {
    if (!members.has(l.accountId) || !shared.has(l.value)) continue
    if (!nodes.has(l.value)) {
      nodes.set(l.value, {
        id: l.value,
        kind: l.nodeKind as CanvasNode['kind'],
        label: l.value,
        degree: l.degree,
        sharedBy: touchedBy.get(l.value)!.size,
      })
    }
    out.push({ source: l.accountId, target: l.value, kind: l.kind })
  }

  // Money edges go account-to-account and are what make a cycle visible as a
  // closed loop on screen rather than a number in a badge.
  for (const t of transfers) {
    if (!members.has(t.from) || !members.has(t.to)) continue
    out.push({ source: t.from, target: t.to, kind: 'TRANSFERRED', amount: t.amount })
  }

  return { nodes: [...nodes.values()], links: out, hiddenPrivateIdentifiers }
}
