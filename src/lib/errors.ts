/**
 * src/lib/errors.ts — driver failures become messages a person can act on
 * ---------------------------------------------------------------------------
 * The brief asks for graceful handling when the database is unreachable, and
 * will test it by breaking the credentials. Three layers stand between a dead
 * instance and a stack trace on screen:
 *
 *   1. executeRead/executeWrite already retry TRANSIENT failures for up to
 *      maxTransactionRetryTime. A leader switch or dropped socket recovers
 *      invisibly and never reaches this file.
 *   2. Whatever survives that is mapped here to a status, a code, and a
 *      sentence that says what to do.
 *   3. The UI renders that sentence -- error.tsx for Server Components,
 *      TanStack Query's isError for client fetches, and a persistent banner
 *      driven by /api/health.
 */

export type AppError = {
  status: number
  code: string
  /** Shown to the user. States what happened and what to do. No apology. */
  message: string
}

type MaybeNeo4jError = { code?: unknown; message?: unknown; name?: unknown }

export function toAppError(e: unknown): AppError {
  const err = (e ?? {}) as MaybeNeo4jError
  const code = typeof err.code === 'string' ? err.code : ''
  const message = typeof err.message === 'string' ? err.message : ''

  // Instance down, DNS failure, network partition, TLS rejection.
  if (code === 'ServiceUnavailable' || code === 'SessionExpired' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(message)) {
    return {
      status: 503,
      code: 'DB_UNREACHABLE',
      message: 'Cannot reach the graph database. Check that the CognoDB instance is running, then retry.',
    }
  }

  // Wrong password or wrong user. Distinguished from the above because the fix
  // is completely different -- editing config, not waiting.
  if (/Unauthorized|AuthenticationRate|Security\.Unauthorized/i.test(code) || /authentication failure/i.test(message)) {
    return {
      status: 500,
      code: 'DB_AUTH',
      message: 'The database rejected these credentials. Check COGNODB_USER and COGNODB_PASSWORD in the environment.',
    }
  }

  // Free-tier memory or time ceiling. Actionable: ask for less.
  if (/TransientError/i.test(code) || /OutOfTimeError|deadline exceeded/i.test(message)) {
    return {
      status: 503,
      code: 'DB_BUSY',
      message: 'That query took too long on the free-tier instance. Try a smaller traversal depth or a narrower ring.',
    }
  }

  // Configuration never validated -- getEnv() threw.
  if (/Invalid CognoDB configuration/.test(message)) {
    return {
      status: 500,
      code: 'CONFIG',
      message: 'CognoDB is not configured. Copy .env.example to .env.local and fill in the connection details.',
    }
  }

  return { status: 500, code: 'UNKNOWN', message: 'Something went wrong loading this view. Retry, or check the server logs.' }
}
