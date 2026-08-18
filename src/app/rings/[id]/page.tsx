/**
 * Investigation Canvas — one ring, drawn.
 *
 * The shell is a Server Component that fetches everything the view needs in
 * parallel and hands it to one client subtree. Only the canvas and its panel
 * ship JavaScript to the browser.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRing } from '@/lib/detect-cached'
import { internalTransfers, memberDetails, memberLinks } from '@/queries/subgraph'
import { buildCanvasGraph } from '@/lib/graph-model'
import { Investigation } from '@/components/rings/Investigation'
import { ErrorState } from '@/components/states'
import { toAppError } from '@/lib/errors'
import { RiskBadge, RiskLabel } from '@/components/rings/RiskBadge'
import { SignalPill } from '@/components/rings/SignalPill'
import { LINK_LABEL, rupees, rupeesExact, shortIdentifier } from '@/lib/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function RingPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a Promise from Next 15 onward.
  const { id } = await params

  // Classified on the server for the same reason as Ring Radar: Next redacts
  // Server Component error messages before error.tsx sees them, so a database
  // failure caught here can still say WHICH failure it was.
  let ring, links, transfers, details
  try {
    ring = await getRing(id)
    if (!ring) notFound()
    ;[links, transfers, details] = await Promise.all([
      memberLinks(ring.memberIds),
      internalTransfers(ring.memberIds),
      memberDetails(ring.memberIds),
    ])
  } catch (e) {
    // notFound() works by throwing, so it must be allowed through.
    if ((e as { digest?: string })?.digest === 'NEXT_NOT_FOUND') throw e
    const err = toAppError(e)
    return <div className="py-4"><ErrorState title="Could not load this ring" message={err.message} /></div>
  }

  const graph = buildCanvasGraph(ring.memberIds, links, transfers)

  return (
    <>
      <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M11 7H3M6.5 3.5 3 7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Ring Radar
      </Link>

      <header className="mb-5 flex flex-wrap items-start gap-4">
        <RiskBadge risk={ring.risk} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-[21px] font-semibold tracking-tight">{ring.displayId}</h1>
            <RiskLabel risk={ring.risk} />
          </div>
          <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed text-ink-2">
            {ring.memberIds.length} accounts.{' '}
            {ring.sharedBy.length > 0 ? (
              <>
                Joined through{' '}
                {ring.sharedBy.slice(0, 3).map((s, i) => (
                  <span key={s.value}>
                    {i > 0 ? ', ' : ''}
                    <span className="font-medium text-ink">{LINK_LABEL[s.kind]}</span>{' '}
                    <span className="font-mono text-[12.5px]">{shortIdentifier(s.value)}</span>{' '}
                    <span className="text-ink-3">({s.count})</span>
                  </span>
                ))}
                {ring.sharedBy.length > 3 && <> and {ring.sharedBy.length - 3} more</>}.
              </>
            ) : (
              <>No shared identifiers at all — this ring exists only in the money movement.</>
            )}
          </p>
          {ring.signals.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {ring.signals.map((s) => <SignalPill key={s.code} signal={s} />)}
            </div>
          )}
        </div>

        <div className="flex gap-5 text-right">
          <div>
            <p className="eyebrow">Drawn</p>
            <p className="tnum mt-0.5 text-[18px] font-semibold">{rupees(ring.exposure)}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{rupeesExact(ring.exposure)}</p>
          </div>
          <div>
            <p className="eyebrow">Still drawable</p>
            <p className="tnum mt-0.5 text-[18px] font-semibold text-elevated">{rupees(ring.atRisk)}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{ring.activeCount} active accounts</p>
          </div>
        </div>
      </header>

      <WhatToNotice ring={ring} />

      <Investigation graph={graph} details={details} expandableFrom={ring.memberIds} />

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <ScoreBreakdown breakdown={ring.breakdown} risk={ring.risk} />
        {ring.cycles.length > 0 && <CycleTable cycles={ring.cycles} />}
      </section>
    </>
  )
}

/**
 * A plain-language sentence naming the single most interesting thing about THIS
 * ring, assembled from what was actually computed.
 *
 * Without it, a reader who is not a fraud analyst sees a network diagram and
 * has no idea whether they are looking at something clever or something
 * obvious. Naming it removes the need to already know.
 */
