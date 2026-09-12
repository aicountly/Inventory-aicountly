import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { isAbortError } from '../services/api'

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

interface QueryOptions {
  /** Skip fetching while false (e.g. until the company scope is ready). */
  enabled?: boolean
  /** Keep the previous data on screen while the next page loads. Default true. */
  keepData?: boolean
}

/**
 * Minimal async data hook: runs `fetcher` whenever `deps` change, aborts the
 * previous request, ignores its own aborts and exposes a `reload`.
 */
export function useQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: DependencyList, options: QueryOptions = {}): QueryState<T> {
  const { enabled = true, keepData = true } = options
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    if (!keepData) setData(null)

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-owned deps
  }, [...deps, tick, enabled])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, reload }
}
