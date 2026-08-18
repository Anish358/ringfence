'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Split out as a client component purely because it needs usePathname to know
 * which tab is current. Keeping it small means the rest of the nav stays on
 * the server.
 */
export function NavLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  const pathname = usePathname()
  // /rings owns its detail pages, so the tab stays lit while investigating one.
  const active = href === '/rings' ? pathname.startsWith('/rings') : pathname === href

  return (
    <Link
      href={href}
      title={hint}
      aria-current={active ? 'page' : undefined}
      className={[
        'whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium transition-colors',
        active
          ? 'border-accent text-ink'
          : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}
