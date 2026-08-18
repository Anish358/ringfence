/**
 * src/queries/health.ts — Q7: liveness and the counts that drive empty states
 */

import { readQuery } from '@/lib/db'

/** Cheapest possible round trip. Backs /api/health and the status banner. */
export async function ping(): Promise<boolean> {
  const [row] = await readQuery<{ ok: number }>('RETURN 1 AS ok')
  return Number(row?.ok) === 1
}

export type GraphStats = {
  accounts: number
  identifiers: number
  transfers: number
  confirmedCases: number
}

/**
 * Drives the difference between "no rings found" and "no data loaded". An
 * empty list means one of two very different things, and showing
 * "run npm run seed" instead of a blank page is the cheapest UX point in the
 * whole build.
 */
export async function graphStats(): Promise<GraphStats> {
  const [row] = await readQuery<GraphStats>(
    `MATCH (a:Account)            WITH count(a) AS accounts
     MATCH (n:Identifier)         WITH accounts, count(n) AS identifiers
     MATCH ()-[t:TRANSFERRED]->() WITH accounts, identifiers, count(t) AS transfers
     MATCH (f:FraudCase)
     RETURN accounts, identifiers, transfers, count(f) AS confirmedCases`,
  )
  return row ?? { accounts: 0, identifiers: 0, transfers: 0, confirmedCases: 0 }
}
