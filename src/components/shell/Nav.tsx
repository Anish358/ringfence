import Link from 'next/link'
import { NavLink } from './NavLink'

const LINKS = [
  { href: '/', label: 'Ring Radar', hint: 'Detected clusters' },
  { href: '/how-it-works', label: 'How it works', hint: 'Why this needs a graph database' },
  { href: '/check', label: 'Applicant Check', hint: 'Before disbursement' },
  { href: '/paths', label: 'Path Finder', hint: 'Connection between two accounts' },
]

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:gap-8 sm:py-0">
        <Link href="/" className="flex items-center gap-2.5 sm:py-3.5">
          {/* Three nodes joined into a ring -- the product's whole thesis as a mark. */}
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="4" r="2.6" fill="var(--critical)" />
            <circle cx="4" cy="16" r="2.6" fill="var(--accent)" />
            <circle cx="18" cy="16" r="2.6" fill="var(--accent)" />
            <path d="M11 4 L4 16 M11 4 L18 16 M4 16 L18 16" stroke="var(--border-strong)" strokeWidth="1.3" fill="none" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight">Ringfence</span>
          <span className="hidden text-[11px] text-ink-3 sm:inline">fraud ring detection</span>
        </Link>

        <nav className="-mb-px flex gap-1 overflow-x-auto sm:ml-auto" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} hint={l.hint} />
          ))}
        </nav>
      </div>
    </header>
  )
}
