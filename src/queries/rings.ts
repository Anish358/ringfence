/**
 * src/queries/rings.ts — Q1: what accounts are connected, and how
 * ---------------------------------------------------------------------------
 * This is the input to ring detection. It deliberately returns IDENTIFIER
 * GROUPS rather than account pairs.
 *
 * The spec's original shape returned every pair of accounts sharing something,
 * filtered to pairs sharing >= 2 distinct KINDS of identifier. That filter is
 * wrong, and fatally so: five of the six planted rings share exactly one kind
 * (a device farm shares only devices), so the filter removes them and the home
 * page renders empty. "Two accounts sharing an address is a family" is a
 * true observation, but it belongs in SCORING, not in a hard gate.
 *
 * Returning groups instead of pairs is also cheaper. One identifier shared by
 * k accounts is ONE row here, versus k*(k-1)/2 pair rows -- and the group form
 * carries the member count, which the risk score needs anyway.
 */

import { readQuery } from '@/lib/db'
import { LINK_TYPES, MAX_IDENTIFIER_DEGREE } from './constants'
import type { LinkType } from './constants'

export type SharedGroup = {
  /** The identifier node's namespaced value, e.g. "dev:a4f7...". */
  value: string
  kind: LinkType
  /** Every account attached to it. Always length >= 2. */
  accountIds: string[]
}

/**
 * Every identifier shared by two or more accounts, excluding super-nodes.
 *
 * The degree filter is doing two jobs at once. EVIDENTIALLY, a college WiFi IP
 * with 400 accounts on it is not a fraud ring, and letting it through would
 * merge hundreds of unrelated accounts into one meaningless component.
 * COMPUTATIONALLY, it bounds the work: without it a single high-degree node
 * contributes k^2 pairs and the query time is dominated by noise.
 */
export async function sharedIdentifierGroups(): Promise<SharedGroup[]> {
  return readQuery<SharedGroup>(
    `MATCH (n:Identifier)<-[r:$linkTypes]-(a:Account)
     WITH n, type(r) AS kind, collect(DISTINCT a.id) AS accountIds
     WHERE size(accountIds) >= 2 AND size(accountIds) <= $maxDegree
     RETURN n.value AS value, kind, accountIds
     ORDER BY size(accountIds) DESC`,
    { linkTypes: LINK_TYPES, maxDegree: MAX_IDENTIFIER_DEGREE },
  )
}

export type AccountFacts = {
  id: string
  status: string
  creditLimit: number
  drawnAmount: number
  lastDrawAtMs: number | null
  isConfirmedFraud: boolean
}

/** The per-account figures the risk score and the ring card both need. */
export async function accountFacts(accountIds: string[]): Promise<AccountFacts[]> {
  return readQuery<AccountFacts>(
    `MATCH (a:Account) WHERE a.id IN $accountIds
     OPTIONAL MATCH (a)-[:FLAGGED_AS]->(fc:FraudCase)
     RETURN a.id           AS id,
            a.status       AS status,
            a.creditLimit  AS creditLimit,
            a.drawnAmount  AS drawnAmount,
            a.lastDrawAtMs AS lastDrawAtMs,
            count(fc) > 0  AS isConfirmedFraud`,
    { accountIds },
  )
}
