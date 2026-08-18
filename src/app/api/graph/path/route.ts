/**
 * GET /api/graph/path?from=…&to=…
 * The Path Finder. Small, and the purest demonstration of the thing a
 * relational database cannot express: give me the route, not a boolean.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { pathBetween } from '@/queries/traversal'
import { toAppError } from '@/lib/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
  })

  if (!parsed.success) {
    return NextResponse.json({ message: 'Provide two account ids.' }, { status: 400 })
  }
  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json({ message: 'Pick two different accounts.' }, { status: 400 })
  }

  try {
    const path = await pathBetween(parsed.data.from, parsed.data.to)
    return NextResponse.json({ path })
  } catch (e) {
    const err = toAppError(e)
    return NextResponse.json({ message: err.message, code: err.code }, { status: err.status })
  }
}
