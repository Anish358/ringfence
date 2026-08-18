/**
 * scripts/generate-data.ts — deterministic seed-data generator
 * ---------------------------------------------------------------------------
 * Writes data/*.json. Loading is a separate step (scripts/seed.ts).
 *
 * WHY GENERATED RATHER THAN SOURCED
 *   Real fraud graphs are private by definition -- no lender publishes theirs.
 *   The public fraud datasets (IEEE-CIS, PaySim) are flat anonymised tables of
 *   columns like V127 and card3, with no shared-entity structure at all, which
 *   is precisely the structure this model exists to exploit. Using them would
 *   actively make the graph worse.
 *
 *   Generating also buys the one thing a downloaded dataset cannot: KNOWN
 *   GROUND TRUTH. Six rings were planted, so "detection found six rings" is a
 *   claim that can be checked rather than asserted.
 *
 * WHY SEPARATE FROM LOADING
 *   The JSON is committed. A reviewer can read the data without running the
 *   generator, seeding is reproducible, and re-seeding after breaking
 *   something does not silently produce a DIFFERENT dataset.
 *
 * DETERMINISM
 *   Fixed RNG seed, and a fixed reference date -- Date.now() would make every
 *   run produce different timestamps and defeat the point.
 *
 *   npm run generate
 */

