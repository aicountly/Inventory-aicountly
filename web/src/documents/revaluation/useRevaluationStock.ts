/**
 * Keeps the authoritative stock figures for the lines on screen: what each item costs now and how
 * much of it is on hand, at the valuation scope the posting engine will use.
 *
 * It fetches per (item, scope) pair and only for pairs it does not already hold, so adding a
 * twentieth line is one small request rather than twenty. Typing in the New cost box touches
 * nothing here at all — the entered rate is not an input to any of these reads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadStockContexts } from './revaluationApi'
import type { StockContextRequest } from './revaluationApi'
import { contextKey, scopeWarehouseId } from './revaluationModel'
import type { RevaluationDraft, StockContext, StockContextMap, ValuationScope } from './revaluationModel'

export interface RevaluationStockState {
  contexts: StockContextMap
  /** A read is in flight. */
  loading: boolean
  /** The cost half failed everywhere — typically a missing `reports.valuation.read`. */
  costError: string | null
  /** Re-read every pair on screen and hand back the fresh map (for the staleness check). */
  refresh: () => Promise<StockContextMap>
  fetchedAt: number | null
}

/** The distinct (item, scope) pairs the draft needs, in line order. */
export function stockRequestsFor(draft: RevaluationDraft, scope: ValuationScope): StockContextRequest[] {
  const seen = new Set<string>()
  const out: StockContextRequest[] = []
  for (const line of draft.lines) {
    if (line.itemId === null) continue
    const warehouseId = scopeWarehouseId(scope, line.warehouseId)
    const key = contextKey(line.itemId, warehouseId)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ itemId: line.itemId, warehouseId })
  }
  return out
}

export function useRevaluationStock(draft: RevaluationDraft, scope: ValuationScope, asOf: string, enabled = true): RevaluationStockState {
  const [contexts, setContexts] = useState<Record<string, StockContext>>({})
  const [inFlight, setInFlight] = useState(0)
  const [costError, setCostError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  const requests = useMemo(() => stockRequestsFor(draft, scope), [draft, scope])
  // The request list is rebuilt on every keystroke (it is derived from the draft), so the effect
  // keys off its identity, not the array.
  const signature = requests.map((r) => contextKey(r.itemId, r.warehouseId)).join(',')

  // The cost is read as at the document date, so moving the date invalidates every cost held.
  const lastAsOf = useRef(asOf)
  if (lastAsOf.current !== asOf) {
    lastAsOf.current = asOf
    if (Object.keys(contexts).length > 0) setContexts({})
  }

  const contextsRef = useRef(contexts)
  contextsRef.current = contexts

  const fetchPairs = useCallback(
    async (pairs: readonly StockContextRequest[], signal?: AbortSignal): Promise<StockContextMap> => {
      if (pairs.length === 0) return contextsRef.current
      setInFlight((n) => n + 1)
      setContexts((prev) => {
        const next = { ...prev }
        for (const pair of pairs) {
          const key = contextKey(pair.itemId, pair.warehouseId)
          next[key] = { ...(next[key] ?? emptyContext(pair)), loading: true }
        }
        return next
      })
      try {
        const { contexts: loaded, costError: failure } = await loadStockContexts(pairs, { asOf, signal })
        if (signal?.aborted) return contextsRef.current
        setCostError(failure)
        setFetchedAt(Date.now())
        const merged: StockContextMap = { ...contextsRef.current, ...loaded }
        setContexts((prev) => ({ ...prev, ...loaded }))
        return merged
      } finally {
        setInFlight((n) => Math.max(0, n - 1))
      }
    },
    [asOf],
  )

  // Fill in pairs we do not hold yet.
  useEffect(() => {
    if (!enabled) return undefined
    const missing = requests.filter((r) => contextsRef.current[contextKey(r.itemId, r.warehouseId)] === undefined)
    if (missing.length === 0) return undefined
    const controller = new AbortController()
    void fetchPairs(missing, controller.signal).catch(() => {
      /* per-pair errors are already recorded on the context */
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands in for `requests`
  }, [signature, enabled, fetchPairs])

  const refresh = useCallback(() => fetchPairs(stockRequestsFor(draft, scope)), [draft, scope, fetchPairs])

  return { contexts, loading: inFlight > 0, costError, refresh, fetchedAt }
}

function emptyContext(pair: StockContextRequest): StockContext {
  return {
    itemId: pair.itemId,
    warehouseId: pair.warehouseId,
    onHandQty: null,
    currentUnitCost: null,
    method: null,
    loading: true,
    error: null,
    fetchedAt: null,
  }
}
