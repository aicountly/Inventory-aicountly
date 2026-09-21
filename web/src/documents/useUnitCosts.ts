/**
 * Live unit costs for the items on the form, from `GET /v1/valuation/unit-costs`.
 *
 * The screen shows an estimated value before anything posts, and the only honest source for that
 * is the company's own valuation — its method, its layers, its as-of date. Nothing here computes
 * a cost; it reads one. The method comes from company settings rather than a constant, so a LIFO
 * company is never shown FIFO figures, and the read is keyed by warehouse when the setting scopes
 * valuation that way.
 *
 * Debounced and abortable: adding a row or retyping a quantity must not fire a valuation read per
 * keystroke, and a stale response must never land on top of a newer one.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { valuationApi } from '../services/valuationApi'
import { toNumber } from '../utils/format'

export interface UnitCostsState {
  /** item_id → cost per base unit. Missing means "no cost on record", not zero. */
  costs: Map<number, number>
  loading: boolean
  /** Items that were asked for and came back without a cost. */
  unknown: number[]
  error: string | null
}

export interface UnitCostsOptions {
  itemIds: readonly number[]
  asOf: string
  /** FIFO | LIFO | WAC from company settings; undefined until they load. */
  method?: string
  warehouseId?: number | null
  enabled?: boolean
}

const EMPTY: UnitCostsState = { costs: new Map(), loading: false, unknown: [], error: null }

export function useUnitCosts({ itemIds, asOf, method, warehouseId = null, enabled = true }: UnitCostsOptions): UnitCostsState {
  const signature = useMemo(() => {
    const ids = [...new Set(itemIds)].filter((id) => Number.isFinite(id) && id > 0).sort((a, b) => a - b)
    return JSON.stringify([ids, asOf, method ?? '', warehouseId ?? 0])
  }, [itemIds, asOf, method, warehouseId])
  const debounced = useDebounce(signature, 350)
  const [state, setState] = useState<UnitCostsState>(EMPTY)
  // Keeps the previous figures on screen while the next read is in flight, so the value summary
  // does not blink to "—" every time a quantity changes.
  const lastCosts = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    if (!enabled) {
      lastCosts.current = new Map()
      setState(EMPTY)
      return undefined
    }
    const [ids, at, m, wh] = JSON.parse(debounced) as [number[], string, string, number]
    if (ids.length === 0) {
      lastCosts.current = new Map()
      setState(EMPTY)
      return undefined
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    valuationApi
      .unitCosts(ids, { asOf: at || undefined, method: m || undefined, warehouseId: wh || null }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const costs = new Map<number, number>()
        const unknown: number[] = []
        for (const row of rows) {
          const cost = toNumber(row.unit_cost)
          if (cost === null || cost <= 0) unknown.push(row.item_id)
          else costs.set(row.item_id, cost)
        }
        lastCosts.current = costs
        setState({ costs, loading: false, unknown, error: null })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        // A costing read the user may not make (reports.valuation.read) must not break the form:
        // the value summary simply says it cannot price the document.
        setState({ costs: lastCosts.current, loading: false, unknown: [], error: err instanceof Error ? err.message : 'Costs unavailable' })
      })
    return () => controller.abort()
  }, [debounced, enabled])

  return state
}
