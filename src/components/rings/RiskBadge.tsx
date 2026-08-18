import { RISK_LABEL, riskBand } from '@/lib/format'

const TONE = {
  critical: 'bg-critical-soft text-critical border-critical/25',
  elevated: 'bg-elevated-soft text-elevated border-elevated/25',
  low: 'bg-low-soft text-low border-low/25',
} as const

/**
 * The score is rendered as a number AND a band colour AND a verb ("Investigate
 * now"). Three encodings of the same fact, because an analyst scanning fifty
 * rows reads the colour, and an analyst deciding reads the verb -- and colour
 * alone would fail anyone who cannot distinguish red from amber.
 */
export function RiskBadge({ risk, size = 'md' }: { risk: number; size?: 'sm' | 'md' | 'lg' }) {
  const band = riskBand(risk)
  const dims =
    size === 'lg' ? 'h-[74px] w-[74px] text-[30px]' : size === 'sm' ? 'h-11 w-11 text-[17px]' : 'h-[58px] w-[58px] text-[23px]'

  return (
    <div className={`flex shrink-0 flex-col items-center justify-center rounded-md border ${TONE[band]} ${dims}`}>
      <span className="tnum font-semibold leading-none">{risk}</span>
      <span className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-wider opacity-75">risk</span>
    </div>
  )
}

export function RiskLabel({ risk }: { risk: number }) {
  const band = riskBand(risk)
  const color = band === 'critical' ? 'text-critical' : band === 'elevated' ? 'text-elevated' : 'text-low'
  return <span className={`text-[12px] font-semibold ${color}`}>{RISK_LABEL[band]}</span>
}
