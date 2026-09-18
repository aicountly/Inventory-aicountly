import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError, isApiError } from '../../services/api'
import { valuationApi } from '../../services/valuationApi'
import type { UnitCostLookup } from './assemblyModel'

/**
 * Permission that decides whether inventory COST may be shown at all.
 *
 * Not invented for this screen: it is the key `ValuationController::unitCosts`, the valuation
 * snapshot and the cost-layer reads all authorise on, so a profile without it cannot obtain a
 * cost from the API by any route. The screen therefore hides the cost columns instead of drawing
 * dashes in them — the figures are not merely blank, they are not this user's to see.
 */
export const COST_PERMISSION = 'reports.valuation.read'

export interface AssemblyUnitCosts {
  /** Per BASE unit, or null when the item's cost is not known. */
  costOf: UnitCostLookup
  /** How the cost was arrived at, per item (FIFO / LIFO / WAC), for the tooltip. */
  methodOf: (itemId: number) => string | null
  loading: boolean
  /** Null when nothing went wrong; a sentence when it did. */
  error: string | null
  /** True when this profile may not see inventory cost. */
  denied: boolean
  reload: () => void
}

/**
 * Inventory valuation cost of the component items, from `GET /v1/valuation/unit-costs`.
 *
 * This is a COST, never a price: the endpoint replays the company's own valuation method as at
 * the document date. It is asked once for all the items on the form rather than once per row,
 * and re-asked only when the set of items, the date or the warehouse changes — typing a quantity
 * does not move a cost.
 */
export function useAssemblyUnitCosts(
  itemIds: readonly number[],
  options: { asOf?: string; warehouseId?: number | null } = {},
): AssemblyUnitCosts {
  const { can, loading: accessLoading } = useAccess()
  const permitted = can(COST_PERMISSION)

  const { asOf, warehouseId = null } = options
  const signature = useMemo(() => {
    const ids = [...new Set(itemIds.filter((id) => Number.isFinite(id) && id > 0))].sort((a, b) => a - b)
    return JSON.stringify([ids, asOf ?? '', warehouseId ?? 0])
  }, [itemIds, asOf, warehouseId])
  const debounced = useDebounce(signature, 300)

  const [costs, setCosts] = useState<Record<number, { cost: number; method: string | null }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (accessLoading) return undefined
    if (!permitted) {
      setCosts({})
      setDenied(true)
      setLoading(false)
      return undefined
    }
    const [ids, date, warehouse] = JSON.parse(debounced) as [number[], string, number]
    if (ids.length === 0) {
      setCosts({})
      setError(null)
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    valuationApi
      .unitCosts(ids, { asOf: date || undefined, warehouseId: warehouse || null }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        const next: Record<number, { cost: number; method: string | null }> = {}
        for (const row of rows) {
          const cost = Number(row.unit_cost)
          // Zero is "this item has no cost on record", not "this item is free": treating it as a
          // known cost would quietly report an expected cost of nothing for a real kit.
          if (Number.isFinite(cost) && cost > 0) next[row.item_id] = { cost, method: row.valuation_method_applied }
        }
        setCosts(next)
        setError(null)
        setDenied(false)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setCosts({})
        setLoading(false)
        if (isApiError(err) && (err.status === 403 || err.status === 401)) {
          setDenied(true)
          setError(null)
          return
        }
        setError('Inventory cost could not be loaded, so the expected cost is not shown.')
      })
    return () => controller.abort()
  }, [debounced, permitted, accessLoading, nonce])

  const costOf = useCallback<UnitCostLookup>((itemId) => costs[itemId]?.cost ?? null, [costs])
  const methodOf = useCallback((itemId: number) => costs[itemId]?.method ?? null, [costs])

  return { costOf, methodOf, loading, error, denied: denied || (!accessLoading && !permitted), reload }
}
