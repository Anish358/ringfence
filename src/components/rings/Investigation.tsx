'use client'

/**
 * src/components/rings/Investigation.tsx
 * ---------------------------------------------------------------------------
 * The interactive half of the ring page: canvas, selection panel, and the two
 * decisions an analyst can record. The page shell around it stays a Server
 * Component, so only this subtree ships to the browser.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Canvas, CanvasLegend } from '@/components/graph/Canvas'
import type { CanvasGraph, CanvasNode } from '@/lib/graph-model'
import type { MemberDetail } from '@/queries/subgraph'
import { KIND_LABEL, LINK_LABEL, relativeTime, rupeesExact, shortIdentifier, STATUS_LABEL } from '@/lib/format'
import { clearAccountAction, confirmFraudAction } from '@/app/actions'

export function Investigation({
  graph,
  details,
  expandableFrom,
}: {
  graph: CanvasGraph
  details: MemberDetail[]
  expandableFrom: string[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [extra, setExtra] = useState<CanvasGraph | null>(null)
  const [expanding, setExpanding] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const detailsById = useMemo(() => new Map(details.map((d) => [d.id, d])), [details])

  // Expanded edges are merged into the drawn graph rather than replacing it, so
  // the original alert stays visible while the ring grows around it.
  const merged: CanvasGraph = useMemo(() => {
    if (!extra) return graph
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
    for (const n of extra.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n)
    const seen = new Set(graph.links.map((l) => `${l.source}|${l.target}|${l.kind}`))
    const links = [...graph.links]
    for (const l of extra.links) {
      const key = `${l.source}|${l.target}|${l.kind}`
      if (!seen.has(key)) { seen.add(key); links.push(l) }
    }
    return { nodes: [...nodes.values()], links, hiddenPrivateIdentifiers: graph.hiddenPrivateIdentifiers }
  }, [graph, extra])

  const selected = selectedId ? merged.nodes.find((n) => n.id === selectedId) ?? null : null

  async function expand(accountId: string) {
    setExpanding(true)
    setExpandError(null)
    try {
      const res = await fetch(`/api/graph/expand?accountId=${encodeURIComponent(accountId)}&depth=1`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setExpandError(body.message ?? 'Could not expand this node.'); return }

      const nodes = new Map<string, CanvasNode>()
      const links: CanvasGraph['links'] = []
      for (const e of body.edges as Array<{ source: any; target: any; kind: string }>) {
        for (const end of [e.source, e.target]) {
          if (!nodes.has(end.id)) {
            nodes.set(end.id, {
              id: end.id,
              kind: (end.label ?? 'Account') as CanvasNode['kind'],
              label: end.id,
              status: end.status ?? undefined,
            })
          }
        }
        links.push({ source: e.source.id, target: e.target.id, kind: e.kind })
      }
      setExtra({ nodes: [...nodes.values()], links, hiddenPrivateIdentifiers: 0 })
    } catch {
      setExpandError('Could not reach the server. Check your connection and retry.')
    } finally {
      setExpanding(false)
    }
  }

  function decide(kind: 'confirm' | 'clear', accountId: string) {
    startTransition(async () => {
      const result =
        kind === 'confirm'
          ? await confirmFraudAction(accountId, 'Confirmed from the Investigation Canvas.')
          : await clearAccountAction(accountId)

      if (result.ok) {
        setNotice({
          ok: true,
          text:
            kind === 'confirm'
              ? `${accountId} marked as confirmed fraud. It is now a seed point for Applicant Check.`
              : `${accountId} cleared.`,
        })
        // Re-render the server components so the new status reaches the canvas
        // colours, the ring score, and Ring Radar.
        router.refresh()
      } else {
        setNotice({ ok: false, text: result.message })
      }
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      <div className="flex flex-col gap-3">
        <div className="h-[440px] sm:h-[560px]">
          <Canvas graph={merged} selectedId={selectedId} onSelect={(n) => setSelectedId(n?.id ?? null)} />
        </div>
        <CanvasLegend hiddenPrivate={merged.hiddenPrivateIdentifiers} />
        {expandError && (
          <p role="alert" className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-[12.5px] text-critical">
            {expandError}
          </p>
        )}
      </div>

      <aside className="flex flex-col gap-3">
        {notice && (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 text-[12.5px] ${
              notice.ok ? 'border-low/30 bg-low-soft text-low' : 'border-critical/30 bg-critical-soft text-critical'
            }`}
          >
            {notice.text}
          </p>
        )}

        {!selected ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-5">
            <p className="eyebrow">Selection</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Click a circle to inspect an account, or a diamond to see what it joins.
              Drag to rearrange, scroll to zoom.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              Accounts that share infrastructure pull together under the force simulation, so a
              ring looks like a knot and the identifier bridging two knots sits between them.
            </p>
          </div>
        ) : selected.kind === 'Account' ? (
          <AccountPanel
            node={selected}
            detail={detailsById.get(selected.id)}
            pending={pending}
            expanding={expanding}
            canExpand={expandableFrom.includes(selected.id) || true}
            onExpand={() => expand(selected.id)}
            onConfirm={() => decide('confirm', selected.id)}
            onClear={() => decide('clear', selected.id)}
          />
        ) : (
          <IdentifierPanel node={selected} />
        )}
      </aside>
    </div>
  )
}

function AccountPanel({
  node, detail, pending, expanding, canExpand, onExpand, onConfirm, onClear,
}: {
  node: CanvasNode
  detail?: MemberDetail
  pending: boolean
  expanding: boolean
  canExpand: boolean
  onExpand: () => void
  onConfirm: () => void
  onClear: () => void
}) {
  const confirmed = detail?.isConfirmedFraud || node.status === 'FRAUD_CONFIRMED'

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow">Account</p>
        <p className="mt-1 font-mono text-[15px] font-semibold">{node.id}</p>
        {detail?.customerName && <p className="mt-0.5 text-[12.5px] text-ink-2">{detail.customerName}</p>}
      </div>

      <dl className="divide-y divide-line text-[12.5px]">
        <Row label="Status" value={STATUS_LABEL[detail?.status ?? node.status ?? ''] ?? '—'} tone={confirmed ? 'critical' : undefined} />
        <Row label="Credit limit" value={detail ? rupeesExact(detail.creditLimit) : '—'} mono />
        <Row label="Drawn" value={detail ? rupeesExact(detail.drawnAmount) : '—'} mono />
        <Row label="Last drawdown" value={relativeTime(detail?.lastDrawAt ?? null)} />
        <Row label="Opened" value={relativeTime(detail?.openedAt ?? null)} />
        <Row label="Loan" value={detail?.loanState ?? '—'} />
      </dl>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        {canExpand && (
          <button
            onClick={onExpand}
            disabled={expanding}
            className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-3 disabled:opacity-55"
          >
            {expanding ? 'Expanding…' : 'Expand neighbours'}
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={pending || confirmed}
            className="flex-1 rounded-md bg-critical px-3 py-2 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-45"
          >
            {confirmed ? 'Already confirmed' : pending ? 'Saving…' : 'Confirm fraud'}
          </button>
          <button
            onClick={onClear}
            disabled={pending}
            className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-45"
          >
            Clear
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          A decision is written back to the graph. Confirming makes this account a seed point,
          so the next applicant connected to it is caught automatically.
        </p>
      </div>
    </div>
  )
}

function IdentifierPanel({ node }: { node: CanvasNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <p className="eyebrow">{KIND_LABEL[node.kind] ?? node.kind}</p>
        <p className="mt-1 break-all font-mono text-[13px] font-semibold">{shortIdentifier(node.id)}</p>
      </div>
      <dl className="divide-y divide-line text-[12.5px]">
        <Row label="Shared in this ring" value={`${node.sharedBy ?? 0} accounts`} />
        <Row label="Across the portfolio" value={`${node.degree ?? 0} accounts`} />
        <Row label="Relationship" value={LINK_LABEL[`${node.kind === 'Device' ? 'USED_DEVICE' : node.kind === 'Address' ? 'RESIDES_AT' : node.kind === 'BankAccount' ? 'PAYS_OUT_TO' : 'LOGGED_IN_FROM'}`]} />
      </dl>
      <p className="px-4 py-3 text-[11px] leading-relaxed text-ink-3">
        This node is why the accounts around it are in one ring. Because it is a node rather
        than a column, the traversal can pass THROUGH it to reach accounts that share nothing
        with each other.
      </p>
    </div>
  )
}

function Row({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'critical' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`${mono ? 'font-mono tnum' : ''} ${tone === 'critical' ? 'font-semibold text-critical' : 'text-ink'} text-right`}>
        {value}
      </dd>
    </div>
  )
}
