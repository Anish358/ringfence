/**
 * GET /api/graph/expand?accountId=…&depth=1|2|3
 * ---------------------------------------------------------------------------
 * A ROUTE HANDLER rather than a Server Component, because this read is
 * triggered by a click inside the canvas. A Server Component renders once;
 * this must answer repeatedly without a navigation.
 *
 * Input is validated with Zod at the boundary. The depth in particular MUST be
 * validated, because it selects a pre-built query string from a frozen map --
 * see src/queries/traversal.ts for why a parameter cannot be used there.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DepthSchema, expandNeighbourhood } from '@/queries/traversal'
import { toAppError } from '@/lib/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  accountId: z.string().min(1).max(64),
  depth: DepthSchema,
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    accountId: url.searchParams.get('accountId') ?? '',
    depth: url.searchParams.get('depth') ?? '1',
  })

  if (!parsed.success) {
    return NextResponse.json({ message: 'Provide an accountId and a depth of 1, 2 or 3.' }, { status: 400 })
  }

  try {
    const edges = await expandNeighbourhood(parsed.data.accountId, parsed.data.depth)
    return NextResponse.json({ edges })
  } catch (e) {
    const err = toAppError(e)
    return NextResponse.json({ message: err.message, code: err.code }, { status: err.status })
  }
}
