/**
 * POST /api/applicant/check
 * A route handler because the user submits a form and needs to see loading and
 * error states without a navigation.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { directMatches, proximityToFraud, toIdentifierValues } from '@/queries/applicant'
import { assessApplicant } from '@/lib/applicant-risk'
import { toAppError } from '@/lib/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Validated at the boundary, then passed into Cypher as $parameters only. */
const BodySchema = z
  .object({
    deviceFingerprint: z.string().max(200).optional(),
    address: z.string().max(400).optional(),
    bankAccountNumber: z.string().max(40).optional(),
    bankIfsc: z.string().max(20).optional(),
    ipAddress: z.string().max(60).optional(),
  })
  .refine(
    (v) => Object.values(v).some((s) => typeof s === 'string' && s.trim().length > 0),
    { message: 'Enter at least one identifier to check.' },
  )

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ message: 'Expected a JSON body.' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Check the values and try again.' },
      { status: 400 },
    )
  }

  try {
    const values = toIdentifierValues(parsed.data)
    if (values.length === 0) {
      return NextResponse.json({ message: 'Enter at least one identifier to check.' }, { status: 400 })
    }

    const matches = await directMatches(values)
    // Only spend a traversal when there is something to traverse from.
    const proximity = matches.length > 0 ? await proximityToFraud(values) : []

    return NextResponse.json({
      resolvedValues: values,
      matches,
      proximity,
      assessment: assessApplicant(matches, proximity),
    })
  } catch (e) {
    const err = toAppError(e)
    return NextResponse.json({ message: err.message, code: err.code }, { status: err.status })
  }
}
