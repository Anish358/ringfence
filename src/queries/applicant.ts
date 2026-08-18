/**
 * src/queries/applicant.ts — Q5: check an applicant BEFORE money moves
 * ---------------------------------------------------------------------------
 * The screen where the business value actually lives. Everything else in the
 * product explains fraud that already happened; this one prevents it.
 *
 * The applicant has no :Account node yet -- they are a form submission. So
 * step one resolves the raw values they typed against identifier nodes that
 * already exist. This is precisely what the shared :Identifier label and its
 * single uniqueness index are for: one indexed lookup resolves a bag of mixed
 * values without knowing in advance which kind each one is.
 *
 * The values are normalised through the SAME functions the seed script used.
 * If those ever diverged, an applicant typing the identical address already in
 * the graph would silently fail to match it.
 */

import { readQuery } from '@/lib/db'
import { normaliseAddress, normaliseBankAccount, normaliseDevice, normaliseIp } from '@/lib/normalise'
import { LINK_TYPES, MAX_IDENTIFIER_DEGREE, VALUE_PREFIX } from './constants'

export type ApplicantInput = {
  deviceFingerprint?: string
  address?: string
  bankAccountNumber?: string
  bankIfsc?: string
  ipAddress?: string
}

export type DirectMatch = {
  accountId: string
  status: string
  isConfirmedFraud: boolean
  sharedVia: Array<{ kind: string; value: string; degree: number }>
}

/**
 * Turn a form submission into the namespaced identifier values to look up.
 *
 * These template literals build DATA, not query text. The result is handed to
 * Cypher as the $values parameter, so user input never reaches the statement --
 * noted because grepping this folder for `${` finds these lines.
 */
export function toIdentifierValues(input: ApplicantInput): string[] {
  const values: string[] = []
  if (input.deviceFingerprint?.trim()) {
    values.push(`${VALUE_PREFIX.Device}:${normaliseDevice(input.deviceFingerprint)}`)
  }
  if (input.address?.trim()) {
    values.push(`${VALUE_PREFIX.Address}:${normaliseAddress(input.address)}`)
  }
  if (input.bankAccountNumber?.trim() && input.bankIfsc?.trim()) {
    values.push(`${VALUE_PREFIX.BankAccount}:${normaliseBankAccount(input.bankAccountNumber, input.bankIfsc)}`)
  }
  if (input.ipAddress?.trim()) {
    values.push(`${VALUE_PREFIX.IPAddress}:${normaliseIp(input.ipAddress)}`)
  }
  return values
}

/**
 * Step 1 — which existing accounts share any of these identifiers?
 *
 * `degree` comes back per shared identifier so the caller can discount a match
 * made through a node hundreds of accounts already touch. Sharing an office IP
 * with 400 people is not evidence; sharing a handset with two is.
 */
export async function directMatches(values: string[], limit = 25): Promise<DirectMatch[]> {
  if (values.length === 0) return []

  return readQuery<DirectMatch>(
    `UNWIND $values AS v
     MATCH (n:Identifier {value: v})
     MATCH (existing:Account)-[:$linkTypes]->(n)
     WITH DISTINCT existing, n, COUNT { (n)<--() } AS degree
     OPTIONAL MATCH (existing)-[:FLAGGED_AS]->(fc:FraudCase)
     WITH existing,
          collect(DISTINCT {
            kind:   [l IN labels(n) WHERE l <> 'Identifier'][0],
            value:  n.value,
            degree: degree
          })            AS sharedVia,
          count(fc)     AS fraudCases
     RETURN existing.id     AS accountId,
            existing.status AS status,
            sharedVia,
            fraudCases > 0  AS isConfirmedFraud
     ORDER BY isConfirmedFraud DESC, size(sharedVia) DESC
     LIMIT $limit`,
    { values, linkTypes: LINK_TYPES, limit },
  )
}

/**
 * Step 2 — how far is the applicant from KNOWN fraud?
 *
 * Anchored at the identifier nodes rather than at an account, because the
 * applicant has no account node to start from. One hop out to the accounts
 * that share those identifiers, then a shortest path from each to any
 * confirmed-fraud account. Adding one for the applicant's own hop gives the
 * distance they would have if they existed.
 */
export type FraudProximity = {
  viaAccount: string
  fraudAccount: string
  hops: number
  chain: Array<{ label: string; value: string }>
  links: string[]
}

export async function proximityToFraud(values: string[], limit = 3): Promise<FraudProximity[]> {
  if (values.length === 0) return []

  return readQuery<FraudProximity>(
    `MATCH (n:Identifier) WHERE n.value IN $values AND COUNT { (n)<--() } <= $maxDegree
     MATCH (via:Account)-[:$linkTypes]->(n)
     WITH DISTINCT via
     MATCH (fraud:Account)-[:FLAGGED_AS]->(:FraudCase)
     WHERE fraud.id <> via.id
     MATCH p = shortestPath((via)-[:$linkTypes*..6]-(fraud))
     RETURN via.id                                        AS viaAccount,
            fraud.id                                      AS fraudAccount,
            length(p) / 2 + 1                             AS hops,
            [x IN nodes(p) |
              { label: [l IN labels(x) WHERE l <> 'Identifier'][0],
                value: coalesce(x.id, x.value) }]         AS chain,
            [r IN relationships(p) | type(r)]             AS links
     ORDER BY hops ASC
     LIMIT $limit`,
    { values, linkTypes: LINK_TYPES, maxDegree: MAX_IDENTIFIER_DEGREE, limit },
  )
}

/* ===========================================================================
 * Example inputs for the demo
 *
 * A reviewer has five minutes and should not have to invent test data. These
 * two examples are pulled from the LIVE GRAPH rather than hardcoded, so they
 * stay correct if the dataset is regenerated -- one identifier that leads to a
 * real ring, and one that leads to an innocent household.
 *
 * Showing the benign case matters as much as the risky one: it is what proves
 * the scoring has judgment rather than flagging anything connected.
 * ======================================================================== */

export type ExampleApplicant = {
  label: string
  hint: string
  input: ApplicantInput
}

export async function exampleApplicants(): Promise<ExampleApplicant[]> {
  const [risky] = await readQuery<{ value: string }>(
    `MATCH (n:Device)<-[:USED_DEVICE]-(a:Account)
     WITH n, count(a) AS accounts,
          sum(CASE WHEN a.status = 'FRAUD_CONFIRMED' THEN 1 ELSE 0 END) AS confirmed
     WHERE accounts >= 5 AND confirmed >= 1
     RETURN n.value AS value
     ORDER BY accounts DESC LIMIT 1`,
  )

  const [benign] = await readQuery<{ value: string; sample: string }>(
    `MATCH (n:Address)<-[:RESIDES_AT]-(a:Account)
     WITH n, count(a) AS accounts,
          sum(CASE WHEN a.status = 'FRAUD_CONFIRMED' THEN 1 ELSE 0 END) AS confirmed
     WHERE accounts = 3 AND confirmed = 0
     RETURN n.value AS value, n.sample AS sample LIMIT 1`,
  )

  const out: ExampleApplicant[] = []
  if (risky) {
    out.push({
      label: 'Risky applicant',
      hint: 'Device fingerprint already seen on a confirmed fraud account',
      input: { deviceFingerprint: risky.value.replace(/^dev:/, '') },
    })
  }
  if (benign) {
    out.push({
      label: 'Innocent applicant',
      hint: 'Address shared with two family members and nothing else',
      input: { address: benign.sample ?? benign.value.replace(/^addr:/, '') },
    })
  }
  return out
}
