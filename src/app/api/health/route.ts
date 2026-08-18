/**
 * GET /api/health — is the database reachable?
 * Polled by DbStatusBanner so a degraded system is visible on every page
 * rather than only when a user happens to click something that fails.
 */

import { NextResponse } from 'next/server'
import { ping } from '@/queries/health'
import { toAppError } from '@/lib/errors'

// neo4j-driver opens raw TCP sockets, which the Edge runtime cannot do.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ping()
    return NextResponse.json({ ok: true })
  } catch (e) {
    const err = toAppError(e)
    return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: err.status })
  }
}
