/**
 * Variance insights for the sheet on screen, from whichever source can answer.
 *
 * The adapter is the point of this hook. Today nothing in Inventory serves
 * count insights, so it runs the deterministic rules in `countInsights` and the
 * rail says the findings are rule checks. The day an insight service exists it
 * is passed as `provider` and the same rail renders its answer with
 * `source: 'service'` — no component changes, and no component has to know
 * which one it got.
 *
 * Two invariants:
 *   1. A provider that is slow, absent or broken NEVER stops somebody counting.
 *      Its failure degrades to the rules and is reported as a note, not as a
 *      page error.
 *   2. Rules are never presented as a service's conclusions. `source` is set by
 *      whoever actually produced the findings.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { EMPTY_INSIGHTS, runInsightRules } from './countInsights'
import type { PhysicalCountInsightProvider, PhysicalCountInsights } from './countInsights'
import type { CountRow, CountSummary } from './countModel'

export interface UsePhysicalCountInsightsResult {
  insights: PhysicalCountInsights
  loading: boolean
  /** Set only when a provider failed; the rules below it still rendered. */
  error: string | null
  refresh: () => void
}

/** Recomputing on every keystroke would walk the whole sheet per character. */
const SETTLE_MS = 400

export function usePhysicalCountInsights(
  rows: readonly CountRow[],
  summary: CountSummary,
  options: { documentId?: number | null; provider?: PhysicalCountInsightProvider | null; enabled?: boolean } = {},
): UsePhysicalCountInsightsResult {
  const { documentId = null, provider = null, enabled = true } = options
  const [serviceResult, setServiceResult] = useState<PhysicalCountInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  // A cheap signature of what the rules actually read, so the recompute is not
  // triggered by an unrelated re-render — and is debounced while typing.
  const signature = useMemo(
    () =>
      rows
        .map((r) => `${r.line.key}:${r.line.physical_qty}:${r.line.book_qty}:${r.line.serials.length}:${r.snapshot.unitCost ?? ''}`)
        .join('|'),
    [rows],
  )
  const settled = useDebounce(signature, SETTLE_MS)

  // Read through a ref so the effect below depends on the settled signature
  // rather than on a new array identity every render.
  const latest = useRef({ rows, summary })
  latest.current = { rows, summary }

  const ruleResult = useMemo(
    () => (enabled ? runInsightRules(latest.current.rows, latest.current.summary) : EMPTY_INSIGHTS),
    // `settled` is the dependency on purpose: it is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settled, enabled, tick],
  )

  useEffect(() => {
    if (!enabled || !provider) {
      setServiceResult(null)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    provider
      .getPhysicalCountInsights({ documentId, rows: latest.current.rows, summary: latest.current.summary }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setServiceResult(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        // Degrade, do not fail: the rule findings below are still on screen.
        setServiceResult(null)
        setError('Variance insights are unavailable; showing rule checks instead.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [enabled, provider, documentId, settled, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  return { insights: serviceResult ?? ruleResult, loading, error, refresh }
}
