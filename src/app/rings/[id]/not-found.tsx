import Link from 'next/link'
import { EmptyState } from '@/components/states'

/**
 * Reached when a ring id does not resolve -- a stale bookmark, or a cluster
 * that no longer forms one because an analyst's decisions changed the graph.
 * The second case is a real workflow event, not an error, so the copy says so.
 */
export default function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="That ring no longer exists"
      body={
        <>
          Either the link is stale, or the accounts no longer cluster together — clearing
          members can dissolve a ring, which is a normal outcome of investigating one.
        </>
      }
      action={
        <Link href="/" className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-text hover:bg-accent-hover">
          Back to Ring Radar
        </Link>
      }
    />
  )
}