function WhatToNotice({ ring }: { ring: Awaited<ReturnType<typeof getRing>> & {} }) {
  const points: string[] = []

  if (ring.indirectPairs > 0) {
    points.push(
      `${ring.indirectPairs} of the ${ring.totalPairs} pairs of accounts here share nothing at all with each other — no device, no address, no bank account, no IP. They are in one ring only because a chain of the others connects them. This is the case a conventional "find accounts sharing a device" query can never return, at any depth.`,
    )
  }
  if (ring.cycles.length > 0) {
    points.push(
      `Money moves in ${ring.cycles.length} closed loop${ring.cycles.length > 1 ? 's' : ''} between these accounts — it leaves one and comes back to it. Small circular transfers make dormant accounts look active and creditworthy before a bust-out. There is no clean way to express this query in SQL at all.`,
    )
  }
  if (ring.signals.some((s) => s.code === 'BURST')) {
    points.push(
      'Three or more of these accounts drew almost their entire credit limit within the same 72-hour window, after sitting quiet. That is the bust-out signature.',
    )
  }
  if (ring.signals.some((s) => s.code === 'HOUSEHOLD')) {
    points.push(
      'These accounts share one address and nothing else, and no money moves between them. That is what a family looks like, which is why the score is low — the system is meant to tell this apart from a ring, not flag everyone who is connected.',
    )
  }
  if (ring.confirmedCount > 0) {
    points.push(
      `${ring.confirmedCount} of these accounts ${ring.confirmedCount === 1 ? 'is' : 'are'} already confirmed fraud. Everything connected to them is now measurable by distance from a known-bad account.`,
    )
  }

  if (points.length === 0) return null

  return (
    <section className="mb-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
      <h2 className="text-[13px] font-semibold text-ink">What to notice here</h2>
      <ul className="mt-2 space-y-2">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
            <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The score, itemised. An analyst who cannot see why a number is 79 will
 * either ignore it or over-trust it; showing the arithmetic is what makes it
 * usable evidence rather than an oracle.
 */
function ScoreBreakdown({ breakdown, risk }: { breakdown: Record<string, number>; risk: number }) {
  const LABEL: Record<string, string> = {
    structural: 'Shared infrastructure, weighted by kind',
    diversity: 'Mix of different identifier kinds',
    size: 'Number of accounts',
    cycles: 'Circular money transfers',
    knownFraud: 'Contains a confirmed fraud account',
    coTimedDrawdown: 'Full drawdowns within 72 hours',
  }
  const rows = Object.entries(breakdown).filter(([, v]) => v > 0)

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold">How this score was reached</h2>
      </div>
      <dl className="divide-y divide-line text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="text-ink-2">{LABEL[k] ?? k}</dt>
            <dd className="tnum font-medium">+{Math.round(v)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 bg-surface-2 px-4 py-2.5">
          <dt className="font-semibold">Risk score</dt>
          <dd className="tnum text-[15px] font-semibold">{risk}</dd>
        </div>
      </dl>
    </div>
  )
}

function CycleTable({ cycles }: { cycles: Array<{ accounts: string[]; legs: number; totalMoved: number }> }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold">Circular transfers</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
          Money leaving an account and returning to it. Small amounts moved in loops make
          dormant accounts look active and creditworthy before a bust-out.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="eyebrow px-4 py-2 font-semibold">Loop</th>
              <th className="eyebrow px-4 py-2 text-right font-semibold">Legs</th>
              <th className="eyebrow px-4 py-2 text-right font-semibold">Moved</th>
            </tr>
          </thead>
          <tbody>
            {cycles.slice(0, 8).map((c, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-mono text-[11.5px]">
                  {c.accounts.map((a) => a.replace(/^ACC-0*/, '#')).join(' → ')} →{' '}
                  {c.accounts[0].replace(/^ACC-0*/, '#')}
                </td>
                <td className="tnum px-4 py-2 text-right">{c.legs}</td>
                <td className="tnum px-4 py-2 text-right">{rupeesExact(Math.round(c.totalMoved))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
