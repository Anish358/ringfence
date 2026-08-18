/**
 * src/queries/subgraph.ts — the data behind the Investigation Canvas
 * ---------------------------------------------------------------------------
 * Returns the raw links for a set of accounts and lets the caller decide what
 * to draw. Filtering to "identifiers shared by two or more ring members"
 * happens in TypeScript rather than Cypher, deliberately: a ring is at most a
 * few dozen accounts, so this is a hundred rows, and expressing the condition
 * in Cypher would need a correlated subquery per row for no measurable gain.
 * Push work to the database when the database can reduce the data; not before.
 */

import { readQuery } from '@/lib/db'
import { LINK_TYPES } from './constants'
import type { LinkType } from './constants'

export type MemberLink = {
  accountId: string
  status: string
  kind: LinkType
  value: string
  nodeKind: string
  degree: number
}

export async function memberLinks(accountIds: string[]): Promise<MemberLink[]> {
  if (accountIds.length === 0) return []
  return readQuery<MemberLink>(
    `MATCH (a:Account) WHERE a.id IN $accountIds
     MATCH (a)-[r:$linkTypes]->(n:Identifier)
     RETURN a.id                                          AS accountId,
            a.status                                      AS status,
            type(r)                                       AS kind,
            n.value                                       AS value,
            [l IN labels(n) WHERE l <> 'Identifier'][0]    AS nodeKind,
            COUNT { (n)<--() }                            AS degree`,
    { accountIds, linkTypes: LINK_TYPES },
  )
}

export type InternalTransfer = { from: string; to: string; amount: number; ts: string }

export async function internalTransfers(accountIds: string[]): Promise<InternalTransfer[]> {
  if (accountIds.length === 0) return []
  return readQuery<InternalTransfer>(
    `MATCH (a:Account)-[t:TRANSFERRED]->(b:Account)
     WHERE a.id IN $accountIds AND b.id IN $accountIds
     RETURN a.id AS from, b.id AS to, t.amount AS amount, t.ts AS ts
     ORDER BY t.tsMs DESC
     LIMIT 200`,
    { accountIds },
  )
}

export type MemberDetail = {
  id: string
  status: string
  openedAt: string
  creditLimit: number
  drawnAmount: number
  lastDrawAt: string | null
  customerName: string | null
  isConfirmedFraud: boolean
  loanState: string | null
}

/** Everything the side panel shows when an analyst clicks a node. */
export async function memberDetails(accountIds: string[]): Promise<MemberDetail[]> {
  if (accountIds.length === 0) return []
  return readQuery<MemberDetail>(
    `MATCH (a:Account) WHERE a.id IN $accountIds
     OPTIONAL MATCH (c:Customer)-[:OWNS]->(a)
     OPTIONAL MATCH (a)-[:FLAGGED_AS]->(fc:FraudCase)
     OPTIONAL MATCH (a)-[:APPLIED_FOR]->(l:Loan)
     RETURN a.id          AS id,
            a.status      AS status,
            a.openedAt    AS openedAt,
            a.creditLimit AS creditLimit,
            a.drawnAmount AS drawnAmount,
            a.lastDrawAt  AS lastDrawAt,
            c.name        AS customerName,
            count(fc) > 0 AS isConfirmedFraud,
            head(collect(l.state)) AS loanState`,
    { accountIds },
  )
}
