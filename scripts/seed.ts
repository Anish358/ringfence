/**
 * scripts/seed.ts — load data/*.json into CognoDB
 * ---------------------------------------------------------------------------
 * Order matters and is not arbitrary:
 *
 *   1. CONSTRAINTS AND INDEXES FIRST. Every MERGE below matches on a property.
 *      Without a backing index that match is a full label scan, so loading
 *      gets quadratically slower as it runs -- the first thousand accounts
 *      load in seconds and the last thousand take minutes. On a burstable
 *      0.5 vCPU instance this is the difference between a 90-second seed and
 *      giving up. A uniqueness constraint creates its index for free.
 *
 *   2. NODES BEFORE THE RELATIONSHIPS THAT CONNECT THEM.
 *
 *   3. BATCHED, ALWAYS. One statement per row would mean ~25,000 network
 *      round trips. UNWIND sends 500 rows in one statement and lets the
 *      server loop, turning that into ~50.
 *
 * IDEMPOTENT. Everything is MERGE, so a re-run after a partial failure
 * repairs rather than duplicates. The single exception is TRANSFERRED, and
 * the reason is explained at that step.
 *
 *   npm run seed
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { closeDriver, getDriver, writeQuery } from '@/lib/db'
import { IDENTIFIER_KINDS, LINK_BY_KIND, LINK_TYPES } from '@/queries/constants'
import type {
  AccountRow, CustomerRow, FraudCaseRow, IdentifierRow, LinkRow, LoanRow, TransferRow,
} from '@/lib/types'

const BATCH = 500

const load = <T>(file: string): T[] =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'data', file), 'utf8')) as T[]

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

let stepNo = 0
function step(label: string) {
  process.stdout.write(`  ${String(++stepNo).padStart(2)}. ${label.padEnd(34)}`)
}
function done(n: number, started: number) {
  console.log(`${String(n).padStart(7)}  ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

/** Run one batched UNWIND per chunk, with a live counter. */
async function batched<T>(label: string, rows: T[], cypher: string) {
  step(label)
  const started = Date.now()
  let n = 0
  for (const batch of chunk(rows, BATCH)) {
    await writeQuery(cypher, { rows: batch })
    n += batch.length
    // Only redraw in place on a real terminal. When output is piped or
    // redirected, carriage returns are written literally and every partial
    // line survives -- turning a tidy progress counter into unreadable noise.
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ${String(stepNo).padStart(2)}. ${label.padEnd(34)}${String(n).padStart(7)}`)
    }
  }
  done(n, started)
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * `REQUIRE` is Neo4j 5 syntax. The probe confirmed CognoDB accepts it and
 * rejects the older `ASSERT` form, so there is no fallback branch here --
 * see docs/cognodb-probe.md.
 */
const SCHEMA = [
  'CREATE CONSTRAINT account_id     IF NOT EXISTS FOR (a:Account)    REQUIRE a.id IS UNIQUE',
  'CREATE CONSTRAINT customer_id    IF NOT EXISTS FOR (c:Customer)   REQUIRE c.id IS UNIQUE',
  // ONE constraint covers all four identifier kinds, because values are
  // namespaced ("dev:", "bank:", ...) so they cannot collide across kinds.
  'CREATE CONSTRAINT identifier_val IF NOT EXISTS FOR (n:Identifier) REQUIRE n.value IS UNIQUE',
  'CREATE CONSTRAINT loan_id        IF NOT EXISTS FOR (l:Loan)       REQUIRE l.id IS UNIQUE',
  'CREATE CONSTRAINT fraudcase_id   IF NOT EXISTS FOR (f:FraudCase)  REQUIRE f.id IS UNIQUE',
  'CREATE INDEX account_status      IF NOT EXISTS FOR (a:Account)    ON (a.status)',
  'CREATE INDEX account_lastdraw    IF NOT EXISTS FOR (a:Account)    ON (a.lastDrawAtMs)',
]

async function loadSchema() {
  step('constraints and indexes')
  const started = Date.now()
  for (const stmt of SCHEMA) await writeQuery(stmt)
  done(SCHEMA.length, started)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const customers = load<CustomerRow>('customers.json')
  const accounts = load<AccountRow>('accounts.json')
  const identifiers = load<IdentifierRow>('identifiers.json')
  const links = load<LinkRow>('links.json')
  const transfers = load<TransferRow>('transfers.json')
  const loans = load<LoanRow>('loans.json')
  const cases = load<FraudCaseRow>('fraud-cases.json')

  try {
    await getDriver().verifyConnectivity()
  } catch (e) {
    const err = e as Error & { code?: string }
    console.error(
      `\n  Cannot reach CognoDB.\n\n    ${err.code ?? 'error'}: ${err.message.split('\n')[0]}\n\n` +
        '  Check COGNODB_URI and COGNODB_PASSWORD in .env.local, and that the\n' +
        '  instance is running at console.cognodb.com.\n',
    )
    process.exit(1)
  }

  console.log('\n  Seeding CognoDB\n  ' + '-'.repeat(52))
  const t0 = Date.now()

  await loadSchema()

  await batched('customers', customers,
    `UNWIND $rows AS row
     MERGE (c:Customer {id: row.id})
     SET c.name = row.name, c.dob = row.dob, c.idNumber = row.idNumber`)

  await batched('accounts', accounts,
    `UNWIND $rows AS row
     MERGE (a:Account {id: row.id})
     SET a.openedAt     = row.openedAt,
         a.openedAtMs   = row.openedAtMs,
         a.creditLimit  = row.creditLimit,
         a.drawnAmount  = row.drawnAmount,
         a.status       = row.status,
         a.lastDrawAt   = row.lastDrawAt,
         a.lastDrawAtMs = row.lastDrawAtMs
     WITH a, row
     MATCH (c:Customer {id: row.customerId})
     MERGE (c)-[:OWNS]->(a)`)

  // Identifier nodes carry TWO labels, e.g. :Device:Identifier. A label cannot
  // be a parameter (the probe confirms this), so we run one pass per kind and
  // interpolate the label from IDENTIFIER_KINDS -- a compile-time `as const`
  // array in source. No caller-supplied string can reach the query text.
  for (const kind of IDENTIFIER_KINDS) {
    const forKind = identifiers.filter((i) => i.kind === kind)
    await batched(`identifiers :${kind}`, forKind,
      `UNWIND $rows AS row
       MERGE (n:Identifier {value: row.value})
       SET n:${kind}, n += row.props`)
  }

  // Same reasoning for relationship types, plus a sharper one: the probe found
  // that CognoDB ACCEPTS a parameterised relationship type in MERGE but then
  // IGNORES it when matching -- returning an existing relationship of a
  // different type instead of creating the one asked for. In a loader that is
  // silent data corruption. Reads parameterise safely; writes use literals.
  for (const type of LINK_TYPES) {
    const forType = links.filter((l) => l.type === type)
    await batched(`links :${type}`, forType,
      `UNWIND $rows AS row
       MATCH (a:Account {id: row.accountId})
       MATCH (n:Identifier {value: row.value})
       MERGE (a)-[r:${type}]->(n)
       SET r += row.props`)
  }

  await batched('loans', loans,
    `UNWIND $rows AS row
     MERGE (l:Loan {id: row.id})
     SET l.amount = row.amount, l.appliedAt = row.appliedAt, l.state = row.state
     WITH l, row
     MATCH (a:Account {id: row.accountId})
     MERGE (a)-[:APPLIED_FOR]->(l)`)

  await batched('fraud cases', cases,
    `UNWIND $rows AS row
     MERGE (f:FraudCase {id: row.id})
     SET f.openedAt = row.openedAt, f.openedBy = row.openedBy, f.note = row.note
     WITH f, row
     MATCH (a:Account {id: row.accountId})
     MERGE (a)-[fl:FLAGGED_AS]->(f)
     SET fl.confirmedAt = row.openedAt, fl.analyst = row.openedBy`)

  // TRANSFERRED is the only MULTI-EDGE relationship here: the same pair of
  // accounts can transfer many times, so there is no property combination that
  // MERGE could match on without a relationship index. Clearing and recreating
  // is both simpler and faster than MERGE, and keeps the script idempotent
  // overall -- re-running still converges on exactly this dataset.
  step('clearing old transfers')
  {
    const started = Date.now()
    let removed = 0
    for (;;) {
      const [row] = await writeQuery<{ deleted: number }>(
        'MATCH ()-[t:TRANSFERRED]->() WITH t LIMIT 5000 DELETE t RETURN count(t) AS deleted',
      )
      const n = row?.deleted ?? 0
      removed += n
      if (n === 0) break
    }
    done(removed, started)
  }

  await batched('transfers', transfers,
    `UNWIND $rows AS row
     MATCH (a:Account {id: row.from})
     MATCH (b:Account {id: row.to})
     CREATE (a)-[:TRANSFERRED {amount: row.amount, ts: row.ts, tsMs: row.tsMs}]->(b)`)

  // -- verify, rather than assume ------------------------------------------
  console.log('  ' + '-'.repeat(52))
  const [counts] = await writeQuery<Record<string, number>>(`
    MATCH (a:Account)            WITH count(a) AS accounts
    MATCH (c:Customer)           WITH accounts, count(c) AS customers
    MATCH (n:Identifier)         WITH accounts, customers, count(n) AS identifiers
    MATCH (l:Loan)               WITH accounts, customers, identifiers, count(l) AS loans
    MATCH (f:FraudCase)          WITH accounts, customers, identifiers, loans, count(f) AS fraudCases
    MATCH ()-[t:TRANSFERRED]->() WITH accounts, customers, identifiers, loans, fraudCases, count(t) AS transfers
    RETURN accounts, customers, identifiers, loans, fraudCases, transfers`)

  const expected: Record<string, number> = {
    accounts: accounts.length, customers: customers.length, identifiers: identifiers.length,
    loans: loans.length, fraudCases: cases.length, transfers: transfers.length,
  }

  let mismatch = 0
  for (const [k, want] of Object.entries(expected)) {
    const got = Number(counts?.[k] ?? 0)
    const ok = got === want
    if (!ok) mismatch++
    console.log(`  ${ok ? ' ok ' : 'FAIL'}  ${k.padEnd(16)} ${String(got).padStart(7)} / ${want}`)
  }

  console.log(`\n  ${mismatch === 0 ? 'Seed complete' : mismatch + ' COUNT MISMATCH'} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  await closeDriver()
  process.exit(mismatch === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\n  Seed failed:', e instanceof Error ? e.message : e, '\n')
  await closeDriver()
  process.exit(1)
})
