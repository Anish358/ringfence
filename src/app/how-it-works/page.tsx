/**
 * /how-it-works — the argument, in one screen.
 *
 * The README makes this case at length, but a reviewer with five minutes is
 * looking at the deployed app, not GitHub. This page has to answer "why does
 * this need a graph database" without assuming the reader knows what a graph
 * database is, and without them leaving the product to find out.
 *
 * Live figures are pulled from the graph so the claims are checkable rather
 * than decorative.
 */

import Link from 'next/link'
import { getRings } from '@/lib/detect-cached'
import { graphStats } from '@/queries/health'
import { MAX_IDENTIFIER_DEGREE } from '@/queries/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function HowItWorksPage() {
  const [stats, rings] = await Promise.all([graphStats(), getRings()]).catch(() => [null, []] as const)

  const chain = [...rings]
    .filter((r) => r.linkTypes.length >= 3 && r.indirectPairs > 0)
    .sort((a, b) => b.indirectPairs / b.totalPairs - a.indirectPairs / a.totalPairs)[0]
  const withCycles = rings.find((r) => r.cycles.length > 0)
  const household = [...rings].reverse().find((r) => r.signals.some((s) => s.code === 'HOUSEHOLD'))

  return (
    <div className="max-w-[76ch]">
      <h1 className="text-[22px] font-semibold tracking-tight">How this works</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
        Sixty seconds, no fraud-analysis background assumed.
      </p>

      {/* ---------------------------------------------------------------- */}
      <Section n={1} title="The attack">
        <p>
          Someone opens forty accounts on a lending app over six weeks, using different names,
          different phone numbers and different ID documents. Every single application passes
          its checks, because there is nothing wrong with any single application. Then, inside
          seventy-two hours, all forty draw their full credit limit and go silent.
        </p>
        <p className="font-medium text-ink">
          No account was suspicious. The fraud existed only in what the accounts had in common
          with <em>each other</em>.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={2} title="Why the obvious query misses it">
        <p>
          The obvious check is easy, and a normal database does it fine — find accounts using
          the same phone:
        </p>
        <pre className="my-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
{`SELECT device_id, COUNT(*) FROM account_devices
GROUP BY device_id HAVING COUNT(*) > 3;`}
        </pre>
        <p>
          That catches accounts sharing <em>one thing</em>. It cannot catch this:
        </p>

        <figure className="my-4 overflow-x-auto rounded-lg border border-line bg-surface p-4">
          <svg viewBox="0 0 700 180" className="mx-auto block h-auto w-full max-w-[660px]" role="img"
               aria-label="Four accounts A to D in a chain. A and B share an address, B and C share a bank account, C and D share a device. A and D share nothing.">
            <path d="M60 44 L60 30 L640 30 L640 44" fill="none" stroke="var(--critical)" strokeWidth="1.3" strokeDasharray="5 4" />
            <text x="350" y="22" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--critical)">
              A and D have nothing whatsoever in common
            </text>
            <g stroke="var(--border-strong)" strokeWidth="1.8" fill="none">
              <path d="M86 98 L156 98" /><path d="M212 98 L282 98" />
              <path d="M338 98 L408 98" /><path d="M464 98 L534 98" />
              <path d="M590 98 L614 98" />
            </g>
            <g fontFamily="ui-sans-serif, system-ui, sans-serif">
              {[['A', 60], ['B', 310], ['C', 560]].map(([l, x]) => (
                <g key={String(l)}>
                  <circle cx={Number(x)} cy="98" r="24" fill="var(--surface-3)" stroke="var(--border-strong)" strokeWidth="2" />
                  <text x={Number(x)} y="104" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">{l}</text>
                </g>
              ))}
              <circle cx="640" cy="98" r="24" fill="var(--surface-3)" stroke="var(--critical)" strokeWidth="2" />
              <text x="640" y="104" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">D</text>

              <g stroke="var(--accent)" strokeWidth="2" fill="var(--accent-soft)">
                <rect x="167" y="83" width="30" height="30" transform="rotate(45 182 98)" />
                <rect x="417" y="83" width="30" height="30" transform="rotate(45 432 98)" />
                <rect x="545" y="83" width="30" height="30" transform="rotate(45 560 98)" />
              </g>
              <g fontSize="10.5" fontWeight="600" fill="var(--accent)" textAnchor="middle">
                <text x="182" y="142">same</text><text x="182" y="154">address</text>
                <text x="432" y="142">same bank</text><text x="432" y="154">account</text>
                <text x="600" y="142">same</text><text x="600" y="154">device</text>
              </g>
            </g>
          </svg>
        </figure>

        <p>
          Each neighbouring pair shares exactly <strong>one</strong> thing. A shared-device rule
          finds C and D. A shared-address rule finds A and B. Nothing ever connects A to D — and
          A and D are in the same criminal ring.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={3} title="What this app does instead">
        <p>
          Every shared thing — each handset, address, bank account and IP — is stored as its own
          record that accounts <em>point at</em>. So &ldquo;A and D are connected&rdquo; becomes a
          question of whether you can walk from one to the other, through however many steps it
          takes. One query, and the number of steps is just a number you can change.
        </p>
        <pre className="my-3 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
{`MATCH path = shortestPath(
  (a:Account {id: $from})-[:USED_DEVICE|RESIDES_AT|PAYS_OUT_TO|LOGGED_IN_FROM*..6]-(b:Account)
)
RETURN path`}
        </pre>
        <p>
          The equivalent in SQL is a recursive query in which you hand-write the loop
          prevention, repeat the whole block once per kind of identifier, and still get back a
          <em> distance</em> rather than the route. And the route is the point: an investigator
          needs the chain of evidence, not a yes or no.
        </p>
        {chain && (
          <CheckIt
            href={`/rings/${chain.id}`}
            label={`See it live — ${chain.displayId}`}
            detail={`${chain.indirectPairs} of its ${chain.totalPairs} account pairs share nothing directly.`}
          />
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={4} title="And one thing SQL genuinely cannot express">
        <p>
          Before a bust-out, rings pass small amounts around in loops — A pays B pays C pays A —
          to make dormant accounts look active and creditworthy. Finding a loop is four lines
          here. In SQL there is no clean way to write it at all.
        </p>
        {withCycles && (
          <CheckIt
            href={`/rings/${withCycles.id}`}
            label={`See it live — ${withCycles.displayId}`}
            detail={`${withCycles.cycles.length} money loop${withCycles.cycles.length > 1 ? 's' : ''} detected between its members.`}
          />
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={5} title="Why it does not just flag everyone">
        <p>
          Plenty of innocent people share things. Families share an address. Colleagues share an
          office network. Couples share a bank account. A tool that flagged all of them would be
          switched off in a week.
        </p>
        <p>
          So each kind of link is weighted by how incriminating it actually is — sharing a payout
          account is far more suspicious than sharing an IP — and anything shared by more than{' '}
          {MAX_IDENTIFIER_DEGREE} accounts is thrown out entirely, because that is a coffee shop,
          not a conspiracy. Every score is itemised on the ring page so you can see the reasoning
          rather than trust a number.
        </p>
        {household && (
          <CheckIt
            href={`/rings/${household.id}`}
            label={`See a benign one — ${household.displayId}`}
            detail={`Relatives at one address. Scored ${household.risk} out of 100, and labelled as a probable household.`}
          />
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={6} title="What you are looking at">
        {stats && (
          <dl className="my-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Fig label="Accounts" value={stats.accounts.toLocaleString('en-IN')} />
            <Fig label="Shared identifiers" value={stats.identifiers.toLocaleString('en-IN')} />
            <Fig label="Money transfers" value={stats.transfers.toLocaleString('en-IN')} />
            <Fig label="Known fraud cases" value={String(stats.confirmedCases)} />
          </dl>
        )}
        <p>
          The data is synthetic, because no lender publishes its fraud graph — and generating it
          bought something a download could not: <strong>six rings were planted deliberately</strong>,
          each with a different signature, so &ldquo;the system found six rings&rdquo; is a claim
          you can verify rather than take on trust. Alongside them sit deliberate false positives
          — sixty families, a college network, fifteen couples — so you can see the difference
          between a ring and a coincidence.
        </p>
        <p className="text-[12.5px] text-ink-3">
          Marking an account as fraud writes the decision back into the graph, so the next
          applicant connected to it is caught automatically. That is the loop the product closes.
        </p>
      </Section>

      <div className="mt-7 flex flex-wrap gap-2.5 border-t border-line pt-5">
        <Link href="/" className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-text hover:bg-accent-hover">
          Start with the worst cluster
        </Link>
        <Link href="/check" className="rounded-md border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
          Check an applicant
        </Link>
        <Link href="/paths" className="rounded-md border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
          Connect any two accounts
        </Link>
      </div>
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 border-t border-line pt-5">
      <h2 className="flex items-baseline gap-2.5 text-[15px] font-semibold">
        <span className="tnum text-[11px] font-bold text-ink-3">{String(n).padStart(2, '0')}</span>
        {title}
      </h2>
      <div className="mt-2 space-y-2.5 text-[13.5px] leading-relaxed text-ink-2">{children}</div>
    </section>
  )
}

function CheckIt({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={href}
      className="group mt-3 flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 hover:border-accent/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-accent">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-2">{detail}</span>
      </span>
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-accent transition-transform group-hover:translate-x-0.5" aria-hidden="true">
        <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  )
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="tnum mt-0.5 text-[16px] font-semibold text-ink">{value}</dd>
    </div>
  )
}
