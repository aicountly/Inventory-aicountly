import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { isAbortError } from '../services/api'

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
  /**
   * Clock reading of the last SUCCESSFUL response, or null before one lands.
   *
   * The register header reports data freshness from this. It deliberately does
   * not move on a failed reload: the rows on screen are still as old as they
   * were, and stamping them "just now" because a request was attempted would
   * make the badge a liar at exactly the moment it matters.
   */
  fetchedAt: number | null
}

interface QueryOptions {
  /** Skip fetching while false (e.g. until the company scope is ready). */
  enabled?: boolean
  /** Keep the previous data on screen while the next page loads. Default true. */
  keepData?: boolean
  /**
   * A value whose change makes the data on screen WRONG rather than merely
   * stale — in practice the tenant scope (company / FY / branch).
   *
   * `keepData` exists so a page change or a filter tweak does not blank the
   * screen, and that is right for a narrower date or the next page. It is not
   * right for a company switch: holding the previous company's figures under
   * the new company's name is not a slightly old number, it is another
   * tenant's data on screen, and no amount of "loading" styling makes that
   * acceptable. Pass the scope here and the data is dropped the instant it
   * changes, whatever `keepData` says.
   */
  resetKey?: string | number | null
}

/**
 * Minimal async data hook: runs `fetcher` whenever `deps` change, aborts the
 * previous request, ignores its own aborts and exposes a `reload`.
 */
export function useQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: DependencyList, options: QueryOptions = {}): QueryState<T> {
  const { enabled = true, keepData = true, resetKey = null } = options
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // Dropped in render, not in an effect: an effect runs after the browser has
  // already painted, which is one frame of the previous tenant's numbers under
  // the new tenant's name. Comparing during render means the stale data never
  // reaches the screen at all.
  const lastResetKey = useRef(resetKey)
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey
    if (data !== null) setData(null)
    if (error !== null) setError(null)
    // The freshness stamp belongs to the data it described. Dropping the rows
    // but keeping "updated just now" would date the new tenant's empty screen
    // by the old tenant's fetch.
    if (fetchedAt !== null) setFetchedAt(null)
  }

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
        setFetchedAt(Date.now())
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-owned deps
  }, [...deps, tick, enabled, resetKey])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, reload, fetchedAt }
}
