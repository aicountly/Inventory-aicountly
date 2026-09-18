import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { availabilityApi } from '../services/stockApi'
import type { AvailabilityCheckLine, AvailabilityCheckResult } from '../services/stockApi'

export interface AvailabilityEntry {
  key: string
  line: AvailabilityCheckLine
}

export interface AvailabilityState {
  results: Record<string, AvailabilityCheckResult>
  checking: boolean
  /** Re-run the check now, bypassing the debounce — for "Refresh availability" after a stale-stock conflict. */
  reload: () => void
}

/**
 * Debounced `POST /v1/availability/check` for the lines that will take stock out, keyed by the
 * draft line key. Re-runs when an item, warehouse, batch or base quantity changes, or on demand.
 */
export function useAvailability(entries: AvailabilityEntry[], enabled = true): AvailabilityState {
  const signature = useMemo(() => JSON.stringify(entries.map((e) => [e.key, e.line.item_id, e.line.warehouse_id ?? 0, e.line.batch_id ?? 0, e.line.qty])), [entries])
  const debounced = useDebounce(signature, 400)
  const [results, setResults] = useState<Record<string, AvailabilityCheckResult>>({})
  const [checking, setChecking] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) {
      setResults({})
      return undefined
    }
    const parsed = JSON.parse(debounced) as Array<[string, number, number, number, number]>
    if (parsed.length === 0) {
      setResults({})
      return undefined
    }
    const controller = new AbortController()
    setChecking(true)
    availabilityApi
      .check(
        parsed.map(([, item_id, warehouse_id, batch_id, qty]) => ({ item_id, warehouse_id: warehouse_id || null, batch_id: batch_id || null, qty })),
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted) return
        const next: Record<string, AvailabilityCheckResult> = {}
        res.lines.forEach((r, i) => {
          const key = parsed[r.index ?? i]?.[0]
          if (key) next[key] = r
        })
        setResults(next)
        setChecking(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setResults({})
        setChecking(false)
      })
    return () => controller.abort()
    // `tick` deliberately forces a re-run with the same signature (Refresh availability).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, enabled, tick])

  return { results, checking, reload }
}
