'use client'

import { useState } from 'react'
import { fetchJson, useAsync } from '@/hooks/useAsync'
import { PathChain } from '@/components/PathChain'
import { EmptyState, ErrorState } from '@/components/states'
import type { FraudPath } from '@/queries/traversal'

type PathResponse = { path: FraudPath | null }

export function PathFinder({ examplePair }: { examplePair: [string, string] | null }) {
  const [from, setFrom] = useState(examplePair?.[0] ?? '')
  const [to, setTo] = useState(examplePair?.[1] ?? '')
  const { data, error, isLoading, run } = useAsync((f: string, t: string) =>
    fetchJson<PathResponse>(`/api/graph/path?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`),
  )

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => { e.preventDefault(); run(from.trim(), to.trim()) }}
        className="rounded-lg border border-line bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="eyebrow mb-1 block">From account</span>
            <input
              value={from} onChange={(e) => setFrom(e.target.value)} placeholder="ACC-02022"
              className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-2 font-mono text-[12.5px] focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">To account</span>
            <input
              value={to} onChange={(e) => setTo(e.target.value)} placeholder="ACC-02026"
              className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-2 font-mono text-[12.5px] focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={isLoading || !from.trim() || !to.trim()}
            className="rounded-md bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-text hover:bg-accent-hover disabled:opacity-45"
          >
            {isLoading ? 'Searching…' : 'Find path'}
          </button>
        </div>
        {examplePair && (
          <p className="mt-2.5 text-[11.5px] text-ink-3">
            Prefilled with the two ends of the chain ring — they share no identifier with
            each other at all.
          </p>
        )}
      </form>

      {error ? (
        <ErrorState title="Could not search" message={error} onRetry={() => run(from.trim(), to.trim())} />
      ) : isLoading ? (
        <div className="skeleton h-[240px] rounded-lg" />
      ) : !data ? (
        <EmptyState
          icon="search"
          title="No search run yet"
          body="Enter two account ids. If a chain of shared devices, addresses, bank accounts or IPs connects them, the shortest one is drawn out."
        />
      ) : !data.path ? (
        <EmptyState
          icon="ok"
          title="No connection within five hops"
          body="These two accounts share no chain of identifiers at that depth. A longer search would cost more than the answer is worth on a free-tier instance."
        />
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">
              Connected in {data.path.hops} hop{data.path.hops > 1 ? 's' : ''}
            </h2>
            <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-ink-2">
              In Cypher this is <code className="font-mono">shortestPath()</code> over a
              variable-length pattern — four lines. In SQL it is a recursive CTE where you
              hand-write the cycle prevention, hand-track the depth, and still get back a
              length rather than the route.
            </p>
          </div>
          <div className="px-4 py-4">
            <PathChain chain={data.path.chain} links={data.path.links} />
          </div>
        </div>
      )}
    </div>
  )
}
