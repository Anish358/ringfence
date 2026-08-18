/**
 * src/queries/constants.ts
 * ---------------------------------------------------------------------------
 * The vocabulary of the graph, in one place. Imported by the generator, the
 * seed script and every query, so a change here cannot drift between them.
 */

/**
 * The relationship types that constitute a "shared identifier" link.
 *
 * Traversals hop Account -> identifier -> Account, so a path between two
 * accounts is always an EVEN number of relationships, and the number of
 * account-to-account hops is length(path) / 2.
 *
 * `as const` matters: it makes this a fixed tuple of string literals known at
 * compile time, which is what lets the seed script interpolate a member into
 * Cypher defensibly. Nothing here can originate from user input.
 */
export const LINK_TYPES = [
  'USED_DEVICE',
  'RESIDES_AT',
  'PAYS_OUT_TO',
  'LOGGED_IN_FROM',
] as const

export type LinkType = (typeof LINK_TYPES)[number]

/** The node label carried alongside :Identifier on each identifier node. */
export const IDENTIFIER_KINDS = ['Device', 'Address', 'BankAccount', 'IPAddress'] as const
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number]

export const KIND_BY_LINK: Readonly<Record<LinkType, IdentifierKind>> = Object.freeze({
  USED_DEVICE: 'Device',
  RESIDES_AT: 'Address',
  PAYS_OUT_TO: 'BankAccount',
  LOGGED_IN_FROM: 'IPAddress',
})

export const LINK_BY_KIND: Readonly<Record<IdentifierKind, LinkType>> = Object.freeze({
  Device: 'USED_DEVICE',
  Address: 'RESIDES_AT',
  BankAccount: 'PAYS_OUT_TO',
  IPAddress: 'LOGGED_IN_FROM',
})

/**
 * Identifier values are namespaced by kind before they become node values, so
 * the single uniqueness constraint on :Identifier(value) can never collide
 * across kinds -- a device fingerprint and a bank account number that happen
 * to share a string stay distinct nodes.
 */
export const VALUE_PREFIX: Readonly<Record<IdentifierKind, string>> = Object.freeze({
  Device: 'dev',
  Address: 'addr',
  BankAccount: 'bank',
  IPAddress: 'ip',
})

/**
 * How much each kind of shared identifier counts toward a ring's risk score.
 *
 * This is domain judgment, not arithmetic, and it is the difference between a
 * detector with judgment and a threshold:
 *
 *   PAYS_OUT_TO    two accounts sending money to the SAME bank account is the
 *                  strongest mule signal there is. Almost never innocent.
 *   USED_DEVICE    a shared physical handset. Occasionally a family phone,
 *                  usually a fraud farm.
 *   RESIDES_AT     shared address. Families, hostels, and shared flats are
 *                  extremely common, so this alone means little.
 *   LOGGED_IN_FROM shared IP. Offices, colleges and mobile carrier NAT make
 *                  this near-worthless on its own.
 */
export const LINK_WEIGHTS: Readonly<Record<LinkType, number>> = Object.freeze({
  PAYS_OUT_TO: 1.0,
  USED_DEVICE: 0.9,
  RESIDES_AT: 0.45,
  LOGGED_IN_FROM: 0.15,
})

/**
 * Identifier nodes attached to more than this many accounts are excluded from
 * traversal entirely.
 *
 * Two problems, one cutoff. EVIDENTIALLY, a college WiFi IP shared by 400
 * students is not a fraud ring, and letting it link them would drown every
 * real signal. COMPUTATIONALLY, a traversal entering a node of degree 400 and
 * leaving by every other edge does 400 x 400 work at that hop -- on a
 * burstable 0.5 vCPU instance that is the difference between 200ms and a
 * timeout during the demo.
 *
 * The seed data deliberately contains one identifier above this line and one
 * just below it, so both behaviours are demonstrable.
 */
export const MAX_IDENTIFIER_DEGREE = 25

/** A component smaller than this is a household, not a ring. */
export const MIN_RING_SIZE = 3

/** Account lifecycle states. */
export const ACCOUNT_STATUS = ['ACTIVE', 'DORMANT', 'REPAID', 'DEFAULTED', 'FRAUD_CONFIRMED', 'CLEARED'] as const
export type AccountStatus = (typeof ACCOUNT_STATUS)[number]
