'use client'

/**
 * The App Router error boundary for this segment.
 *
 * This is what a reviewer sees when they deliberately break the credentials --
 * which the brief says they will do. It must show an actionable sentence, not a
 * stack trace, and must offer a way back without a full page reload.
 *
 * toAppError maps driver error codes to those sentences, so "instance is down"
 * and "password is wrong" read differently: the fixes are completely different.
 */

import { useEffect } from 'react'
import { ErrorState } from '@/components/states'
import { toAppError } from '@/lib/errors'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server details are redacted in production builds, so log what we have.
    console.error('[ringfence]', error.digest ?? '', error.message)
  }, [error])

  const app = toAppError(error)

  return (
    <div className="py-6">
      <ErrorState
        title={app.code === 'DB_UNREACHABLE' ? 'Cannot reach the database' : 'Could not load Ring Radar'}
        message={app.message}
        onRetry={reset}
      />
    </div>
  )
}
