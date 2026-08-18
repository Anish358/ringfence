import { SkeletonLine } from '@/components/states'

export default function Loading() {
  return (
    <>
      <div className="mb-4"><SkeletonLine w="90px" h={11} /></div>
      <div className="mb-5 flex gap-4">
        <div className="skeleton h-[74px] w-[74px] rounded-md" />
        <div className="flex-1 space-y-2.5 py-1">
          <SkeletonLine w="150px" h={18} />
          <SkeletonLine w="90%" />
          <SkeletonLine w="60%" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
        <div className="skeleton h-[440px] rounded-lg sm:h-[560px]" />
        <div className="skeleton h-[300px] rounded-lg" />
      </div>
    </>
  )
}
