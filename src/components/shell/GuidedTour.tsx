'use client'

/**
 * src/components/shell/GuidedTour.tsx
 * ---------------------------------------------------------------------------
 * The brief asks for an app "a non-technical person could use to explore the
 * use case". Without this, a reviewer lands on a ranked list of ring ids and
 * risk scores and has no way to know which of them is interesting, or what a
 * good outcome even looks like. They are not fraud analysts, and the product
 * should not require them to be.
 *
 * So the home page opens with four concrete things to click, in order, each
 * naming what it will show and why it matters. The targets are COMPUTED from
 * the detected rings rather than hardcoded, so the tour stays correct if the
 * dataset is regenerated.
 *
 * Collapsible rather than dismissible: a reviewer who hides it and gets lost
 * has no way back, so the state persists but the panel never disappears.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'

export type TourStop = {
  n: number
  href: string
  title: string
  body: string
  proof?: string
}

const KEY = 'ringfence.tour.collapsed'

export function GuidedTour({ stops }: { stops: TourStop[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(KEY) === '1')
    setReady(true)
  }, [])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    window.localStorage.setItem(KEY, next ? '1' : '0')
  }

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-accent/30 bg-accent-soft">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ink">New here? Do these four things.</h2>
          <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-2">
            Every account below passed its own fraud checks. The point of this tool is that
            fraud can exist in the <em>connections between</em> accounts while every account
            looks clean on its own — and that a relational database structurally cannot find
            it. Takes about three minutes.
          </p>
        </div>
        <button
          onClick={toggle}
          className="shrink-0 rounded border border-accent/30 bg-surface px-2 py-1 text-[11px] font-medium text-accent hover:bg-surface-2"
          aria-expanded={!collapsed}
        >
          {ready && collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {(!ready || !collapsed) && (
        <ol className="grid gap-2 border-t border-accent/20 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          {stops.map((s) => (
            <li key={s.n}>
              <Link
                href={s.href}
                className="group flex h-full flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-accent/50 hover:bg-surface-2"
              >
                <span className="flex items-center gap-2">
                  <span className="tnum flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-text">
                    {s.n}
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink">{s.title}</span>
                </span>
                <span className="text-[11.5px] leading-snug text-ink-2">{s.body}</span>
                {s.proof && (
                  <span className="mt-auto font-mono text-[10.5px] leading-snug text-accent">{s.proof}</span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}

      <p className="border-t border-accent/20 px-4 py-2 text-[11.5px] text-ink-2">
        Prefer the short written version?{' '}
        <Link href="/how-it-works" className="font-medium text-accent hover:underline">
          How this works, in 60 seconds
        </Link>
      </p>
    </section>
  )
}
