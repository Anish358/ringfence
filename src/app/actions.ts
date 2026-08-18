'use server'

/**
 * src/app/actions.ts — Server Actions
 * ---------------------------------------------------------------------------
 * Writes go through Server Actions rather than route handlers, for two
 * concrete reasons rather than fashion:
 *
 *   1. revalidateTag lets a mutation invalidate the cached ring detection, so
 *      Ring Radar reflects the decision on the next render with no client-side
 *      invalidation logic to write or forget.
 *   2. The action calls the same src/queries/ function a route handler would.
 *      The transport differs; the Cypher lives in exactly one place.
 *
 * Every action returns a discriminated result instead of throwing, because the
 * caller is a button that needs to show a message, not a page that can unmount
 * into an error boundary.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { clearAccount, confirmFraud } from '@/queries/mutations'
import { RINGS_TAG } from '@/lib/detect-cached'
import { toAppError } from '@/lib/errors'

export type ActionResult =
  | { ok: true; accountId: string; status: string }
  | { ok: false; message: string }

/** The analyst who is signed in. No auth in this build -- see the README. */
const ANALYST = 'demo.analyst'

export async function confirmFraudAction(accountId: string, note: string): Promise<ActionResult> {
  try {
    const row = await confirmFraud({ accountId, analyst: ANALYST, note: note.trim() || 'Confirmed from Investigation Canvas.' })
    if (!row) return { ok: false, message: `Account ${accountId} no longer exists.` }
    // The decision changes both membership scoring and the account's colour on
    // every canvas, so the whole detection result is invalidated.
    //
    // Next 16 requires a cache-life profile alongside the tag; 'max' means
    // "expire it now and do not hold a stale copy". revalidatePath is belt and
    // braces for the route caches that render from it.
    revalidateTag(RINGS_TAG, 'max')
    revalidatePath('/')
    return { ok: true, accountId: row.accountId, status: row.status }
  } catch (e) {
    return { ok: false, message: toAppError(e).message }
  }
}

export async function clearAccountAction(accountId: string): Promise<ActionResult> {
  try {
    const row = await clearAccount({ accountId, analyst: ANALYST })
    if (!row) return { ok: false, message: `Account ${accountId} no longer exists.` }
    revalidateTag(RINGS_TAG, 'max')
    revalidatePath('/')
    return { ok: true, accountId: row.accountId, status: row.status }
  } catch (e) {
    return { ok: false, message: toAppError(e).message }
  }
}
