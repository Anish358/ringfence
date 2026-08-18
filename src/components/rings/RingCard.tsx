import Link from 'next/link'
import type { Ring } from '@/lib/cluster'
import { LINK_LABEL, rupees } from '@/lib/format'
import { RiskBadge, RiskLabel } from './RiskBadge'
import { SignalPill } from './SignalPill'

/**
 * One row of the triage queue.
 *
 * The information order is deliberate and matches how the decision is actually
 * made: how bad (risk), what it is (what they share), how much (money), then
 * the action. WHAT CONNECTS THEM is given the most horizontal space, because
 * that is the sentence the analyst repeats to a colleague -- "eleven accounts
 * across two devices and one bank account" -- and it is the thing no
 * rules-based alert would ever tell them.
 */
export function RingCard({ ring }: { ring: Ring }) {
  const kinds = ring.sharedBy.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1
    return acc
  }, {})

  const connective = Object.entries(kinds).map(
    ([kind, count]) => `${count} ${LINK_LABEL[kind] ?? kind}${count > 1 ? 's' : ''}`,
  )

  return (
    <Link
      href={`/rings/${ring.id}`}
      className="group flex items-stretch gap-4 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2 sm:gap-5"
    >
      <RiskBadge risk={ring.risk} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="font-mono text-[14px] font-semibold tracking-tight">{ring.displayId}</h2>
          <RiskLabel risk={ring.risk} />
        </div>

        <p className="mt-1.5 text-[13.5px] leading-snug text-ink">
          <span className="tnum font-semibold">{ring.memberIds.length}</span> accounts
          {connective.length > 0 ? (
            <> connected by <span className="text-ink-2">{connective.join(', ')}</span></>
          ) : (
            <> connected only by <span className="text-ink-2">circular money transfers</span></>
          )}
        </p>

        <p className="mt-1 text-[12px] text-ink-3">
          {ring.confirmedCount > 0 && (
            <>
              <span className="tnum font-medium text-elevated">{ring.confirmedCount} already flagged</span>
              <span className="mx-1.5 opacity-40">·</span>
            </>
          )}
          <span className="tnum">{ring.activeCount} still active</span>
        </p>

        {ring.signals.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {ring.signals.map((s) => <SignalPill key={s.code} signal={s} />)}
          </div>
        )}
      </div>

      <div className="hidden shrink-0 flex-col items-end justify-between text-right sm:flex">
        <div>
          <p className="eyebrow">Drawn</p>
          <p className="tnum mt-0.5 text-[17px] font-semibold">{rupees(ring.exposure)}</p>
          {ring.atRisk > 0 && (
            <p className="tnum mt-0.5 text-[11.5px] text-ink-3">{rupees(ring.atRisk)} still drawable</p>
          )}
        </div>
        <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
          Investigate
          <svg width="13" height="13" viewBox="0 0 14 14" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">
            <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </Link>
  )
}
