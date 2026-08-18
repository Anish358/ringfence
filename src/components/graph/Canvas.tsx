'use client'

/**
 * src/components/graph/Canvas.tsx — the Investigation Canvas
 * ---------------------------------------------------------------------------
 * A force-directed graph, chosen over a flowchart library for one reason: a
 * fraud ring physically CLUMPS under a force simulation. Eight accounts hanging
 * off one device collapse into a visible knot, and the single bank account
 * bridging two knots sits between them where an analyst cannot miss it. That
 * spatial intuition is the product. A dagre-laid flowchart would show the same
 * edges and none of the shape.
 *
 * react-force-graph-2d touches `window` at import time, so it must be loaded
 * with ssr: false or the production build fails while prerendering.
 */

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasGraph, CanvasNode } from '@/lib/graph-model'
import { LINK_LABEL, shortIdentifier } from '@/lib/format'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-lg" />,
})

/** Read the live theme values so the canvas matches light and dark. */
function usePalette() {
  const [p, setP] = useState({
    account: '#94a3b8', flagged: '#92510a', fraud: '#a32116', cleared: '#1b6349',
    identifier: '#1f4796', line: '#b8c2d1', money: '#a32116', text: '#111827', surface: '#ffffff',
  })
  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f
    setP({
      account: v('--border-strong', '#94a3b8'),
      flagged: v('--elevated', '#92510a'),
      fraud: v('--critical', '#a32116'),
      cleared: v('--low', '#1b6349'),
      identifier: v('--accent', '#1f4796'),
      line: v('--border-strong', '#b8c2d1'),
      money: v('--critical', '#a32116'),
      text: v('--text', '#111827'),
      surface: v('--surface', '#ffffff'),
    })
  }, [])
  return p
}

export function Canvas({
  graph,
  selectedId,
  onSelect,
}: {
  graph: CanvasGraph
  selectedId: string | null
  onSelect: (node: CanvasNode | null) => void
}) {
  const palette = usePalette()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 520 })

  // The canvas is fixed-pixel, so it needs a real measurement rather than a
  // percentage. ResizeObserver keeps it correct through sidebar toggles too.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // react-force-graph MUTATES the objects it is given, adding x/y/vx/vy. Passing
  // props straight through would mean mutating React state, so it gets copies.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    }),
    [graph],
  )

  const nodeColor = useCallback(
    (n: CanvasNode) => {
      if (n.kind !== 'Account') return palette.identifier
      if (n.status === 'FRAUD_CONFIRMED') return palette.fraud
      if (n.status === 'CLEARED') return palette.cleared
      if (n.status === 'DEFAULTED') return palette.flagged
      return palette.account
    },
    [palette],
  )

  /**
   * Accounts are circles, identifiers are diamonds. A categorical difference
   * encoded as SHAPE as well as colour, so the two kinds stay distinguishable
   * in a screenshot, in greyscale, and for a colour-blind reviewer.
   */
  const drawNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, scale: number) => {
      const isAccount = node.kind === 'Account'
      const selected = node.id === selectedId
      // Identifiers grow with how many accounts they join -- the bridge in a
      // ring should be the biggest thing on screen.
      const r = isAccount ? 6 : 5 + Math.min(6, (node.sharedBy ?? 2) * 0.9)
      const color = nodeColor(node)

      ctx.save()
      if (selected) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 4.5, 0, 2 * Math.PI)
        ctx.strokeStyle = palette.text
        ctx.lineWidth = 1.6 / scale
        ctx.stroke()
      }

      ctx.beginPath()
      if (isAccount) {
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      } else {
        ctx.moveTo(node.x, node.y - r)
        ctx.lineTo(node.x + r, node.y)
        ctx.lineTo(node.x, node.y + r)
        ctx.lineTo(node.x - r, node.y)
        ctx.closePath()
      }
      ctx.fillStyle = isAccount ? color : palette.surface
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.8 / scale
      ctx.stroke()

      // Labels only once zoomed in, otherwise they overlap into mush.
      if (scale > 1.4) {
        const label = isAccount ? node.id.replace(/^ACC-0*/, '#') : shortIdentifier(node.id)
        ctx.font = `${isAccount ? 600 : 400} ${9 / scale}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = palette.text
        ctx.fillText(label, node.x, node.y + r + 2.5 / scale)
      }
      ctx.restore()
    },
    [nodeColor, palette, selectedId],
  )

  if (graph.nodes.length === 0) {
    return (
      <div ref={wrapRef} className="flex h-full items-center justify-center rounded-lg border border-line bg-surface-2">
        <p className="text-[13px] text-ink-3">Nothing to draw for this ring.</p>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="h-full w-full overflow-hidden rounded-lg border border-line bg-surface-2">
      <ForceGraph2D
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, 9, 0, 2 * Math.PI)
          ctx.fill()
        }}
        linkColor={(l: any) => (l.kind === 'TRANSFERRED' ? palette.money : palette.line)}
        linkWidth={(l: any) => (l.kind === 'TRANSFERRED' ? 1.6 : 1)}
        // Money moves in a direction; sharing a device does not. Only the
        // directed relationship gets an arrow.
        linkDirectionalArrowLength={(l: any) => (l.kind === 'TRANSFERRED' ? 3.2 : 0)}
        linkDirectionalArrowRelPos={0.62}
        linkLabel={(l: any) =>
          l.kind === 'TRANSFERRED' ? `sent ₹${l.amount}` : (LINK_LABEL[l.kind] ?? l.kind)
        }
        onNodeClick={(n: any) => onSelect(n as CanvasNode)}
        onBackgroundClick={() => onSelect(null)}
        cooldownTicks={90}
        d3VelocityDecay={0.32}
      />
    </div>
  )
}

export function CanvasLegend({ hiddenPrivate }: { hiddenPrivate: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-ink-2">
      <Key shape="circle" color="var(--border-strong)" label="Account" />
      <Key shape="circle" color="var(--critical)" label="Confirmed fraud" />
      <Key shape="circle" color="var(--elevated)" label="Defaulted" />
      <Key shape="circle" color="var(--low)" label="Cleared" />
      <Key shape="diamond" color="var(--accent)" label="Shared identifier" />
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--critical)" strokeWidth="1.6" /></svg>
        Money transfer
      </span>
      {hiddenPrivate > 0 && (
        <span className="text-ink-3">
          {hiddenPrivate} identifier{hiddenPrivate > 1 ? 's' : ''} used by only one member hidden
        </span>
      )}
    </div>
  )
}

function Key({ shape, color, label }: { shape: 'circle' | 'diamond'; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {shape === 'circle' ? (
          <circle cx="6" cy="6" r="4.5" fill={color} />
        ) : (
          <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="var(--surface)" stroke={color} strokeWidth="1.6" />
        )}
      </svg>
      {label}
    </span>
  )
}
