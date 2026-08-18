/**
 * src/lib/db.ts — the driver, and the only two ways to run Cypher
 * ---------------------------------------------------------------------------
 * Three objects, three deliberately different lifetimes:
 *
 *   Driver       expensive, thread-safe, owns the connection pool.
 *                EXACTLY ONE per process, for the life of the process.
 *   Session      cheap, short-lived, NOT thread-safe. One per unit of work,
 *                always closed in a finally.
 *   Transaction  always the managed form (executeRead / executeWrite), which
 *                retries transient failures automatically.
 *
 * Getting the first one wrong is the classic serverless failure: a driver per
 * request would open a new pool per request and exhaust CognoDB's 200
 * connection limit under trivial load.
 */

import neo4j, { type Driver, type Session } from 'neo4j-driver'
import { getEnv } from './env'

/**
 * Module scope gives us one driver per warm container, reused across requests.
 * The globalThis guard is for Next.js dev mode: hot reload re-evaluates
 * modules on every file save, which would otherwise leak a fresh driver -- and
 * a fresh pool of sockets -- each time.
 */
const globalForDb = globalThis as unknown as { __cognoDriver?: Driver }

export function getDriver(): Driver {
  if (!globalForDb.__cognoDriver) {
    const env = getEnv()
    globalForDb.__cognoDriver = neo4j.driver(
      env.COGNODB_URI,
      neo4j.auth.basic(env.COGNODB_USER, env.COGNODB_PASSWORD),
      {
        // Small on purpose. Vercel may run many containers concurrently and
        // each keeps its own pool, so the real connection count is
        // poolSize x liveContainers. Ten per container is ample here.
        maxConnectionPoolSize: 10,

        // Serverless containers are frozen between invocations, so a socket
        // that was healthy when parked can be dead on thaw -- surfacing as a
        // baffling ServiceUnavailable on the first request after an idle
        // period. 0 means "verify every connection as it leaves the pool".
        // A small per-request cost for total reliability.
        connectionLivenessCheckTimeout: 0,

        connectionAcquisitionTimeout: 10_000,
        maxTransactionRetryTime: 8_000,

        // Cypher integers are 64-bit; JavaScript numbers are 53-bit floats, so
        // by default the driver returns {low, high} objects to avoid silent
        // precision loss -- which renders as [object Object] in React. Nothing
        // here approaches 2^53 (account counts and rupee amounts), so
        // converting at the driver boundary is safe and deletes a whole layer
        // of mapping code.
        disableLosslessIntegers: true,
      },
    )
  }
  return globalForDb.__cognoDriver
}

/** Run a read. Never mutates; routed to a follower where one exists. */
export async function readQuery<T>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session: Session = getDriver().session({ defaultAccessMode: neo4j.session.READ })
  try {
    // executeRead is a MANAGED transaction: it retries transient failures such
    // as a leader switch or a dropped socket, for up to maxTransactionRetryTime.
    const result = await session.executeRead((tx) => tx.run(cypher, params))
    return result.records.map((r) => r.toObject() as T)
  } finally {
    // A leaked session holds its pooled connection forever and eventually
    // starves the pool. This finally is not optional.
    await session.close()
  }
}

/** Run a write. */
export async function writeQuery<T>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session: Session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    const result = await session.executeWrite((tx) => tx.run(cypher, params))
    return result.records.map((r) => r.toObject() as T)
  } finally {
    await session.close()
  }
}

/** Close the pool. Scripts must call this or the process hangs on exit. */
export async function closeDriver(): Promise<void> {
  if (globalForDb.__cognoDriver) {
    await globalForDb.__cognoDriver.close()
    globalForDb.__cognoDriver = undefined
  }
}
