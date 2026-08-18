/**
 * scripts/reset.ts — empty the database
 * ---------------------------------------------------------------------------
 * A single `MATCH (n) DETACH DELETE n` over ~25,000 relationships builds one
 * enormous transaction and will exhaust 256 MB of heap on a free c0 instance.
 * Deleting in bounded batches keeps each transaction small.
 *
 * Schema is dropped last, and only after the data, since constraints cannot be
 * removed while nodes still depend on them.
 *
 *   npm run reset
 */

import { closeDriver, writeQuery } from '@/lib/db'

const BATCH = 2_000

async function main() {
  console.log('\n  Resetting CognoDB\n  ' + '-'.repeat(40))

  let relationships = 0
  for (;;) {
    const [row] = await writeQuery<{ deleted: number }>(
      `MATCH ()-[r]->() WITH r LIMIT ${BATCH} DELETE r RETURN count(r) AS deleted`,
    )
    const n = Number(row?.deleted ?? 0)
    relationships += n
    if (n === 0) break
    process.stdout.write(`\r  relationships deleted  ${String(relationships).padStart(7)}`)
  }
  console.log(`\r  relationships deleted  ${String(relationships).padStart(7)}`)

  let nodes = 0
  for (;;) {
    const [row] = await writeQuery<{ deleted: number }>(
      `MATCH (n) WITH n LIMIT ${BATCH} DELETE n RETURN count(n) AS deleted`,
    )
    const n = Number(row?.deleted ?? 0)
    nodes += n
    if (n === 0) break
    process.stdout.write(`\r  nodes deleted          ${String(nodes).padStart(7)}`)
  }
  console.log(`\r  nodes deleted          ${String(nodes).padStart(7)}`)

  for (const stmt of [
    'DROP CONSTRAINT account_id IF EXISTS',
    'DROP CONSTRAINT customer_id IF EXISTS',
    'DROP CONSTRAINT identifier_val IF EXISTS',
    'DROP CONSTRAINT loan_id IF EXISTS',
    'DROP CONSTRAINT fraudcase_id IF EXISTS',
    'DROP INDEX account_status IF EXISTS',
    'DROP INDEX account_lastdraw IF EXISTS',
  ]) {
    try { await writeQuery(stmt) } catch { /* already gone */ }
  }
  console.log('  schema dropped\n')

  await closeDriver()
}

main().catch(async (e) => {
  console.error('\n  Reset failed:', e instanceof Error ? e.message : e, '\n')
  await closeDriver()
  process.exit(1)
})
