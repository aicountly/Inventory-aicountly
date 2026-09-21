/**
 * Every request the Warehouses screen makes, in one place.
 *
 * Three calls on arrival, and not one more per row:
 *
 *  1. `warehouses` — the page of rows the table shows, server-filtered, sorted
 *     and paged exactly as the toolbar asks.
 *  2. `warehouses/summary` — the KPI strip's figures, aggregated in the
 *     database over every warehouse in scope. The cards must not be the
 *     arithmetic of page 1 of 9.
 *  3. `reports/warehouse-stock` with `limit=1` — the stock each warehouse
 *     holds. Its `summary.by_warehouse` covers the whole company whatever the
 *     limit, so one request answers a hundred warehouses; asking per row would
 *     be the N+1 this screen is explicitly not allowed to have.
 *
 * A fourth, lazy, walk backs the By Location / Capacity / Map tabs and the
 * analytics beneath the table, which need every row rather than a page of them.
 * It runs only once one of those is actually on screen.
 *
 * Every call carries the company / financial-year / branch scope the API client
 * injects from CompanyContext — the same live Manage selection the rest of the
 * app uses. Nothing here caches, copies or synchronises any of it.
 */

import { useCallback, useMemo } from 'react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { useQuery } from '../../../hooks/useQuery'
import type { ListParams } from '../../../hooks/useListParams'
import { P } from '../../../services/access'
import type { ListMeta, ListQuery } from '../../../services/api'
import { fetchAllRows } from '../../../services/listAll'
import { locationsApi, warehousesApi } from '../../../services/masters'
import { settingsApi } from '../../../services/settingsApi'
import type { Warehouse, WarehouseSummary } from '../../../services/masters'
import { fetchReport } from '../../../services/reportsApi'
import type { WarehouseStockRow, WarehouseStockSummary } from '../../../services/reportsApi'
import { stockByWarehouse } from './warehouseMetrics'
import type { WarehouseStock } from './warehouseMetrics'

export type WarehouseView = 'all' | 'location' | 'capacity' | 'map'

export const WAREHOUSE_VIEWS: readonly WarehouseView[] = ['all', 'location', 'capacity', 'map']

export function isWarehouseView(value: string | undefined): value is WarehouseView {
  return value !== undefined && (WAREHOUSE_VIEWS as readonly string[]).includes(value)
}

/** Views that reason over every warehouse rather than the page on screen. */
const NEEDS_EVERY_ROW: readonly WarehouseView[] = ['location', 'capacity', 'map']

export interface WarehousesScreenState {
  view: WarehouseView
  /** The page of rows the table renders. */
  rows: Warehouse[]
  total: number
  /** The server's own pagination meta — what the footer counts from. */
  meta: ListMeta | null
  listLoading: boolean
  listError: Error | null
  /** Every row in scope, for the grouped views and the analytics. Empty until needed. */
  allRows: Warehouse[]
  allRowsLoading: boolean
  allRowsTruncated: boolean
  summary: WarehouseSummary | null
  summaryLoading: boolean
  stock: Map<number, WarehouseStock>
  stockLoading: boolean
  /** The stock report is a separate permission; without it the screen says so rather than showing 0. */
  canSeeStock: boolean
  canSeeStockValue: boolean
  /** Bin/zone rows configured, for the "enable bin locations" insight. null until loaded. */
  locationCount: number | null
  /** The company's base currency, for the value captions. Falls back to the formatter's default. */
  currency: string
  reload: () => void
  /** Walks every page of the current filter, for the export sheet. */
  fetchAll: () => Promise<{ rows: Warehouse[]; total: number; truncated: boolean }>
}

export function useWarehousesScreen(list: ListParams, view: WarehouseView): WarehousesScreenState {
  const { scope } = useCompany()
  const { can } = useAccess()
  const canRead = can(P.masters('warehouses', 'read'))
  /*
   * Stock and valuation are the report's permission, not the master's. A user
   * who may administer warehouses but may not read stock sees the table, the
   * capacity and the status — and "—" where the quantity would be, with the
   * reason on the column header. Hiding the whole screen would be wrong; making
   * the number up would be worse.
   */
  const canSeeStock = can(P.report('warehouse_stock'))
  const canSeeStockValue = canSeeStock && can([P.report('stock_summary'), P.valuationRecalculate, P.report('warehouse_stock')])
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const listQuery = useMemo<ListQuery>(() => ({ ...list.query, ...list.state.filters, view: undefined }), [list.query, list.state.filters])

  const listState = useQuery(
    (signal) => warehousesApi.list(listQuery, signal),
    [scopeKey, listQuery],
    { enabled: !!scope && canRead, resetKey: scopeKey },
  )

  const summaryState = useQuery(
    (signal) => warehousesApi.summary(signal),
    [scopeKey],
    { enabled: !!scope && canRead, resetKey: scopeKey },
  )

  const stockState = useQuery(
    (signal) => fetchReport<WarehouseStockRow, WarehouseStockSummary>('warehouse-stock', { limit: 1, nonzero: 0 }, signal),
    [scopeKey],
    { enabled: !!scope && canRead && canSeeStock, resetKey: scopeKey },
  )

  const needsEveryRow = NEEDS_EVERY_ROW.includes(view)
  const allRowsState = useQuery(
    () =>
      fetchAllRows<Warehouse>((page, limit) => warehousesApi.list({ ...listQuery, page, limit }), { limit: 500, maxRows: 5000 }),
    [scopeKey, listQuery, needsEveryRow],
    { enabled: !!scope && canRead && needsEveryRow, resetKey: scopeKey },
  )

  /*
   * One row is enough: the count lives in `meta.total`, and the insight only
   * needs to know whether any bin has ever been defined.
   */
  const locationState = useQuery(
    (signal) => locationsApi.list({ limit: 1 }, signal),
    [scopeKey],
    { enabled: !!scope && can(P.masters('locations', 'read')), resetKey: scopeKey },
  )

  /*
   * Only to label the value captions. Company settings are their own permission,
   * so a user without it simply gets the money formatter's default rather than a
   * blocked screen — the figures themselves come from the stock report.
   */
  const settingsState = useQuery(
    (signal) => settingsApi.get(signal),
    [scopeKey],
    { enabled: !!scope && canRead && can(P.settingsRead), resetKey: scopeKey },
  )

  const stock = useMemo(
    () => stockByWarehouse(stockState.data?.summary ?? null, canSeeStockValue),
    [stockState.data, canSeeStockValue],
  )

  const reload = useCallback(() => {
    listState.reload()
    summaryState.reload()
    if (canSeeStock) stockState.reload()
    if (needsEveryRow) allRowsState.reload()
  }, [listState, summaryState, stockState, allRowsState, canSeeStock, needsEveryRow])

  const fetchAll = useCallback(
    () => fetchAllRows<Warehouse>((page, limit) => warehousesApi.list({ ...listQuery, page, limit })),
    [listQuery],
  )

  return {
    view,
    rows: listState.data?.data ?? [],
    total: listState.data?.meta.total ?? 0,
    meta: listState.data?.meta ?? null,
    listLoading: listState.loading,
    listError: listState.error,
    allRows: allRowsState.data?.rows ?? [],
    allRowsLoading: allRowsState.loading,
    allRowsTruncated: allRowsState.data?.truncated ?? false,
    summary: summaryState.data ?? null,
    summaryLoading: summaryState.loading,
    stock,
    stockLoading: stockState.loading,
    canSeeStock,
    canSeeStockValue,
    locationCount: locationState.data?.meta.total ?? null,
    currency: settingsState.data?.base_currency_code || 'INR',
    reload,
    fetchAll,
  }
}
