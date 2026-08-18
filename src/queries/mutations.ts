/**
 * src/queries/mutations.ts — Q6: the analyst's decision, written back
 * ---------------------------------------------------------------------------
 * A read-only version of this product is a report. Writing the analyst's
 * verdict back into the graph is what makes it a system: the account confirmed
 * today becomes a seed point that Applicant Check measures distance from
 * tomorrow, automatically, with no retraining and no rule to write.
 *
 * Both operations are idempotent -- confirming an already-confirmed account,
 * or clearing an already-cleared one, converges rather than duplicating.
 */

import { writeQuery } from '@/lib/db'

export type DecisionResult = { accountId: string; status: string }

export async function confirmFraud(args: {
  accountId: string
  analyst: string
  note: string
}): Promise<DecisionResult | null> {
  // Interpolated into a STRING, not into Cypher. It travels to the database as
  // $caseId below, so this is not a concatenated query -- worth the comment
  // because a reviewer grepping for `${` in this folder will land here.
  const caseId = `FC-MANUAL-${args.accountId}`
  const now = new Date().toISOString()

  const [row] = await writeQuery<DecisionResult>(
    `MATCH (a:Account {id: $accountId})
     MERGE (c:FraudCase {id: $caseId})
       ON CREATE SET c.openedAt = $now, c.openedBy = $analyst
     MERGE (a)-[f:FLAGGED_AS]->(c)
     SET f.confirmedAt = $now,
         f.analyst     = $analyst,
         f.note        = $note,
         c.note        = $note,
         a.status      = 'FRAUD_CONFIRMED'
     RETURN a.id AS accountId, a.status AS status`,
    { accountId: args.accountId, caseId, now, analyst: args.analyst, note: args.note },
  )
  return row ?? null
}

/**
 * Clearing removes the FLAGGED_AS relationship rather than the FraudCase node,
 * because a case may cover several accounts and clearing one must not delete
 * the case for the others.
 */
export async function clearAccount(args: {
  accountId: string
  analyst: string
}): Promise<DecisionResult | null> {
  const [row] = await writeQuery<DecisionResult>(
    `MATCH (a:Account {id: $accountId})
     OPTIONAL MATCH (a)-[f:FLAGGED_AS]->(:FraudCase)
     DELETE f
     SET a.status = 'CLEARED',
         a.clearedAt = $now,
         a.clearedBy = $analyst
     RETURN a.id AS accountId, a.status AS status`,
    { accountId: args.accountId, analyst: args.analyst, now: new Date().toISOString() },
  )
  return row ?? null
}
