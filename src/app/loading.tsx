import { SkeletonLine } from '@/components/states'

/** Landing-page skeleton. It queries live figures, so it does await something. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="space-y-4 pt-6 pb-9 sm:pt-12 sm:pb-14">
        <SkeletonLine w="220px" h={10} />
        <SkeletonLine w="min(90%, 620px)" h={42} />
        <SkeletonLine w="min(80%, 540px)" h={40} />
        <div className="flex gap-2.5 pt-3">
          <div className="skeleton h-10 w-40 rounded-md" />
          <div className="skeleton h-10 w-44 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 border-y border-line py-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonLine w="60%" h={22} />
            <SkeletonLine w="85%" h={10} />
          </div>
        ))}
      </div>
      <div className="py-9"><div className="skeleton h-[220px] rounded-lg" /></div>
    </div>
  )
}
