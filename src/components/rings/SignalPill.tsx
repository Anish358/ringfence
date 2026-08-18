import type { RingSignal } from '@/lib/cluster'

/**
 * A signal is WHY the score is what it is. Showing the reasons next to the
 * number is what makes the score trustworthy rather than an oracle -- an
 * analyst who cannot see the reasoning will override it or ignore it.
 */
const TONE: Record<string, string> = {
  INDIRECT: 'bg-accent-soft text-accent border-accent/40 font-semibold',
  CYCLES: 'bg-critical-soft text-critical border-critical/25',
  BURST: 'bg-critical-soft text-critical border-critical/25',
  KNOWN: 'bg-elevated-soft text-elevated border-elevated/25',
  MIXED: 'bg-accent-soft text-accent border-accent/25',
  HOUSEHOLD: 'bg-low-soft text-low border-low/25',
}

export function SignalPill({ signal }: { signal: RingSignal }) {
  return (
    <span
      title={signal.detail}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONE[signal.code] ?? 'bg-surface-3 text-ink-2 border-line'}`}
    >
      {signal.label}
    </span>
  )
}