import { fakerEN_IN as faker } from '@faker-js/faker'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { LINK_BY_KIND, VALUE_PREFIX } from '@/queries/constants'
import type { IdentifierKind, LinkType } from '@/queries/constants'
import {
  normaliseAddress,
  normaliseBankAccount,
  normaliseDevice,
  normaliseIp,
} from '@/lib/normalise'
import type {
  AccountRow,
  CustomerRow,
  FraudCaseRow,
  GroundTruth,
  IdentifierRow,
  LinkRow,
  LoanRow,
  TransferRow,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Dials
// ---------------------------------------------------------------------------

const SEED = 20260817
/** Fixed "today". Using Date.now() would make the dataset non-reproducible. */
const REF_NOW = Date.parse('2026-08-15T00:00:00.000Z')
const DAY = 86_400_000
const MONTH = 30 * DAY

const LEGIT_ACCOUNTS = 2_000
const RANDOM_TRANSFERS = 12_000

faker.seed(SEED)

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const customers: CustomerRow[] = []
const accounts: AccountRow[] = []
const identifiers = new Map<string, IdentifierRow>()
const links: LinkRow[] = []
const transfers: TransferRow[] = []
const loans: LoanRow[] = []
const fraudCases: FraudCaseRow[] = []

let accountSeq = 0
let customerSeq = 0
let loanSeq = 0
let caseSeq = 0

const iso = (ms: number) => new Date(ms).toISOString()
const pad = (n: number, w = 5) => String(n).padStart(w, '0')
/** Rupees, rounded to the nearest 100 the way a real limit would be. */
const money = (min: number, max: number) =>
  Math.round(faker.number.int({ min, max }) / 100) * 100

// ---------------------------------------------------------------------------
// Identifier registry
//
// Every identifier value is normalised, then namespaced by kind. The namespace
// is what lets ONE uniqueness constraint on :Identifier(value) cover all four
// kinds without a device fingerprint ever colliding with a bank account.
// ---------------------------------------------------------------------------

function registerIdentifier(
  kind: IdentifierKind,
  normalised: string,
  props: Record<string, string | number | boolean>,
): string {
  const value = `${VALUE_PREFIX[kind]}:${normalised}`
  if (!identifiers.has(value)) identifiers.set(value, { value, kind, props })
  return value
}

function link(
  accountId: string,
  value: string,
  type: LinkType,
  props: Record<string, string | number | boolean> = {},
) {
  links.push({ accountId, value, type, props })
}

// ---------------------------------------------------------------------------
// Identifier factories
// ---------------------------------------------------------------------------

function newDevice(): string {
  const raw = faker.string.hexadecimal({ length: 32, prefix: '', casing: 'lower' })
  return registerIdentifier('Device', normaliseDevice(raw), {
    os: faker.helpers.arrayElement(['Android 13', 'Android 14', 'Android 15', 'iOS 17', 'iOS 18']),
    model: faker.helpers.arrayElement([
      'Redmi Note 12', 'Redmi Note 13', 'Samsung M14', 'Samsung A54', 'Realme 11',
      'Vivo Y28', 'Poco X6', 'iPhone 13', 'iPhone 15', 'Moto G84',
    ]),
  })
}

const CITIES: ReadonlyArray<[string, string]> = [
  ['Pune', '4110'], ['Mumbai', '4000'], ['Bengaluru', '5600'], ['Hyderabad', '5000'],
  ['Chennai', '6000'], ['Delhi', '1100'], ['Jaipur', '3020'], ['Indore', '4520'],
  ['Nagpur', '4400'], ['Lucknow', '2260'],
]

/** Returns the RAW address text a user would have typed, plus its parts. */
function newRawAddress(): { raw: string; city: string; pincode: string } {
  const [city, prefix] = faker.helpers.arrayElement(CITIES)
  const pincode = `${prefix}${faker.number.int({ min: 10, max: 99 })}`
  const raw = `${faker.number.int({ min: 1, max: 240 })}, ${faker.location.street()}, ${city} - ${pincode}`
  return { raw, city, pincode }
}

function registerAddress(raw: string, city: string, pincode: string): string {
  return registerIdentifier('Address', normaliseAddress(raw), { city, pincode, sample: raw })
}

function newAddress(): string {
  const { raw, city, pincode } = newRawAddress()
  return registerAddress(raw, city, pincode)
}

function newBankAccount(): string {
  const ifsc = `${faker.helpers.arrayElement(['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'IDFB'])}0${faker.string.numeric(6)}`
  const number = faker.finance.accountNumber(12)
  return registerIdentifier('BankAccount', normaliseBankAccount(number, ifsc), { ifsc })
}

function newIp(isVpn = false): string {
  return registerIdentifier('IPAddress', normaliseIp(faker.internet.ipv4()), {
    asn: `AS${faker.number.int({ min: 9000, max: 65000 })}`,
    isVpn,
  })
}

// ---------------------------------------------------------------------------
// Account factory
// ---------------------------------------------------------------------------

type AccountOpts = {
  openedMsAgo?: number
  drawnRatio?: number
  status?: AccountRow['status']
  lastDrawMs?: number | null
}

function newAccount(opts: AccountOpts = {}): AccountRow {
  const customerId = `CUS-${pad(++customerSeq)}`
  const accountId = `ACC-${pad(++accountSeq)}`

  customers.push({
    id: customerId,
    name: faker.person.fullName(),
    dob: iso(REF_NOW - faker.number.int({ min: 21, max: 55 }) * 365 * DAY).slice(0, 10),
    idNumber: `XXXX-XXXX-${faker.string.numeric(4)}`,
  })

  const openedAtMs = REF_NOW - (opts.openedMsAgo ?? faker.number.int({ min: 7 * DAY, max: 18 * MONTH }))
  const creditLimit = money(5_000, 50_000)
  const drawnRatio = opts.drawnRatio ?? faker.number.float({ min: 0, max: 0.9, fractionDigits: 2 })
  const drawnAmount = Math.round((creditLimit * drawnRatio) / 100) * 100

  const account: AccountRow = {
    id: accountId,
    customerId,
    openedAt: iso(openedAtMs),
    openedAtMs,
    creditLimit,
    drawnAmount,
    status:
      opts.status ??
      faker.helpers.weightedArrayElement([
        { weight: 60, value: 'ACTIVE' as const },
        { weight: 22, value: 'REPAID' as const },
        { weight: 12, value: 'DORMANT' as const },
        { weight: 6, value: 'DEFAULTED' as const },
      ]),
    lastDrawAt: null,
    lastDrawAtMs: null,
  }

  if (opts.lastDrawMs !== undefined) {
    account.lastDrawAtMs = opts.lastDrawMs
    account.lastDrawAt = opts.lastDrawMs === null ? null : iso(opts.lastDrawMs)
  } else if (drawnAmount > 0) {
    const ms = openedAtMs + faker.number.int({ min: DAY, max: Math.max(2 * DAY, REF_NOW - openedAtMs) })
    account.lastDrawAtMs = ms
    account.lastDrawAt = iso(ms)
  }

  accounts.push(account)

  // Every account applies for exactly one loan. A loan has its own lifecycle
  // and things attach to it, which is why it is a node and not a property.
  const loanId = `LN-${pad(++loanSeq, 6)}`
  loans.push({
    id: loanId,
    accountId,
    amount: creditLimit,
    appliedAt: iso(openedAtMs + faker.number.int({ min: 0, max: 2 * DAY })),
    state: faker.helpers.arrayElement(['DISBURSED', 'DISBURSED', 'DISBURSED', 'REPAID', 'APPROVED']),
  })

  return account
}

/** Give an account its own private set of identifiers. */
function attachOwnIdentifiers(a: AccountRow, opts: { ips?: number } = {}) {
  link(a.id, newDevice(), 'USED_DEVICE', {
    firstSeen: a.openedAt,
    lastSeen: iso(REF_NOW - faker.number.int({ min: 0, max: 30 * DAY })),
    loginCount: faker.number.int({ min: 3, max: 400 }),
  })
  link(a.id, newAddress(), 'RESIDES_AT', { declaredAt: a.openedAt })
  link(a.id, newBankAccount(), 'PAYS_OUT_TO', { addedAt: a.openedAt })
  for (let i = 0; i < (opts.ips ?? faker.number.int({ min: 1, max: 2 })); i++) {
    link(a.id, newIp(), 'LOGGED_IN_FROM', {
      lastSeen: iso(REF_NOW - faker.number.int({ min: 0, max: 60 * DAY })),
      count: faker.number.int({ min: 1, max: 90 }),
    })
  }
}

// ---------------------------------------------------------------------------
// 1 · The legitimate population
// ---------------------------------------------------------------------------

const legit: AccountRow[] = []
for (let i = 0; i < LEGIT_ACCOUNTS; i++) {
  const a = newAccount()
  attachOwnIdentifiers(a)
  legit.push(a)
}

// ---------------------------------------------------------------------------
// 2 · Deliberate noise — the false positives that prove scoring has judgment
//
// A detector that flags everything connected is useless. These clusters are
// real overlaps with innocent explanations, and the demo shows them scoring
// LOW next to the planted rings scoring high. Without them, "risk score" is
// indistinguishable from "is connected to anything".
// ---------------------------------------------------------------------------

const noise: GroundTruth['noise'] = []
let cursor = 0
const takeLegit = (n: number) => legit.slice(cursor, (cursor += n))

// 2a · 60 families genuinely sharing a home address.
const familyAccounts: string[] = []
for (let f = 0; f < 60; f++) {
  const members = takeLegit(faker.number.int({ min: 2, max: 4 }))
  const shared = newAddress()
  for (const m of members) {
    // Replace the member's own address link rather than adding a second one.
    const idx = links.findIndex((l) => l.accountId === m.id && l.type === 'RESIDES_AT')
    if (idx >= 0) links.splice(idx, 1)
    link(m.id, shared, 'RESIDES_AT', { declaredAt: m.openedAt })
    familyAccounts.push(m.id)
  }
}
noise.push({
  label: 'Families sharing an address',
  accountIds: familyAccounts,
  note: '60 households of 2-4 accounts. Small, single weak link type, no transfers. Should score low.',
})

// 2b · One college WiFi IP, ABOVE the degree cap. Must be excluded entirely.
const collegeIp = newIp()
const collegeAccounts = takeLegit(40).map((a) => {
  link(a.id, collegeIp, 'LOGGED_IN_FROM', { lastSeen: iso(REF_NOW - 3 * DAY), count: 120 })
  return a.id
})
noise.push({
  label: 'College WiFi IP (40 accounts)',
  accountIds: collegeAccounts,
  note: 'Degree 40, above MAX_IDENTIFIER_DEGREE. Proves the super-node cutoff both removes noise and bounds cost.',
})

// 2c · One office IP, just BELOW the cap. Survives, and should score low.
const officeIp = newIp()
const officeAccounts = takeLegit(12).map((a) => {
  link(a.id, officeIp, 'LOGGED_IN_FROM', { lastSeen: iso(REF_NOW - DAY), count: 60 })
  return a.id
})
noise.push({
  label: 'Office IP (12 accounts)',
  accountIds: officeAccounts,
  note: 'Under the cap, so it forms a real cluster -- but LOGGED_IN_FROM is weighted 0.15, so it scores low.',
})

// 2d · 80 people who upgraded their phone and now have two devices.
for (const a of takeLegit(80)) {
  link(a.id, newDevice(), 'USED_DEVICE', {
    firstSeen: iso(REF_NOW - 90 * DAY), lastSeen: iso(REF_NOW - DAY), loginCount: 40,
  })
}

// 2e · 15 married couples sharing one bank account.
const coupleAccounts: string[] = []
for (let c = 0; c < 15; c++) {
  const [x, y] = takeLegit(2)
  const shared = newBankAccount()
  link(x.id, shared, 'PAYS_OUT_TO', { addedAt: x.openedAt })
  link(y.id, shared, 'PAYS_OUT_TO', { addedAt: y.openedAt })
  coupleAccounts.push(x.id, y.id)
}
noise.push({
  label: 'Married couples sharing a bank account',
  accountIds: coupleAccounts,
  note: 'PAYS_OUT_TO is the strongest signal, but a pair of 2 is below MIN_RING_SIZE, so it never becomes a ring.',
})

// ---------------------------------------------------------------------------
// 3 · The planted rings
// ---------------------------------------------------------------------------

const rings: GroundTruth['rings'] = []

function ringAccounts(n: number, opts: AccountOpts = {}): AccountRow[] {
  return Array.from({ length: n }, () => newAccount({ drawnRatio: 0.95, status: 'ACTIVE', ...opts }))
}

/** Fill in whatever identifiers a ring member has not been given explicitly. */
function fillRemaining(a: AccountRow, skip: LinkType[]) {
  if (!skip.includes('USED_DEVICE')) link(a.id, newDevice(), 'USED_DEVICE', { firstSeen: a.openedAt, lastSeen: a.openedAt, loginCount: 12 })
  if (!skip.includes('RESIDES_AT')) link(a.id, newAddress(), 'RESIDES_AT', { declaredAt: a.openedAt })
  if (!skip.includes('PAYS_OUT_TO')) link(a.id, newBankAccount(), 'PAYS_OUT_TO', { addedAt: a.openedAt })
  if (!skip.includes('LOGGED_IN_FROM')) link(a.id, newIp(), 'LOGGED_IN_FROM', { lastSeen: a.openedAt, count: 8 })
}

// -- Ring 1 · device farm ----------------------------------------------------
// The easy case, included ON PURPOSE. A rule engine catches this too, which is
// exactly the baseline that makes rings 3 and 4 impressive by contrast.
{
  const members = ringAccounts(12)
  const farmDevices = [newDevice(), newDevice()]
  members.forEach((a, i) => {
    link(a.id, farmDevices[i % 2], 'USED_DEVICE', { firstSeen: a.openedAt, lastSeen: iso(REF_NOW - DAY), loginCount: 200 })
    fillRemaining(a, ['USED_DEVICE'])
  })
  rings.push({
    label: 'Ring 1 — device farm',
    signature: '12 accounts across 2 physical devices',
    accountIds: members.map((a) => a.id),
    detectableBy: 'rule-engine-too',
    note: 'A GROUP BY on device_id with HAVING COUNT(*) > 3 finds this. Included as the baseline.',
  })
}

// -- Ring 2 · mule payout ----------------------------------------------------
{
  const members = ringAccounts(9)
  const mules = [newBankAccount(), newBankAccount(), newBankAccount()]
  members.forEach((a, i) => {
    link(a.id, mules[i % 3], 'PAYS_OUT_TO', { addedAt: a.openedAt })
    fillRemaining(a, ['PAYS_OUT_TO'])
  })
  rings.push({
    label: 'Ring 2 — mule payout',
    signature: '9 accounts paying out to 3 bank accounts',
    accountIds: members.map((a) => a.id),
    detectableBy: 'rule-engine-too',
    note: 'Also rule-catchable. Establishes that the strong signal weighting works.',
  })
}

// -- Ring 3 · the CHAIN — the headline -------------------------------------
// A-B share an address. B-C share a bank account. C-D share a device. D-E
// share an IP. Every adjacent pair shares exactly ONE identifier, and the two
// ends share NOTHING. Any GROUP BY finds the pairs and never connects A to E.
{
  const members = ringAccounts(5)
  const bridges: Array<{ type: LinkType; value: string }> = [
    { type: 'RESIDES_AT', value: newAddress() },
    { type: 'PAYS_OUT_TO', value: newBankAccount() },
    { type: 'USED_DEVICE', value: newDevice() },
    { type: 'LOGGED_IN_FROM', value: newIp() },
  ]
  const given: LinkType[][] = members.map(() => [])
  bridges.forEach((bridge, i) => {
    for (const a of [members[i], members[i + 1]]) {
      link(a.id, bridge.value, bridge.type, { declaredAt: a.openedAt, addedAt: a.openedAt, firstSeen: a.openedAt, lastSeen: a.openedAt })
      given[members.indexOf(a)].push(bridge.type)
    }
  })
  members.forEach((a, i) => fillRemaining(a, given[i]))
  rings.push({
    label: 'Ring 3 — the chain',
    signature: 'A-B-C-D-E, each adjacent pair sharing exactly one identifier, ends sharing nothing',
    accountIds: members.map((a) => a.id),
    detectableBy: 'graph-only',
    note: 'THE HEADLINE. A and E have zero identifiers in common. Only a multi-hop traversal joins them.',
  })
}

// -- Ring 4 · circular transfers -------------------------------------------
// No shared identifiers AT ALL. This ring exists only in the money movement,
// which is why ring detection unions identifier pairs with transfer cycles.
{
  const members = ringAccounts(6)
  members.forEach((a) => fillRemaining(a, []))

  const smallLoop = (ids: string[], startMs: number) => {
    ids.forEach((from, i) => {
      const to = ids[(i + 1) % ids.length]
      const ms = startMs + i * 6 * 60 * 60 * 1000
      transfers.push({ from, to, amount: money(300, 1_800), ts: iso(ms), tsMs: ms })
    })
  }
  const ids = members.map((a) => a.id)
  smallLoop([ids[0], ids[1], ids[2]], REF_NOW - 40 * DAY)             // 3 legs
  smallLoop([ids[2], ids[3], ids[4], ids[5]], REF_NOW - 34 * DAY)     // 4 legs
  smallLoop([ids[0], ids[2], ids[4], ids[5], ids[1]], REF_NOW - 27 * DAY) // 5 legs

  rings.push({
    label: 'Ring 4 — circular transfers',
    signature: '6 accounts, three overlapping money loops of 3, 4 and 5 legs',
    accountIds: ids,
    detectableBy: 'graph-only',
    note: 'Shares NO identifiers. Detected purely from cycles in TRANSFERRED. No clean SQL equivalent exists.',
  })
}

// -- Ring 5 · address cluster behind spelling variants ----------------------
// The raw strings differ. normaliseAddress collapses them to one node. Without
// normalisation this ring is seven unrelated accounts.
{
  const members = ringAccounts(7)
  const VARIANTS = [
    '12/A, M.G. Road, Pune - 411001',
    '12A MG Rd, Pune 411001',
    '12-A, Mahatma Gandhi Road, Pune-411001'.replace('Mahatma Gandhi', 'M G'),
    '12 A, M G Rd., Pune , 411001',
    '12/A M.G.ROAD PUNE 411001',
    '12a mg road pune 411001',
    '12/A,  MG  Rd,  Pune  -  411001',
  ]
  members.forEach((a, i) => {
    link(a.id, registerAddress(VARIANTS[i], 'Pune', '411001'), 'RESIDES_AT', { declaredAt: a.openedAt, raw: VARIANTS[i] })
    fillRemaining(a, ['RESIDES_AT'])
  })
  rings.push({
    label: 'Ring 5 — address variants',
    signature: '7 accounts at one doorway, written seven different ways',
    accountIds: members.map((a) => a.id),
    detectableBy: 'graph-only',
    note: 'Seven distinct raw strings collapse to one :Address node. Without normalisation, seven unrelated accounts.',
  })
}

// -- Ring 6 · dormant bust-out ----------------------------------------------
// Six weeks quiet, then every account draws its full limit inside 72 hours.
// The weak shared identifier is what puts them in one component; the timing is
// what pushes the score up.
{
  const bustStart = REF_NOW - 5 * DAY
  const members = Array.from({ length: 10 }, (_, i) =>
    newAccount({
      openedMsAgo: faker.number.int({ min: 7 * 7 * DAY, max: 11 * 7 * DAY }),
      drawnRatio: 1,
      status: 'ACTIVE',
      lastDrawMs: bustStart + faker.number.int({ min: 0, max: 72 * 60 * 60 * 1000 }),
    }),
  )
  const devices = [newDevice(), newDevice(), newDevice()]
  members.forEach((a, i) => {
    link(a.id, devices[i % 3], 'USED_DEVICE', { firstSeen: a.openedAt, lastSeen: iso(bustStart), loginCount: 30 })
    fillRemaining(a, ['USED_DEVICE'])
  })
  // Small circular transfers during the quiet weeks, to fake account activity.
  const ids = members.map((a) => a.id)
  ;[ids[0], ids[1], ids[2]].forEach((from, i, arr) => {
    const ms = REF_NOW - 30 * DAY + i * DAY
    transfers.push({ from, to: arr[(i + 1) % arr.length], amount: money(400, 900), ts: iso(ms), tsMs: ms })
  })
  rings.push({
    label: 'Ring 6 — dormant bust-out',
    signature: '10 accounts quiet for six weeks, then all draw their full limit within 72 hours',
    accountIds: ids,
    detectableBy: 'graph-only',
    note: 'Shares 3 devices (weak, forms the component) plus a co-timed drawdown (strong scoring signal).',
  })
}

// ---------------------------------------------------------------------------
// 4 · Ordinary money movement
// ---------------------------------------------------------------------------

const allIds = accounts.map((a) => a.id)
for (let i = 0; i < RANDOM_TRANSFERS; i++) {
  const from = faker.helpers.arrayElement(allIds)
  let to = faker.helpers.arrayElement(allIds)
  while (to === from) to = faker.helpers.arrayElement(allIds)
  const ms = REF_NOW - faker.number.int({ min: 0, max: 18 * MONTH })
  transfers.push({ from, to, amount: money(200, 40_000), ts: iso(ms), tsMs: ms })
}

// ---------------------------------------------------------------------------
// 5 · Ground truth labels
//
// Risk is measured as distance from known-bad, so the app needs seed points to
// be interesting on first load. Deliberately UNEVEN: rings 1, 2 and 6 have a
// confirmed member; rings 3, 4 and 5 have none, so the demo shows the system
// surfacing rings nobody had reported yet.
// ---------------------------------------------------------------------------

const flagged: string[] = []
function flag(accountId: string, note: string) {
  const id = `FC-${pad(++caseSeq, 4)}`
  fraudCases.push({
    id,
    accountId,
    openedAt: iso(REF_NOW - faker.number.int({ min: 2 * DAY, max: 120 * DAY })),
    openedBy: faker.helpers.arrayElement(['a.mehta', 'r.iyer', 's.khan', 'p.desai']),
    note,
  })
  const acct = accounts.find((a) => a.id === accountId)
  if (acct) acct.status = 'FRAUD_CONFIRMED'
  flagged.push(accountId)
}

for (const r of rings) {
  if (r.label.startsWith('Ring 1')) r.accountIds.slice(0, 4).forEach((id) => flag(id, 'Device farm — confirmed during Q2 sweep.'))
  if (r.label.startsWith('Ring 2')) r.accountIds.slice(0, 3).forEach((id) => flag(id, 'Payout account matched a known mule.'))
  if (r.label.startsWith('Ring 6')) r.accountIds.slice(0, 2).forEach((id) => flag(id, 'Bust-out pattern, chargeback confirmed.'))
}
// Historic fraud scattered through the legitimate population.
faker.helpers
  .arrayElements(legit.filter((a) => a.status === 'DEFAULTED'), 21)
  .forEach((a) => flag(a.id, 'Historic confirmed fraud, closed case.'))

// ---------------------------------------------------------------------------
// 6 · Write
// ---------------------------------------------------------------------------

const outDir = resolve(process.cwd(), 'data')
mkdirSync(outDir, { recursive: true })

const identifierRows: IdentifierRow[] = [...identifiers.values()]

const counts = {
  customers: customers.length,
  accounts: accounts.length,
  identifiers: identifierRows.length,
  links: links.length,
  transfers: transfers.length,
  loans: loans.length,
  fraudCases: fraudCases.length,
  nodes: customers.length + accounts.length + identifierRows.length + loans.length + fraudCases.length,
  relationships: accounts.length + links.length + transfers.length + loans.length + fraudCases.length,
}

const groundTruth: GroundTruth = { seed: SEED, generatedAt: iso(REF_NOW), rings, noise, counts }

const files: Array<[string, unknown]> = [
  ['customers.json', customers],
  ['accounts.json', accounts],
  ['identifiers.json', identifierRows],
  ['links.json', links],
  ['transfers.json', transfers],
  ['loans.json', loans],
  ['fraud-cases.json', fraudCases],
  ['ground-truth.json', groundTruth],
]

for (const [name, payload] of files) {
  writeFileSync(resolve(outDir, name), JSON.stringify(payload, null, 0) + '\n')
}

console.log(`\n  Generated with seed ${SEED} (deterministic)\n  ${'-'.repeat(52)}`)
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(7)}`)
}
console.log(`\n  Planted rings`)
for (const r of rings) {
  console.log(`  ${r.detectableBy === 'graph-only' ? '[graph-only]' : '[rule too]  '} ${r.label.padEnd(30)} ${r.accountIds.length} accounts`)
}
console.log(`\n  ${flagged.length} accounts pre-flagged as confirmed fraud`)
console.log(`  Written to data/\n`)
