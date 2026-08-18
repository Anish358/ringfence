/**
 * src/lib/applicant-risk.ts — turn graph evidence into a disbursement decision
 * ---------------------------------------------------------------------------
 * Deliberately separate from the queries, so the policy can be read, argued
 * with and changed without touching Cypher. Every term is reported so the
 * screen can show its reasoning; an analyst overriding a score they cannot
 * explain is worse than no score.
 *
 * The weights are hand-tuned, not learned. That is the honest limitation of
 * this build: production would fit them against labelled outcomes. Stating so
 * is better than implying rigour that is not there.
 */

import { LINK_WEIGHTS, LINK_BY_KIND, MAX_IDENTIFIER_DEGREE } from '@/queries/constants'
import type { IdentifierKind } from '@/queries/constants'
import type { DirectMatch, FraudProximity } from '@/queries/applicant'

export type Verdict = 'REJECT' | 'REVIEW' | 'APPROVE'

export type ApplicantAssessment = {
  score: number
  verdict: Verdict
  headline: string
  reasons: Array<{ text: string; weight: number }>
  matchedAccounts: number
  confirmedFraudMatches: number
  nearestFraud: FraudProximity | null
}

const VERDICT_COPY: Record<Verdict, string> = {
  REJECT: 'High risk — recommend manual review before disbursement',
  REVIEW: 'Elevated risk — worth a second look',
  APPROVE: 'No meaningful connections found',
}

export function assessApplicant(
  matches: DirectMatch[],
  proximity: FraudProximity[],
): ApplicantAssessment {
  const reasons: Array<{ text: string; weight: number }> = []
  let score = 0

  const confirmed = matches.filter((m) => m.isConfirmedFraud)
  if (confirmed.length > 0) {
    const w = 45
    score += w
    reasons.push({
      text: `Directly shares an identifier with ${confirmed.length} confirmed fraud account${confirmed.length > 1 ? 's' : ''}`,
      weight: w,
    })
  }

  // Weight each shared identifier by kind, then DISCOUNT it by how many
  // accounts already touch that node. Sharing a handset with two people is
  // evidence; sharing an office IP with twenty is an artefact of geography.
  const seen = new Set<string>()
  let structural = 0
  for (const m of matches) {
    for (const s of m.sharedVia) {
      if (seen.has(s.value)) continue
      seen.add(s.value)
      const kind = s.kind as IdentifierKind
      const base = (LINK_WEIGHTS[LINK_BY_KIND[kind]] ?? 0.3) * 18
      const crowded = s.degree > MAX_IDENTIFIER_DEGREE ? 0.15 : s.degree > 8 ? 0.45 : 1
      structural += base * crowded
    }
  }
  if (structural > 0) {
    const w = Math.min(35, Math.round(structural))
    score += w
    reasons.push({
      text: `${seen.size} identifier${seen.size > 1 ? 's' : ''} already present in the portfolio, weighted by how incriminating each kind is`,
      weight: w,
    })
  }

  const nearest = proximity[0] ?? null
  if (nearest) {
    // Closer to known fraud is worse, and the effect falls off with distance.
    const w = Math.max(0, 30 - (nearest.hops - 1) * 9)
    if (w > 0) {
      score += w
      reasons.push({
        text: `${nearest.hops} hop${nearest.hops > 1 ? 's' : ''} from confirmed fraud account ${nearest.fraudAccount}`,
        weight: w,
      })
    }
  }

  if (matches.length >= 5) {
    const w = 8
    score += w
    reasons.push({ text: `Connected to ${matches.length} existing accounts`, weight: w })
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const verdict: Verdict = score >= 55 ? 'REJECT' : score >= 25 ? 'REVIEW' : 'APPROVE'

  return {
    score,
    verdict,
    headline: VERDICT_COPY[verdict],
    reasons: reasons.sort((a, b) => b.weight - a.weight),
    matchedAccounts: matches.length,
    confirmedFraudMatches: confirmed.length,
    nearestFraud: nearest,
  }
}
