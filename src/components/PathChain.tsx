/**
 * A path, rendered as the evidence chain an analyst reads aloud.
 *
 * This component is the answer to "why a graph database" in visual form. SQL
 * can tell you two accounts are connected; it cannot hand back the route. The
 * route is what goes in the case file.
 */

import { KIND_LABEL, LINK_LABEL, shortIdentifier } from '@/lib/format'

export function PathChain({
  chain,
  links,
  startLabel,
}: {
  chain: Array<{ label: string; value: string }>
  links: string[]
  startLabel?: string
}) {
  return (
    <ol className="text-[12.5px]">
      {startLabel && (
        <li className="flex items-start gap-2.5 pb-1">
          <Dot tone="accent" />
          <span className="font-semibold text-accent">{startLabel}</span>
        </li>
      )}
      {chain.map((node, i) => {
        const isAccount = node.label === 'Account'
        const incoming = startLabel ? links[i - 1] : links[i - 1]
        return (
          <li key={`${node.value}-${i}`} className="flex items-start gap-2.5" style={{ paddingLeft: `${Math.min(i, 8) * 14}px` }}>
            <div className="flex flex-col items-center pt-1">
              {i > 0 || startLabel ? <span className="h-2.5 w-px bg-line-strong" aria-hidden="true" /> : null}
              <Dot tone={isAccount ? (i === chain.length - 1 ? 'critical' : 'default') : 'identifier'} />
            </div>
            <div className="min-w-0 pb-1.5">
              {(i > 0 || startLabel) && incoming && (
                <p className="text-[11px] text-ink-3">{LINK_LABEL[incoming] ?? incoming}</p>
              )}
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="eyebrow">{KIND_LABEL[node.label] ?? node.label}</span>
                <span className="font-mono text-[12.5px] font-medium text-ink">
                  {isAccount ? node.value : shortIdentifier(node.value)}
                </span>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Dot({ tone }: { tone: 'default' | 'critical' | 'identifier' | 'accent' }) {
  const color =
    tone === 'critical' ? 'var(--critical)' : tone === 'identifier' ? 'var(--accent)' : tone === 'accent' ? 'var(--accent)' : 'var(--border-strong)'
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" className="shrink-0" aria-hidden="true">
      {tone === 'identifier' ? (
        <path d="M5.5 0.8 L10.2 5.5 L5.5 10.2 L0.8 5.5 Z" fill="var(--surface)" stroke={color} strokeWidth="1.6" />
      ) : (
        <circle cx="5.5" cy="5.5" r="4" fill={color} />
      )}
    </svg>
  )
}
