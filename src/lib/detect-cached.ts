/**
 * src/lib/detect-cached.ts — the cached entry point for Server Components
 * ---------------------------------------------------------------------------
 * Ring detection is three queries plus union-find, and measures ~7s against a
 * free-tier instance. Asking a burstable 0.5 vCPU database to redo that on
 * every page view would make the app feel broken and could exhaust the
 * instance's CPU credits during a review.
 *
 * So it is cached for 60 seconds, and tagged. When an analyst confirms or
 * clears an account, the Server Action calls revalidateTag('rings') and the
 * next render recomputes -- so a decision is reflected immediately, while
 * ordinary navigation is served from cache.
 *
 * This wrapper lives in its own module because next/cache cannot be imported
 * outside a Next runtime, and detect.ts is also used by scripts/bench.ts.
 */

import { unstable_cache } from 'next/cache'
import { detectRings } from './detect'
import type { Ring } from './cluster'

export const RINGS_TAG = 'rings'

export const getRings = unstable_cache(
  async (): Promise<Ring[]> => detectRings(),
  ['ringfence:rings'],
  { revalidate: 60, tags: [RINGS_TAG] },
)

export async function getRing(id: string): Promise<Ring | null> {
  const rings = await getRings()
  return rings.find((r) => r.id === id) ?? null
}
