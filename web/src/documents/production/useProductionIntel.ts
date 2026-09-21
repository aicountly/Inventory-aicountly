import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError, isApiError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import { valuationApi } from '../../services/valuationApi'
import { indexAvailability } from './productionModel'
import type { ItemAvailability } from './productionModel'

export interface ProductionIntel {
  /** Base units available per item, split by warehouse; null until a read succeeds. */
  availability: Map<number, ItemAvailability> | null
  /** Inventory unit cost per base unit; null when costing is not readable by this profile. */
  unitCosts: Map<number, number> | null
  loading: boolean
  availabilityError: string | null
  /** Set when costing was refused (no `reports.valuation.read`) or failed. */
  costError: string | null
  /** True when costing is unavailable because of permissions rather than a fault. */
  costForbidden: boolean
  reload: () => void
}

const EMPTY: number[] = []

/**
 * Live stock availability and inventory cost for the components of a production run.
 *
 * Two reads, both existing endpoints, both scoped by the shared auth context rather than by
 * anything this screen sends:
 *
 *  - `GET /v1/availability?item_ids=` with NO warehouse filter, so the response carries every
 *    warehouse that holds the item. That single read answers both "can the selected warehouse
 *    cover this line" and "where else is it", which is why the screen can offer alternatives
 *    without a request per component.
 *  - `GET /v1/valuation/unit-costs` for the same items, as at the document date, narrowed to the
 *    warehouse when one is chosen (companies valuing per warehouse get the right figure).
 *
 * Costing needs `reports.valuation.read`, which an operator profile may not hold. A 403 is
 * therefore not an error state: costs stay null, the cost columns say so, and the run can still
 * be entered and posted. Availability is debounced on the item set, so typing a quantity does
 * not queue a request per keystroke; every request aborts the one before it.
 */
export function useProductionIntel(itemIds: number[], asOf: string, warehouseId: number | null): ProductionIntel {
  const signature = useMemo(() => [...new Set(itemIds)].sort((a, b) => a - b).join(','), [itemIds])
  const debounced = useDebounce(signature, 350)
  const [availability, setAvailability] = useState<Map<number, ItemAvailability> | null>(null)
  const [unitCosts, setUnitCosts] = useState<Map<number, number> | null>(null)
  const [loading, setLoading] = useState(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [costError, setCostError] = useState<string | null>(null)
  const [costForbidden, setCostForbidden] = useState(false)
  const [tick, setTick] = useState(0)
  const pending = useRef(0)

  useEffect(() => {
    const ids = debounced ? debounced.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0) : EMPTY
    if (ids.length === 0) {
      setAvailability(null)
      setUnitCosts(null)
      setAvailabilityError(null)
      setCostError(null)
      setCostForbidden(false)
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    const run = ++pending.current
    setLoading(true)

    const availabilityRead = availabilityApi
      .forItems(ids, null, false, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted || run !== pending.current) return
        setAvailability(indexAvailability(rows))
        setAvailabilityError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err) || run !== pending.current) return
        setAvailability(null)
        setAvailabilityError(errorMessage(err, 'Stock availability could not be read.'))
      })

    const costRead = valuationApi
      .unitCosts(ids, { asOf: asOf || undefined, warehouseId }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted || run !== pending.current) return
        setUnitCosts(new Map(rows.map((r) => [r.item_id, Number(r.unit_cost) || 0])))
        setCostError(null)
        setCostForbidden(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err) || run !== pending.current) return
        const forbidden = isApiError(err) && err.status === 403
        setUnitCosts(null)
        setCostForbidden(forbidden)
        setCostError(
          forbidden
            ? 'Component cost needs the valuation report permission, so cost figures are hidden.'
            : errorMessage(err, 'Component cost could not be read.'),
        )
      })

    void Promise.all([availabilityRead, costRead]).then(() => {
      if (!controller.signal.aborted && run === pending.current) setLoading(false)
    })

    return () => controller.abort()
  }, [debounced, asOf, warehouseId, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { availability, unitCosts, loading, availabilityError, costError, costForbidden, reload }
}
