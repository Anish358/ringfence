'use client'

/**
 * src/hooks/useAsync.ts
 * ---------------------------------------------------------------------------
 * A 40-line replacement for a data-fetching library.
 *
 * The two client-driven screens need exactly three things: isLoading, error,
 * and a way to run the request again. TanStack Query would provide those, plus
 * caching, deduplication, background refetching and window-focus revalidation
 * -- none of which apply to a form the user submits deliberately and reads once.
 *
 * Choosing this is not laziness; it is one fewer dependency in a codebase that
 * has to be defended line by line, and the cancellation guard below is the only
 * subtle part a library would have handled for us.
 */

import { useCallback, useRef, useState } from 'react'

export type AsyncState<T> = {
  data: T | null
  error: string | null
  isLoading: boolean
}

export function useAsync<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
) {
  const [state, setState] = useState<AsyncState<TData>>({ data: null, error: null, isLoading: false })

  // Guards against a stale response overwriting a newer one: if the user
  // submits twice, only the most recent call is allowed to set state.
  const callId = useRef(0)

  const run = useCallback(
    async (...args: TArgs) => {
      const id = ++callId.current
      setState((s) => ({ ...s, isLoading: true, error: null }))
      try {
        const data = await fn(...args)
        if (id === callId.current) setState({ data, error: null, isLoading: false })
        return data
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Something went wrong.'
        if (id === callId.current) setState({ data: null, error: message, isLoading: false })
        return null
      }
    },
    [fn],
  )

  const reset = useCallback(() => {
    callId.current++
    setState({ data: null, error: null, isLoading: false })
  }, [])

  return { ...state, run, reset }
}

/** fetch() resolves on 4xx/5xx, so the error path has to be built by hand. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(
      (body && typeof body.message === 'string' && body.message) ||
        `Request failed with status ${res.status}.`,
    )
  }
  return body as T
}
