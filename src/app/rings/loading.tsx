/**
 * Shown automatically while the Ring Radar Server Component awaits its queries.
 * Detection takes a few seconds against a free-tier instance, so this is not
 * decoration -- it is the difference between a considered wait and a page that
 * looks broken.
 *
 * The skeleton mirrors the real card layout rather than showing a spinner, so
 * the content does not jump when it arrives.
 */

import { RingCardSkeleton, SkeletonLine } from '@/components/states'

export default function Loading() {
  return (
    <>
      <div className="mb-6 max-w-[68ch] space-y-2.5">
        <SkeletonLine w="180px" h={20} />
        <SkeletonLine w="100%" />
        <SkeletonLine w="72%" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface px-4 py-3">
            <SkeletonLine w="60%" h={9} />
            <div className="mt-2"><SkeletonLine w="45%" h={19} /></div>
            <div className="mt-2"><SkeletonLine w="70%" h={9} /></div>
          </div>
        ))}
      </div>
      <div className="mb-2.5"><SkeletonLine w="110px" h={9} /></div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }).map((_, i) => <RingCardSkeleton key={i} />)}
      </div>
    </>
  )
}
