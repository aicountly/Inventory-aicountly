import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { errorMessage, isAbortError } from '../services/api'
import { availabilityApi } from '../services/stockApi'
import type { AvailabilityCheckLine, AvailabilityCheckResult } from '../services/stockApi'

export interface AvailabilityEntry {
  key: string
  line: AvailabilityCheckLine
}

export interface AvailabilityState {
  results: Record<string, AvailabilityCheckResult>
  checking: boolean
  /** Clock reading of the last successful check, null before one lands. */
  checkedAt: number | null
  /** Why the last check failed, null when it did not. */
  error: string | null
  /** Re-run the check now, without waiting for an edit to change the signature. */
  refresh: () => void
}

/**
 * Debounced `POST /v1/availability/check` for the lines that will take stock out, keyed by the
 * draft line key. Re-runs only when an item, warehouse, batch or base quantity changes.
 *
 * `refresh` exists for the screens that put a "Check availability" button in front of the user:
 * the automatic re-check already answers every edit, but a reader who has just received stock in
 * another tab wants to ask again without touching the draft, and nothing about the draft has
 * changed for the signature to notice.
 */
export function useAvailability(entries: AvailabilityEntry[], enabled = true): AvailabilityState {
  const signature = useMemo(() => JSON.stringify(entries.map((e) => [e.key, e.line.item_id, e.line.warehouse_id ?? 0, e.line.batch_id ?? 0, e.line.qty])), [entries])
  const debounced = useDebounce(signature, 400)
  const [results, setResults] = useState<Record<string, AvailabilityCheckResult>>({})
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setResults({})
      setError(null)
      return undefined
    }
    const parsed = JSON.parse(debounced) as Array<[string, number, number, number, number]>
    if (parsed.length === 0) {
      setResults({})
      setError(null)
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
        setError(null)
        setCheckedAt(Date.now())
        setChecking(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setResults({})
        // The figure on screen is gone, so the stamp that dated it has to go with it — a
        // "checked just now" over nothing is the one reading a user must not be given.
        setCheckedAt(null)
        setError(errorMessage(err, 'Stock availability could not be checked.'))
        setChecking(false)
      })
    return () => controller.abort()
  }, [debounced, enabled, nonce])

  return { results, checking, checkedAt, error, refresh }
}
