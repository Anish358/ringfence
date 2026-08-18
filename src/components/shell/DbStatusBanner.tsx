'use client'

import { useEffect, useState } from 'react'

/**
 * A persistent banner shown on every page when the database cannot be reached.
 *
 * The brief asks for graceful handling when the database is unreachable, and
 * says they will test it. Without this, a user whose instance has died sees
 * individual screens fail one at a time and reasonably concludes their clicks
 * are not registering. One banner tells them the system is degraded, not their
 * input.
 *
 * Polling every 20s is a deliberate compromise: frequent enough that recovery
 * is noticed quickly, infrequent enough not to spend the free tier's CPU
 * credits on health checks.
 */
export function DbStatusBanner() {
  const [state, setState] = useState<{ ok: boolean; message?: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        const body = await res.json().catch(() => ({ ok: false }))
        if (!cancelled) setState({ ok: res.ok && body.ok === true, message: body.message })
      } catch {
        if (!cancelled) setState({ ok: false, message: 'Cannot reach the application server.' })
      }
    }

    check()
    const id = setInterval(check, 20_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Nothing is rendered while healthy, or before the first check resolves --
  // a banner that flashes "checking..." on every load is worse than silence.
  if (!state || state.ok) return null

  return (
    <div role="status" className="border-b border-critical/30 bg-critical-soft px-5 py-2.5">
      <div className="mx-auto flex max-w-[1400px] items-start gap-2.5 text-[13px] text-critical">
        <svg width="15" height="15" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden="true">
          <path d="M8 1.5 L15 14 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="11.8" r="0.85" fill="currentColor" />
        </svg>
        <p>
          <strong className="font-semibold">Database unreachable.</strong>{' '}
          {state.message ?? 'Check that the CognoDB instance is running.'} Data on screen may be stale.
        </p>
      </div>
    </div>
  )
}
