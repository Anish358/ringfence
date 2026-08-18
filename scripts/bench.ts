/**
 * scripts/bench.ts — time every query against the live instance, and check
 * that detection recovers the six planted rings.
 *
 * npx tsx --env-file-if-exists=.env.local scripts/bench.ts
 */
import { readFileSync } from 'node:fs'
import { closeDriver } from '@/lib/db'
import { detectRings, MAX_CYCLE_LEG } from '@/lib/detect'
import { sharedIdentifierGroups, accountFacts } from '@/queries/rings'
import { cycleCandidates, transferCycles } from '@/queries/cycles'
import { expandNeighbourhood, pathToKnownFraud, pathBetween } from '@/queries/traversal'
import { directMatches, proximityToFraud, toIdentifierValues } from '@/queries/applicant'
import { graphStats, ping } from '@/queries/health'

const gt = JSON.parse(readFileSync('data/ground-truth.json', 'utf8'))
const ring = (n: string) => gt.rings.find((r: any) => r.label.startsWith(n))

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now()
  const r = await fn()
  const n = Array.isArray(r) ? r.length : r === null ? 0 : 1
  const ms = Date.now() - t
  console.log(`  ${ms > 3000 ? 'SLOW' : ' ok '}  ${label.padEnd(38)} ${String(ms).padStart(6)}ms  ${String(n).padStart(5)} rows`)
  return r
}

async function main() {
  console.log('\n  Query timings (CognoDB free c0, 0.5 vCPU)\n  ' + '-'.repeat(64))
  await time('Q7  ping', () => ping())
  const stats = await time('Q7  graphStats', () => graphStats())

  const groups = await time('Q1  sharedIdentifierGroups', () => sharedIdentifierGroups())
  const cands = await time('Q4a cycleCandidates', () => cycleCandidates(MAX_CYCLE_LEG))
  const cycles = await time('Q4b transferCycles', () => transferCycles(cands, MAX_CYCLE_LEG))

  const r1 = ring('Ring 1').accountIds[5]
  await time('Q2  expand depth 1', () => expandNeighbourhood(r1, '1'))
  await time('Q2  expand depth 2', () => expandNeighbourhood(r1, '2'))
  await time('Q2  expand depth 3', () => expandNeighbourhood(r1, '3'))

  const r3 = ring('Ring 3').accountIds
  await time('Q3  pathToKnownFraud', () => pathToKnownFraud(r3[0]))
  await time('Q3b pathBetween (chain ends)', () => pathBetween(r3[0], r3[4]))

  const vals = toIdentifierValues({ address: '12/A, M.G. Road, Pune - 411001' })
  await time('Q5a directMatches', () => directMatches(vals))
  await time('Q5b proximityToFraud', () => proximityToFraud(vals))

  const t0 = Date.now()
  const rings = await detectRings()
  console.log(`\n  Full detection pipeline: ${Date.now() - t0}ms -> ${rings.length} rings\n`)

  // -- did we get the planted rings back? ----------------------------------
  console.log('  Ground truth recovery\n  ' + '-'.repeat(64))
  let missed = 0
  for (const planted of gt.rings) {
    const want = new Set<string>(planted.accountIds)
    const hit = rings.find((r) => r.memberIds.filter((m) => want.has(m)).length >= Math.ceil(want.size * 0.8))
    const rank = hit ? rings.indexOf(hit) + 1 : 0
    if (!hit) missed++
    console.log(
      `  ${hit ? ' ok ' : 'MISS'}  ${planted.label.padEnd(30)} ` +
      (hit ? `${hit.displayId.padEnd(11)} risk ${String(hit.risk).padStart(3)}  #${String(rank).padStart(2)} of ${rings.length}  ${hit.memberIds.length} members` : 'not detected'),
    )
  }

  console.log('\n  Top 8 by risk\n  ' + '-'.repeat(64))
  for (const r of rings.slice(0, 8)) {
    const tags = r.signals.map((s) => s.code).join(',') || '-'
    console.log(`  ${r.displayId.padEnd(11)} risk ${String(r.risk).padStart(3)}  ${String(r.memberIds.length).padStart(3)} members  Rs ${String(r.exposure).padStart(8)}  ${r.linkTypes.length} kinds  ${tags}`)
  }

  console.log('\n  Lowest-risk clusters (the innocent ones)\n  ' + '-'.repeat(64))
  for (const r of rings.slice(-4)) {
    console.log(`  ${r.displayId.padEnd(11)} risk ${String(r.risk).padStart(3)}  ${String(r.memberIds.length).padStart(3)} members  ${r.linkTypes.join(',')}  ${r.signals.map(s=>s.code).join(',') || '-'}`)
  }

  console.log(`\n  graph: ${stats.accounts} accounts, ${stats.identifiers} identifiers, ${stats.transfers} transfers, ${stats.confirmedCases} cases`)
  console.log(`  ${missed === 0 ? 'All six planted rings recovered.' : missed + ' PLANTED RING(S) MISSED'}\n`)
  await closeDriver()
  process.exit(missed === 0 ? 0 : 1)
}
main().catch(async (e) => { console.error(e); await closeDriver(); process.exit(1) })
