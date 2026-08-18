/**
 * src/lib/normalise.ts
 * ---------------------------------------------------------------------------
 * Identifier normalisation.
 *
 * This module is small and it is where a fraud graph is won or lost.
 *
 * Addresses arrive as free text typed by a person on a phone. "12/A, M.G.
 * Road, Pune - 411001" and "12A MG Rd Pune 411001" are the same doorway, but
 * as raw strings they are two different nodes, and a ring hiding behind
 * spelling variants stays invisible. Normalising collapses them to one node,
 * which is the entire reason ring 5 in the seed data is detectable at all.
 *
 * The SAME function runs at seed time and at query time on Applicant Check.
 * If they ever diverged, a new applicant's address would fail to match the
 * identical address already in the graph -- a silent, expensive bug. Sharing
 * one implementation is not tidiness, it is correctness.
 */

/** Common Indian address abbreviations, longest-first so 'road' beats 'rd'. */
const ADDRESS_EXPANSIONS: ReadonlyArray<[RegExp, string]> = [
  [/\brd\b/g, 'road'],
  [/\bst\b/g, 'street'],
  [/\bmg\b/g, 'mg'],
  [/\bnr\b/g, 'near'],
  [/\bopp\b/g, 'opposite'],
  [/\bapt\b/g, 'apartment'],
  [/\bapts\b/g, 'apartments'],
  [/\bbldg\b/g, 'building'],
  [/\bflr\b/g, 'floor'],
  [/\bsoc\b/g, 'society'],
  [/\bcolny\b/g, 'colony'],
  [/\bngr\b/g, 'nagar'],
  [/\bxing\b/g, 'crossing'],
]

/**
 * Collapse a free-text address to a canonical key.
 *
 * The order of these four steps is the whole algorithm, and getting it wrong
 * is subtle. An earlier version kept word separators in the final key, and
 * silently failed on the most common real-world case:
 *
 *   "12/A, M.G. Road"  ->  tokens: 12 | a | m | g | road
 *   "12A MG Rd"        ->  tokens: 12a | mg | road
 *
 * Same doorway, same letters, in the same order -- but a human's choice of
 * where to put a space or a full stop moved the token boundaries, so the two
 * keys never matched and the address ring stayed invisible. Whitespace in an
 * address carries no information; it is pure typing noise.
 *
 * So: fold case, turn every non-alphanumeric run into a gap, expand
 * abbreviations WHILE word boundaries still exist (this step needs them --
 * `rd` -> `road` cannot fire once the spaces are gone), and only then discard
 * the separators entirely.
 *
 * Deliberately lossy. It throws away exactly the variation a person
 * introduces, and keeps what identifies a place.
 *
 * KNOWN LIMIT, worth stating rather than hiding: discarding separators means
 * "12 A Road" and "1 2A Road" collapse together. Rare enough to accept here;
 * production would use a real address parser (libpostal) rather than rules.
 */
export function normaliseAddress(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()                                  // separators -> one gap
  for (const [pattern, replacement] of ADDRESS_EXPANSIONS) s = s.replace(pattern, replacement)
  return s.replace(/\s+/g, '')                                              // gaps carry no meaning
}

/** Device fingerprints arrive as hex; case and separators vary by SDK version. */
export function normaliseDevice(raw: string): string {
  return raw.toLowerCase().replace(/[^a-f0-9]/g, '')
}

/**
 * Bank accounts are stored MASKED. The graph only ever needs to know that two
 * accounts pay out to the same destination, never what the destination is --
 * so we keep the last four digits and the IFSC, and drop the rest. Minimising
 * what the graph holds is a deliberate choice, and worth a line in the README.
 */
export function normaliseBankAccount(accountNumber: string, ifsc: string): string {
  const last4 = accountNumber.replace(/\D/g, '').slice(-4)
  return `${ifsc.toUpperCase()}-****${last4}`
}

/** IPv4 only in this dataset; trim whitespace and drop any port suffix. */
export function normaliseIp(raw: string): string {
  return raw.trim().split(':')[0]
}
