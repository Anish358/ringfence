/**
 * Ring Radar — the triage queue, and the landing page.
 *
 * A SERVER COMPONENT that queries the graph during render. There is no API
 * route and no client fetch here, because nothing on this page is triggered by
 * a user interaction: the data is needed to render at all. loading.tsx
 * provides the skeleton while this awaits.
 */

import Link from 'next/link'
import { getRings } from '@/lib/detect-cached'
import { graphStats } from '@/queries/health'
import { MIN_RING_SIZE, MAX_IDENTIFIER_DEGREE } from '@/queries/constants'
import { RingCard } from '@/components/rings/RingCard'
import { EmptyState, ErrorState, NoDataState } from '@/components/states'
import { rupees } from '@/lib/format'
import { toAppError } from '@/lib/errors'

// The driver needs raw TCP, which Edge cannot provide.
export const runtime = 'nodejs'
// Never prerender live data at build time -- a build with no database reachable
// must still succeed and fail gracefully at request time instead.
export const dynamic = 'force-dynamic'

export default async function RingRadarPage() {
  /**
   * The database failure is caught HERE, on the server, rather than being left
   * to error.tsx. That is not defensive habit -- it is forced by how Next
   * handles Server Component errors in production.
   *
   * A thrown error does reach error.tsx, but Next REDACTS its message first, to
   * avoid leaking server internals to the browser. The boundary therefore
   * receives "An error occurred in the Server Components render" and nothing
   * about credentials or reachability, so toAppError cannot classify it and the
   * user gets a generic message for every possible cause.
   *
   * Catching it here, where the original Neo4jError still exists, means the
   * page can say "the database rejected these credentials" rather than
   * "something went wrong" -- and can distinguish that from "the instance is
   * down", which has a completely different fix. error.tsx remains the backstop
   * for anything this does not anticipate.
   */
  let stats: Awaited<ReturnType<typeof graphStats>>
  let rings: Awaited<ReturnType<typeof getRings>>
  try {
    ;[stats, rings] = await Promise.all([graphStats(), getRings()])
  } catch (e) {
    const err = toAppError(e)
    return (
      <>
        <PageHead />
        <ErrorState
          title={err.code === 'DB_AUTH' ? 'The database rejected the credentials' : 'Cannot reach the database'}
          message={err.message}
        />
      </>
    )
  }

  if (stats.accounts === 0) {
    return (
      <>
        <PageHead />
        <NoDataState />
      </>
    )
  }

  const critical = rings.filter((r) => r.risk >= 60)
  const exposure = rings.reduce((s, r) => s + r.exposure, 0)
  const atRisk = rings.reduce((s, r) => s + r.atRisk, 0)

  return (
    <>
      <PageHead />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Rings detected" value={String(rings.length)} note={`clusters of ${MIN_RING_SIZE}+ accounts`} />
        <Stat label="Investigate now" value={String(critical.length)} note="risk 60 or above" tone="critical" />
        <Stat label="Already drawn" value={rupees(exposure)} note="across all rings" />
        <Stat label="Still drawable" value={rupees(atRisk)} note="on active members" tone="elevated" />
      </dl>

      {rings.length === 0 ? (
        <EmptyState
          icon="ok"
          title="No rings above the threshold"
          body={
            <>
              {stats.accounts.toLocaleString('en-IN')} accounts scanned and nothing formed a cluster of{' '}
              {MIN_RING_SIZE} or more. That is a clean portfolio, not an error.
            </>
          }
        />
      ) : (
        <>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="eyebrow">Ranked by risk</h2>
            <p className="text-[11.5px] text-ink-3">
              identifiers shared by more than {MAX_IDENTIFIER_DEGREE} accounts excluded
            </p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {rings.map((ring) => (
              <li key={ring.id}>
                <RingCard ring={ring} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function PageHead() {
  return (
    <div className="mb-6 max-w-[68ch]">
      <h1 className="text-[22px] font-semibold tracking-tight">Ring Radar</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
        Each row is a group of accounts that look unrelated one at a time, but share
        infrastructure — a handset, a payout account, a doorway, a network. Ranked by how
        much the pattern looks organised rather than coincidental.{' '}
        <Link href="/check" className="font-medium text-accent hover:underline">
          Check a new applicant
        </Link>{' '}
        before disbursement.
      </p>
    </div>
  )
}

function Stat({
  label, value, note, tone,
}: { label: string; value: string; note: string; tone?: 'critical' | 'elevated' }) {
  const color = tone === 'critical' ? 'text-critical' : tone === 'elevated' ? 'text-elevated' : 'text-ink'
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className={`tnum mt-1 text-[21px] font-semibold leading-none ${color}`}>{value}</dd>
      <dd className="mt-1.5 text-[11.5px] text-ink-3">{note}</dd>
    </div>
  )
}
