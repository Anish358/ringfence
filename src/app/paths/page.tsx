/**
 * Path Finder — small, and the purest demonstration in the product.
 *
 * Pick any two accounts; get the shortest chain of shared infrastructure
 * between them. It exists because it isolates the single capability the whole
 * "why a graph database" argument rests on, with nothing else in the way.
 */

import { getRings } from '@/lib/detect-cached'
import { PathFinder } from '@/components/paths/PathFinder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function PathsPage() {
  // Prefill with the most interesting pair available: the two ends of whichever
  // ring mixes the most identifier kinds. In this dataset that is the chain
  // ring, whose ends share nothing directly -- the case a GROUP BY cannot find.
  const examplePair = await getRings()
    .then((rings) => {
      const chain = [...rings].sort((a, b) => b.linkTypes.length - a.linkTypes.length)[0]
      if (!chain || chain.memberIds.length < 2) return null
      return [chain.memberIds[0], chain.memberIds[chain.memberIds.length - 1]] as [string, string]
    })
    .catch(() => null)

  return (
    <>
      <div className="mb-6 max-w-[70ch]">
        <h1 className="text-[22px] font-semibold tracking-tight">Path Finder</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          Two accounts, and the shortest chain of shared devices, addresses, bank accounts or
          IP addresses that links them. Each hop passes through one shared identifier, so a
          three-hop answer means three pieces of infrastructure in common along the way — and
          possibly nothing at all in common between the two ends.
        </p>
      </div>
      <PathFinder examplePair={examplePair} />
    </>
  )
}
