/**
 * The landing page.
 *
 * A reviewer arrives cold, is not a fraud analyst, and has a few minutes. The
 * brief also says they should see the point before reading anything -- so this
 * is deliberately NOT a marketing page. Every number on it is queried from the
 * live graph at request time, and the planted-versus-recovered table is a real
 * verification run, not a claim: the six planted rings are read from the
 * generator's ground-truth file and matched against what detection actually
 * returned, right now.
 *
 * If a reader wants the argument rather than the evidence, /how-it-works has it.
 * If they want to get straight to work, one click does that.
 */

import Link from 'next/link'
import { getRings } from '@/lib/detect-cached'
import { graphStats } from '@/queries/health'
import { rupees } from '@/lib/format'
import groundTruth from '../../data/ground-truth.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PlantedRing = {
  label: string
  signature: string
  accountIds: string[]
  detectableBy: 'rule-engine-too' | 'graph-only'
}

export default async function LandingPage() {
  const [stats, rings] = await Promise.all([graphStats(), getRings()]).catch(
    () => [null, [] as Awaited<ReturnType<typeof getRings>>] as const,
  )

  const planted = (groundTruth as { rings: PlantedRing[] }).rings

  // A planted ring counts as recovered when a detected cluster contains at
  // least 80% of its members. Not 100%: an analyst's decisions can legitimately
  // move an account, and the claim being made is "detection found this ring",
  // not "detection reproduced the generator exactly".
  const recovery = planted.map((p) => {
    const want = new Set(p.accountIds)
    const hit = rings.find(
      (r) => r.memberIds.filter((m) => want.has(m)).length >= Math.ceil(want.size * 0.8),
    )
    return { planted: p, found: hit ?? null, rank: hit ? rings.indexOf(hit) + 1 : null }
  })

  const recovered = recovery.filter((r) => r.found).length
  const exposure = rings.reduce((s, r) => s + r.exposure, 0)
  const graphOnly = planted.filter((p) => p.detectableBy === 'graph-only').length
  const offline = stats === null

  return (
    <div className="mx-auto max-w-[1080px]">
      {/* ---------------------------------------------------------------- */}
      <section className="pt-6 pb-9 sm:pt-12 sm:pb-14">
        <p className="eyebrow">Fraud ring detection · graph database · CognoDB</p>
        <h1 className="mt-3 max-w-[24ch] text-[34px] font-semibold leading-[1.06] tracking-[-0.022em] sm:text-[46px]">
          The account was clean. The <span className="text-critical">ring</span> was not.
        </h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-ink-2">
          Forty loan applications pass every check individually, then draw their full limits
          inside seventy-two hours and vanish. The fraud was never in any one account — it was
          in what the accounts quietly had in common. Ringfence stores those shared things as
          connections you can <em>walk along</em>, which is how it finds rings whose members
          share nothing with each other at all.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <Link
            href="/rings"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-accent-text transition-colors hover:bg-accent-hover"
          >
            Open the console
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-md border border-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Why a graph database?
          </Link>
          <span className="text-[12px] text-ink-3">No sign-in. Live data.</span>
        </div>
      </section>

      {/* -- live figures, so the page proves itself ---------------------- */}
      {!offline && (
        <dl className="grid grid-cols-2 gap-2.5 border-y border-line py-4 sm:grid-cols-4">
          <Fig value={stats.accounts.toLocaleString('en-IN')} label="Accounts in the portfolio" />
          <Fig value={String(rings.length)} label="Clusters detected right now" />
          <Fig value={rupees(exposure)} label="Drawn by clustered accounts" tone="critical" />
          <Fig value={`${recovered} of ${planted.length}`} label="Planted rings recovered" tone="low" />
        </dl>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="py-9 sm:py-12">
        <h2 className="text-[19px] font-semibold tracking-tight">The pattern a table cannot hold</h2>
        <p className="mt-2 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-2">
          Four accounts. Each neighbouring pair shares exactly one thing, so a rule looking for
          shared devices catches one pair and a rule looking for shared addresses catches
          another — but nothing ever connects the two ends, and all four belong to one ring.
        </p>

        <figure className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface p-5">
          <svg viewBox="0 0 700 176" className="mx-auto block h-auto w-full max-w-[660px]" role="img"
               aria-label="Accounts A through D in a chain. A and B share an address, B and C share a bank account, C and D share a device. A and D share nothing at all.">
            <path d="M60 42 L60 28 L640 28 L640 42" fill="none" stroke="var(--critical)" strokeWidth="1.3" strokeDasharray="5 4" />
            <text x="350" y="20" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--critical)">
              A and D share nothing — no rule will ever connect them
            </text>
            <g stroke="var(--border-strong)" strokeWidth="1.8" fill="none">
              <path d="M86 96 L156 96" /><path d="M212 96 L282 96" />
              <path d="M338 96 L408 96" /><path d="M464 96 L534 96" />
              <path d="M590 96 L614 96" />
            </g>
            <g fontFamily="ui-sans-serif, system-ui, sans-serif">
              {([['A', 60], ['B', 310], ['C', 560]] as Array<[string, number]>).map(([l, x]) => (
                <g key={l}>
                  <circle cx={x} cy="96" r="24" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="2" />
                  <text x={x} y="102" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">{l}</text>
                </g>
              ))}
              <circle cx="640" cy="96" r="24" fill="var(--surface-3)" stroke="var(--critical)" strokeWidth="2" />
              <text x="640" y="102" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">D</text>
              <g stroke="var(--accent)" strokeWidth="2" fill="var(--accent-soft)">
                <rect x="167" y="81" width="30" height="30" transform="rotate(45 182 96)" />
                <rect x="417" y="81" width="30" height="30" transform="rotate(45 432 96)" />
                <rect x="545" y="81" width="30" height="30" transform="rotate(45 560 96)" />
              </g>
              <g fontSize="10.5" fontWeight="600" fill="var(--accent)" textAnchor="middle">
                <text x="182" y="140">same</text><text x="182" y="152">address</text>
                <text x="432" y="140">same bank</text><text x="432" y="152">account</text>
                <text x="600" y="140">same</text><text x="600" y="152">device</text>
              </g>
            </g>
          </svg>
        </figure>
      </section>

      {/* -- planted vs recovered: a verification run, not a claim -------- */}
      {!offline && (
        <section className="border-t border-line py-9 sm:py-12">
          <h2 className="text-[19px] font-semibold tracking-tight">Six rings were planted. Here is what detection found.</h2>
          <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-ink-2">
            The dataset is generated, which buys something a downloaded one cannot: known ground
            truth. Six rings were planted deliberately, each with a different signature — so
            &ldquo;the system works&rdquo; is checkable rather than asserted. This table is
            matched against live detection output every time the page loads.{' '}
            <strong className="text-ink">Two of the six are catchable by a conventional rule engine,
            on purpose</strong>, because that baseline is what makes the other {graphOnly} interesting.
          </p>

          <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[620px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow px-4 py-2.5 font-semibold">Planted</th>
                  <th className="eyebrow px-4 py-2.5 font-semibold">Signature</th>
                  <th className="eyebrow px-4 py-2.5 font-semibold">Found?</th>
                  <th className="eyebrow px-4 py-2.5 text-right font-semibold">Risk</th>
                </tr>
              </thead>
              <tbody>
                {recovery.map(({ planted: p, found, rank }) => (
                  <tr key={p.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{p.label.replace(/^Ring \d+ — /, '')}</span>
                      {p.detectableBy === 'graph-only' ? (
                        <span className="ml-2 inline-block rounded border border-accent/30 bg-accent-soft px-1.5 py-[1px] text-[10px] font-semibold text-accent">
                          graph only
                        </span>
                      ) : (
                        <span className="ml-2 inline-block rounded border border-line bg-surface-2 px-1.5 py-[1px] text-[10px] font-medium text-ink-3">
                          a rule finds this too
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{p.signature}</td>
                    <td className="px-4 py-2.5">
                      {found ? (
                        <Link href={`/rings/${found.id}`} className="font-mono font-medium text-accent hover:underline">
                          {found.displayId}
                          <span className="ml-1.5 font-sans text-[11px] text-ink-3">#{rank} of {rings.length}</span>
                        </Link>
                      ) : (
                        <span className="text-critical">not detected</span>
                      )}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-semibold">{found ? found.risk : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[12px] text-ink-3">
            Alongside them sit deliberate false positives — sixty families sharing an address, a
            college network with forty accounts, fifteen couples sharing a bank account. They are
            in the data so you can watch them score low instead of being flagged.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="grid gap-3 border-t border-line py-9 sm:grid-cols-3 sm:py-12">
        <Capability
          href="/rings"
          title="Detect"
          body="Group accounts by any chain of shared infrastructure, however long, and rank the clusters by how organised the pattern looks."
          cta="Ring Radar"
        />
        <Capability
          href="/rings"
          title="Investigate"
          body="See the ring as a diagram, trace how members connect, pull in accounts the alert missed, and record a verdict that writes back into the graph."
          cta="Investigation Canvas"
        />
        <Capability
          href="/check"
          title="Prevent"
          body="Screen a new application before disbursement and get back the shortest chain of evidence to a confirmed fraud account — not a yes or no."
          cta="Applicant Check"
        />
      </section>

      <section className="border-t border-line py-6">
        <p className="max-w-[74ch] text-[12px] leading-relaxed text-ink-3">
          Synthetic data, real fraud patterns. Built on CognoDB — openCypher over Bolt, through
          the official Neo4j driver — with the detection queries, the data model and the
          reasoning behind every decision written up in the{' '}
          <a href="https://github.com/Anish358/ringfence" className="font-medium text-accent hover:underline">
            repository README
          </a>
          . {offline && 'The database is currently unreachable, so live figures are hidden.'}
        </p>
      </section>
    </div>
  )
}

function Fig({ value, label, tone }: { value: string; label: string; tone?: 'critical' | 'low' }) {
  const color = tone === 'critical' ? 'text-critical' : tone === 'low' ? 'text-low' : 'text-ink'
  return (
    <div>
      <dd className={`tnum text-[24px] font-semibold leading-none ${color}`}>{value}</dd>
      <dt className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{label}</dt>
    </div>
  )
}

function Capability({ href, title, body, cta }: { href: string; title: string; body: string; cta: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border border-line bg-surface px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <h3 className="text-[14.5px] font-semibold">{title}</h3>
      <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-ink-2">{body}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent">
        {cta}
        <svg width="12" height="12" viewBox="0 0 14 14" className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  )
}
