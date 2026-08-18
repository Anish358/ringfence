/**
 * src/lib/types.ts
 * ---------------------------------------------------------------------------
 * The shapes that travel from the generator, through data/*.json, into the
 * seed script, and out of the queries. One definition each, shared by all
 * three, so a field rename cannot silently break the loader.
 */

import type { AccountStatus, IdentifierKind, LinkType } from '@/queries/constants'

/* -- generated seed data ---------------------------------------------------- */

export type CustomerRow = {
  id: string
  name: string
  dob: string
  idNumber: string
}

export type AccountRow = {
  id: string
  customerId: string
  openedAt: string
  openedAtMs: number
  creditLimit: number
  drawnAmount: number
  status: AccountStatus
  /** When the account last drew funds. Drives the bust-out timing signal. */
  lastDrawAt: string | null
  lastDrawAtMs: number | null
}

export type IdentifierRow = {
  /** Namespaced and normalised, e.g. "addr:12a-mg-road-pune-411001". */
  value: string
  kind: IdentifierKind
  /** Kind-specific properties: os/model, city/pincode, ifsc, asn/isVpn. */
  props: Record<string, string | number | boolean>
}

export type LinkRow = {
  accountId: string
  value: string
  type: LinkType
  props: Record<string, string | number | boolean>
}

export type TransferRow = {
  from: string
  to: string
  amount: number
  ts: string
  tsMs: number
}

export type LoanRow = {
  id: string
  accountId: string
  amount: number
  appliedAt: string
  state: 'APPLIED' | 'APPROVED' | 'DISBURSED' | 'REPAID' | 'DEFAULTED'
}

export type FraudCaseRow = {
  id: string
  accountId: string
  openedAt: string
  openedBy: string
  note: string
}

/**
 * Ground truth. Not loaded into the graph -- if the planted answers were in
 * the database, "detection found six rings" would be circular. This file
 * exists so the README can state what was planted and the demo can show that
 * detection recovered it independently.
 */
export type GroundTruth = {
  seed: number
  generatedAt: string
  rings: Array<{
    label: string
    signature: string
    accountIds: string[]
    detectableBy: 'rule-engine-too' | 'graph-only'
    note: string
  }>
  noise: Array<{ label: string; accountIds: string[]; note: string }>
  counts: Record<string, number>
}
