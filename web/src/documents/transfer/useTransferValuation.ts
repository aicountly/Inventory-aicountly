import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { valuationApi } from '../../services/valuationApi'
import type { LineDraft } from '../formModel'

/** The permission `GET /v1/valuation/unit-costs` authorises against. */
export const VALUATION_PERMISSION = 'reports.valuation.read'

export interface TransferValuationState {
  /** item id → unit cost per BASE unit. Null when the user may not see costs. */
  rates: ReadonlyMap<number, number> | null
  loading: boolean
  /** True when the figures are hidden by permission rather than missing. */
  permitted: boolean
}

const EMPTY: ReadonlyMap<number, number> = new Map()

/**
 * Inventory unit costs for the lines on screen — what the stock COST, from
 * `GET /v1/valuation/unit-costs` under the company's own valuation method.
 *
 * Never a selling price: a transfer moves the company's own stock between its
 * own warehouses, so the only figure that means anything is the cost it carries.
 * The estimate this produces is for the operator's eyes; the valuation engine
 * prices the movement layer by layer when it posts, and that is what the ledger
 * records.
 *
 * A profile without `reports.valuation.read` gets `rates: null`, which every
 * caller renders as a withheld value rather than as zero.
 */
export function useTransferValuation(lines: LineDraft[], options: { asOf: string; warehouseId: number | null; enabled?: boolean }): TransferValuationState {
  const { can, loading: accessLoading } = useAccess()
  const permitted = can(VALUATION_PERMISSION)
  const enabled = options.enabled !== false && permitted

  const itemIds = useMemo(() => {
    const ids = new Set<number>()
    for (const line of lines) if (line.item_id) ids.add(line.item_id)
    return [...ids].sort((a, b) => a - b)
  }, [lines])

  const signature = useMemo(
    () => JSON.stringify([itemIds, options.asOf, options.warehouseId ?? 0]),
    [itemIds, options.asOf, options.warehouseId],
  )
  const debounced = useDebounce(signature, 300)
  const [rates, setRates] = useState<ReadonlyMap<number, number>>(EMPTY)
  const [loading, setLoading] = useState(false)
  const live = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setRates(EMPTY)
      setLoading(false)
      return undefined
    }
    const [ids, asOf, warehouseId] = JSON.parse(debounced) as [number[], string, number]
    if (ids.length === 0) {
      setRates(EMPTY)
      setLoading(false)
      return undefined
    }
    const run = ++live.current
    const controller = new AbortController()
    setLoading(true)
    valuationApi
      .unitCosts(ids, { asOf: asOf || undefined, warehouseId: warehouseId || null }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted || run !== live.current) return
        const next = new Map<number, number>()
        for (const row of rows) {
          const cost = Number(row.unit_cost)
          if (Number.isFinite(cost)) next.set(row.item_id, cost)
        }
        setRates(next)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err) || run !== live.current) return
        // A cost that cannot be read is not a cost of zero. The column says so.
        setRates(EMPTY)
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, enabled])

  return { rates: permitted ? rates : null, loading: loading || (accessLoading && permitted), permitted }
}
