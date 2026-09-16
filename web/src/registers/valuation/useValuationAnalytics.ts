/**
 * The valuation analytics band's data layer.
 *
 * Every figure the band draws comes back from `GET /v1/valuation` — the same
 * endpoint, the same filters and the same valuation method the register itself
 * was read under. Nothing is derived from a different report: the warehouse
 * split deliberately does NOT use `reports/warehouse-stock`, whose summary
 * carries a ready-made `by_warehouse` breakdown, because that report costs
 * stock at `AS_PER_MASTER` unconditionally (InventoryReportService) and would
 * silently answer a different question the moment a reader picked FIFO. Bars
 * that do not add up to the total printed above them are worse than no bars.
 *
 * Cost is the reason each series is its own request rather than one big one:
 * a snapshot is a replay, so the band asks for `limit: 1` wherever it only
 * needs the summary — a full company total for a few hundred bytes — and the
 * three series load independently, so a slow trend never holds up the donut.
 *
 * Nothing here runs until the register has data of its own, and every request
 * is aborted by `useQuery` when the filters change underneath it.
 */

import { useMemo } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { useFormOptions } from '../../hooks/useFormOptions'
import { valuationApi } from '../../services/valuationApi'
import type { ValuationSnapshotRow } from '../../services/valuationApi'
import type { QueryState } from '../../hooks/useQuery'
import { trendDates } from './valuationAnalyticsModel'
import type { TrendPeriod, TrendPoint, WarehouseValue } from './valuationAnalyticsModel'

/** How many items the donut names before the rest become "Others". */
export const TOP_ITEM_SLICES = 6

/**
 * How many warehouses the split will replay before it gives up.
 *
 * One request per warehouse is the price of a breakdown that honours the chosen
 * method. That is a fine trade at six warehouses and a bad one at sixty, so
 * past this many the card says what it would have cost instead of spending it.
 */
export const MAX_WAREHOUSE_QUERIES = 12

export interface ValuationFilters {
  asOf: string
  method: string
  itemId: string
  warehouseId: string
}

export interface TopItems {
  rows: ValuationSnapshotRow[]
  totalValue: number
  itemCount: number
}

export interface WarehouseSplit {
  warehouses: WarehouseValue[]
  /** Set when there are more warehouses than the card is willing to replay. */
  skipped: number
}

export interface ValuationAnalytics {
  trend: QueryState<TrendPoint[]>
  topItems: QueryState<TopItems>
  warehouses: QueryState<WarehouseSplit>
  /** The dates the trend asked about — empty when the period yields none. */
  trendDates: string[]
}

export function useValuationAnalytics(
  filters: ValuationFilters,
  period: TrendPeriod,
  enabled: boolean,
): ValuationAnalytics {
  const { scope, fyRange } = useCompany()
  const { allowedWarehouses } = useAccess()
  const { options } = useFormOptions()

  const { asOf, method, itemId, warehouseId } = filters
  // The tenant the figures belong to. Passed to useQuery as `resetKey` so a
  // company switch drops them in render rather than showing one company's
  // charts under another's name for a frame.
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  /** The register's own filters, minus paging — every series starts from these. */
  const base = useMemo(
    () => ({
      as_of: asOf,
      method,
      item_id: itemId || undefined,
      warehouse_id: warehouseId || undefined,
    }),
    [asOf, method, itemId, warehouseId],
  )

  const dates = useMemo(
    () => (asOf ? trendDates(asOf, period, { from: fyRange.from, to: fyRange.to }) : []),
    [asOf, period, fyRange.from, fyRange.to],
  )
  const datesKey = dates.join(',')

  // ---- stock value trend ---------------------------------------------------
  // One snapshot per date, each asking for a single row: the summary is
  // computed over the whole filtered set before the page is sliced, so this is
  // a genuine company total and not the first row's worth of one.
  const trend = useQuery<TrendPoint[]>(
    async (signal) => {
      if (dates.length === 0) return []
      const answers = await Promise.all(
        dates.map((date) =>
          valuationApi
            .snapshot({ ...base, as_of: date, limit: 1, page: 1 }, signal)
            .then((res) => ({ date, summary: res.summary }))
            // A date the server could not answer is a gap in the line, never a
            // point interpolated between its neighbours.
            .catch(() => null),
        ),
      )
      return answers.flatMap((answer) =>
        answer === null
          ? []
          : [
              {
                date: answer.date,
                label: answer.date,
                value: answer.summary.total_value,
                qty: answer.summary.total_qty,
              },
            ],
      )
    },
    [datesKey, base.method, base.item_id, base.warehouse_id, scopeKey],
    { enabled: enabled && dates.length > 0, resetKey: scopeKey },
  )

  // ---- top items by value --------------------------------------------------
  // Server-sorted, so these really are the dearest items in the whole filtered
  // set; "Others" is then the server's total less what is named, which no
  // amount of paging on the client could reproduce.
  const topItems = useQuery<TopItems>(
    async (signal) => {
      const res = await valuationApi.snapshot(
        { ...base, sort: 'stock_value', order: 'desc', limit: TOP_ITEM_SLICES, page: 1 },
        signal,
      )
      return {
        rows: res.data,
        totalValue: res.summary.total_value,
        itemCount: res.summary.item_count,
      }
    },
    [base.as_of, base.method, base.item_id, base.warehouse_id, scopeKey],
    { enabled, resetKey: scopeKey },
  )

  // ---- value by warehouse --------------------------------------------------
  // Narrowed to what this member may see: `allowed_warehouses` is the same list
  // the filter control is built from, and a split that named a warehouse the
  // reader cannot open would leak both its existence and its stock value.
  const visibleWarehouses = useMemo(() => {
    const all = options?.warehouses ?? []
    const boId = scope?.bo_id ?? 0
    const permitted = all.filter((w) => {
      if (allowedWarehouses && !allowedWarehouses.includes(w.warehouse_id)) return false
      if (boId > 0 && Number(w.bo_id) > 0 && Number(w.bo_id) !== boId) return false
      return true
    })
    // With one warehouse already chosen the split has one bar, and it is that
    // one — there is nothing to compare and no reason to replay the others.
    if (warehouseId) {
      return permitted.filter((w) => String(w.warehouse_id) === warehouseId)
    }
    return permitted
  }, [options, allowedWarehouses, scope?.bo_id, warehouseId])

  const warehouseKey = visibleWarehouses.map((w) => w.warehouse_id).join(',')

  const warehouses = useQuery<WarehouseSplit>(
    async (signal) => {
      const targets = visibleWarehouses.slice(0, MAX_WAREHOUSE_QUERIES)
      const skipped = visibleWarehouses.length - targets.length
      const answers = await Promise.all(
        targets.map((w) =>
          valuationApi
            .snapshot({ ...base, warehouse_id: w.warehouse_id, limit: 1, page: 1 }, signal)
            .then((res) => ({
              warehouseId: w.warehouse_id,
              name: w.warehouse_name,
              value: res.summary.total_value,
              qty: res.summary.total_qty,
            }))
            .catch(() => null),
        ),
      )
      return {
        warehouses: answers.filter((a): a is WarehouseValue => a !== null),
        skipped,
      }
    },
    [base.as_of, base.method, base.item_id, warehouseKey, scopeKey],
    { enabled: enabled && visibleWarehouses.length > 0, resetKey: scopeKey },
  )

  return { trend, topItems, warehouses, trendDates: dates }
}
