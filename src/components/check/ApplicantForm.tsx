'use client'

import { useState } from 'react'
import { fetchJson, useAsync } from '@/hooks/useAsync'
import { PathChain } from '@/components/PathChain'
import { EmptyState, ErrorState } from '@/components/states'
import { KIND_LABEL, shortIdentifier, STATUS_LABEL } from '@/lib/format'
import type { ApplicantInput, DirectMatch, FraudProximity } from '@/queries/applicant'
import type { ApplicantAssessment } from '@/lib/applicant-risk'
import type { ExampleApplicant } from '@/queries/applicant'

type CheckResponse = {
  resolvedValues: string[]
  matches: DirectMatch[]
  proximity: FraudProximity[]
  assessment: ApplicantAssessment
}

const EMPTY: ApplicantInput = {
  deviceFingerprint: '', address: '', bankAccountNumber: '', bankIfsc: '', ipAddress: '',
}

export function ApplicantForm({ examples }: { examples: ExampleApplicant[] }) {
  const [input, setInput] = useState<ApplicantInput>(EMPTY)
  const { data, error, isLoading, run, reset } = useAsync((body: ApplicantInput) =>
    fetchJson<CheckResponse>('/api/applicant/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

  const set = (k: keyof ApplicantInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput((p) => ({ ...p, [k]: e.target.value }))

  const filled = Object.values(input).some((v) => (v ?? '').trim().length > 0)

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <form
        onSubmit={(e) => { e.preventDefault(); run(input) }}
        className="rounded-lg border border-line bg-surface"
      >
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Application details</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Any one field is enough. Values are normalised the same way the loader
            normalised them, so spelling variants of an address still match.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4">
          <Field label="Device fingerprint" value={input.deviceFingerprint ?? ''} onChange={set('deviceFingerprint')} placeholder="a4f7c2…" mono />
          <Field label="Address" value={input.address ?? ''} onChange={set('address')} placeholder="12/A, M.G. Road, Pune - 411001" />
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Bank account" value={input.bankAccountNumber ?? ''} onChange={set('bankAccountNumber')} placeholder="000123456789" mono />
            <Field label="IFSC" value={input.bankIfsc ?? ''} onChange={set('bankIfsc')} placeholder="HDFC0001234" mono />
          </div>
          <Field label="IP address" value={input.ipAddress ?? ''} onChange={set('ipAddress')} placeholder="103.21.44.10" mono />
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <button
            type="submit"
            disabled={isLoading || !filled}
            className="rounded-md bg-accent px-3.5 py-2.5 text-[13px] font-semibold text-accent-text hover:bg-accent-hover disabled:opacity-45"
          >
            {isLoading ? 'Checking the graph…' : 'Run check'}
          </button>

          {examples.length > 0 && (
            <div className="mt-1">
              <p className="eyebrow mb-1.5">Or try an example</p>
              <div className="flex flex-col gap-1.5">
                {examples.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => { const next = { ...EMPTY, ...ex.input }; setInput(next); reset(); run(next) }}
                    className="rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-[12px] hover:bg-surface-3"
                  >
                    <span className="font-semibold text-ink">{ex.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{ex.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </form>

      <div>
        {error ? (
          <ErrorState title="Check failed" message={error} onRetry={() => run(input)} />
        ) : isLoading ? (
          <div className="space-y-3">
            <div className="skeleton h-[104px] rounded-lg" />
            <div className="skeleton h-[190px] rounded-lg" />
          </div>
        ) : !data ? (
          <EmptyState
            icon="search"
            title="No check run yet"
            body="Enter an identifier, or pick one of the examples. The result shows every existing account that shares anything with this applicant, and the shortest chain to a confirmed fraud account."
          />
        ) : (
          <Result data={data} />
        )}
      </div>
    </div>
  )
}

function Result({ data }: { data: CheckResponse }) {
  const { assessment: a } = data
  const tone =
    a.verdict === 'REJECT' ? 'border-critical/30 bg-critical-soft text-critical'
    : a.verdict === 'REVIEW' ? 'border-elevated/30 bg-elevated-soft text-elevated'
    : 'border-low/30 bg-low-soft text-low'

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border px-4 py-4 ${tone}`}>
        <div className="flex items-start gap-3">
          <span className="tnum text-[30px] font-semibold leading-none">{a.score}</span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-wider opacity-70">{a.verdict}</p>
            <p className="mt-0.5 text-[14px] font-semibold leading-snug">{a.headline}</p>
          </div>
        </div>
        {a.reasons.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-current/15 pt-3">
            {a.reasons.map((r) => (
              <li key={r.text} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="opacity-90">{r.text}</span>
                <span className="tnum shrink-0 font-semibold">+{r.weight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {a.nearestFraud && (
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">
              Shortest connection to confirmed fraud — {a.nearestFraud.hops} hops
            </h2>
            <p className="mt-1 text-[12px] text-ink-2">
              This chain is the evidence. A relational query can tell you the accounts are
              related; it cannot hand back the route.
            </p>
          </div>
          <div className="px-4 py-4">
            <PathChain chain={a.nearestFraud.chain} links={a.nearestFraud.links} startLabel="NEW APPLICANT" />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">
            {data.matches.length === 0 ? 'No existing accounts share these identifiers' : `${data.matches.length} existing accounts share an identifier`}
          </h2>
        </div>
        {data.matches.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] leading-relaxed text-ink-2">
            The values resolved cleanly but matched nothing in the portfolio. That is the
            expected result for a genuine new customer.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow px-4 py-2 font-semibold">Account</th>
                  <th className="eyebrow px-4 py-2 font-semibold">Status</th>
                  <th className="eyebrow px-4 py-2 font-semibold">Shared</th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((m) => (
                  <tr key={m.accountId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-mono font-medium">{m.accountId}</td>
                    <td className="px-4 py-2">
                      <span className={m.isConfirmedFraud ? 'font-semibold text-critical' : 'text-ink-2'}>
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-2">
                      {m.sharedVia.map((s) => (
                        <span key={s.value} className="mr-2 inline-block">
                          {KIND_LABEL[s.kind] ?? s.kind}{' '}
                          <span className="font-mono text-[11.5px]">{shortIdentifier(s.value)}</span>
                          {s.degree > 8 && <span className="text-ink-3"> ·{s.degree} accounts</span>}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent ${mono ? 'font-mono' : ''}`}
      />
    </label>
  )
}
