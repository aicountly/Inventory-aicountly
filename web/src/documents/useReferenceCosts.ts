import { useEffect, useMemo, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { valuationApi } from '../services/valuationApi'

export interface ReferenceCostState {
  /** item_id → unit cost, live from `valuationApi.unitCosts`. */
  costs: ReadonlyMap<number, number>
  /** item_id → the valuation method actually applied (FIFO / LIFO / WAC / item master). */
  methods: ReadonlyMap<number, string>
  loading: boolean
}

const EMPTY: ReferenceCostState = { costs: new Map(), methods: new Map(), loading: false }

/**
 * Debounced `GET /v1/valuation/unit-costs` for the distinct items on the draft — the live
 * reference cost the AI Inventory Assistant suggests and checks entered rates against. Inventory
 * is authoritative for this figure; nothing here is a guess or a cached copy.
 */
export function useReferenceCosts(itemIds: readonly number[], warehouseId: number | null, enabled = true): ReferenceCostState {
  const signature = useMemo(() => [...new Set(itemIds)].sort((a, b) => a - b).join(','), [itemIds])
  const debounced = useDebounce(signature, 350)
  const [state, setState] = useState<ReferenceCostState>(EMPTY)

  useEffect(() => {
    if (!enabled || !debounced) {
      setState(EMPTY)
      return undefined
    }
    const ids = debounced.split(',').map(Number)
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    valuationApi
      .unitCosts(ids, { warehouseId }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const costs = new Map<number, number>()
        const methods = new Map<number, string>()
        for (const row of rows) {
          if (Number.isFinite(row.unit_cost)) costs.set(row.item_id, row.unit_cost)
          if (row.valuation_method_applied) methods.set(row.item_id, row.valuation_method_applied)
        }
        setState({ costs, methods, loading: false })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setState(EMPTY)
      })
    return () => controller.abort()
  }, [debounced, warehouseId, enabled])

  return state
}
