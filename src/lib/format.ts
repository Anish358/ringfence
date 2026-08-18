/**
 * src/lib/format.ts — presentation helpers
 * Kept out of components so the same rupee or risk-band logic cannot drift
 * between the ring card, the canvas panel and the applicant verdict.
 */

/**
 * Indian lending amounts are read in lakh and crore, not millions. A risk
 * analyst scanning a queue reads "Rs 4.2L" instantly and "Rs 420,000" slowly.
 */
export function rupees(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)}Cr`
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}k`
  return `₹${amount}`
}

export function rupeesExact(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export type RiskBand = 'critical' | 'elevated' | 'low'

/**
 * Three bands, not a gradient. An analyst's next action is different for each
 * -- investigate now, review today, dismiss -- and a continuous colour ramp
 * hides that boundary rather than showing it.
 */
export function riskBand(risk: number): RiskBand {
  if (risk >= 60) return 'critical'
  if (risk >= 30) return 'elevated'
  return 'low'
}

export const RISK_LABEL: Record<RiskBand, string> = {
  critical: 'Investigate now',
  elevated: 'Review',
  low: 'Likely benign',
}

/** Human names for relationship types. The graph's vocabulary is not the UI's. */
export const LINK_LABEL: Record<string, string> = {
  USED_DEVICE: 'same device',
  RESIDES_AT: 'same address',
  PAYS_OUT_TO: 'same bank account',
  LOGGED_IN_FROM: 'same IP',
  TRANSFERRED: 'sent money to',
  OWNS: 'owns',
  APPLIED_FOR: 'applied for',
  FLAGGED_AS: 'flagged as',
}

export const KIND_LABEL: Record<string, string> = {
  Device: 'Device',
  Address: 'Address',
  BankAccount: 'Bank account',
  IPAddress: 'IP address',
  Account: 'Account',
  Customer: 'Customer',
  Loan: 'Loan',
  FraudCase: 'Fraud case',
}

/**
 * Identifier values are namespaced and can be long. Show enough to compare two
 * of them side by side, and never the whole fingerprint.
 */
export function shortIdentifier(value: string): string {
  const [prefix, ...rest] = value.split(':')
  const body = rest.join(':')
  if (body.length <= 18) return body
  return `${body.slice(0, 10)}…${body.slice(-6)}`
}

export function identifierKindFromValue(value: string): string {
  const map: Record<string, string> = { dev: 'Device', addr: 'Address', bank: 'BankAccount', ip: 'IPAddress' }
  return map[value.split(':')[0]] ?? 'Account'
}

/** "3 days ago" reads faster than a date when triaging a queue. */
export function relativeTime(iso: string | null, nowMs = Date.parse('2026-08-15T00:00:00.000Z')): string {
  if (!iso) return '—'
  const diff = nowMs - Date.parse(iso)
  const day = 86_400_000
  if (diff < 0) return 'just now'
  if (diff < day) return 'today'
  if (diff < 2 * day) return 'yesterday'
  if (diff < 30 * day) return `${Math.floor(diff / day)} days ago`
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} months ago`
  return `${Math.floor(diff / (365 * day))} years ago`
}

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  DORMANT: 'Dormant',
  REPAID: 'Repaid',
  DEFAULTED: 'Defaulted',
  FRAUD_CONFIRMED: 'Confirmed fraud',
  CLEARED: 'Cleared',
}
