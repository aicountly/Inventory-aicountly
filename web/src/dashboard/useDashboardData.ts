import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { useQuery } from '../hooks/useQuery'
import type { QueryState } from '../hooks/useQuery'
import { defaultPeriod } from '../reports/helpers'
import { P } from '../services/access'
import { fetchDashboard } from '../services/dashboard'
import type { DashboardData } from '../services/dashboard'
import type {
  MovementAnalysisSummary,
  StockAgeingSummary,
  WarehouseStockSummary,
} from '../services/reportsApi'
import type { StockMovementRow } from '../services/stockViewsApi'
import { todayIso } from '../utils/format'
import {
  fetchAgeing,
  fetchExpiry,
  fetchMovementMix,
  fetchRecentMovements,
  fetchReplenishment,
  fetchStockValue,
  fetchWarehouseSplit,
} from './dashboardApi'
import type { ExpirySnapshot, ReplenishmentSnapshot, StockValueSnapshot } from './dashboardApi'

/**
 * Loads the dashboard as eight independent requests rather than one.
 *
 * Why not one: the figures come from six different report endpoints, each
 * guarded by its own `reports.<slug>.read` permission and each doing a
 * different amount of work (the valuation walk behind stock value and ageing is
 * far heavier than a status count). Batched into a single await, the slowest
 * report would set the speed of the whole page and a single 403 would blank it.
 *
 * Split, every widget renders the moment its own data lands, shows its own
 * skeleton until then, and a report the user cannot read simply does not appear
 * — the widget is never requested, so no 403 is ever provoked.
 *
 * `nearExpiryDays` re-queries only the widget that depends on it: it is not in
 * the core query's deps, because nothing the core payload carries about expiry
 * reaches the screen.
 */
export const NEAR_EXPIRY_CHOICES = [15, 30, 60, 90] as const

export interface DashboardPermissions {
  dashboard: boolean
  stockSummary: boolean
  warehouseStock: boolean
  ageing: boolean
  movement: boolean
  nearExpiry: boolean
  replenishment: boolean
  movements: boolean
  documents: boolean
}

export interface DashboardDataState {
  /** The date every "as at" figure is computed for. */
  asOf: string
  /** Reporting period for flow figures — the FY, never past today. */
  period: { from: string; to: string }
  nearExpiryDays: number
  setNearExpiryDays: (days: number) => void

  core: QueryState<DashboardData>
  stock: QueryState<StockValueSnapshot>
  warehouses: QueryState<WarehouseStockSummary>
  ageing: QueryState<StockAgeingSummary>
  movement: QueryState<MovementAnalysisSummary>
  expiry: QueryState<ExpirySnapshot>
  replenishment: QueryState<ReplenishmentSnapshot>
  movements: QueryState<StockMovementRow[]>

  can: DashboardPermissions
  accessLoading: boolean
  refreshAll: () => void
  refreshing: boolean
  lastSyncedAt: number | null
}

export function useDashboardData(): DashboardDataState {
  const { scope, fyRange } = useCompany()
  const { can, loading: accessLoading } = useAccess()
  const [nearExpiryDays, setNearExpiryDays] = useState<number>(30)

  const asOf = useMemo(() => todayIso(), [])
  const period = useMemo(() => defaultPeriod(fyRange, asOf), [fyRange, asOf])

  const perms = useMemo<DashboardPermissions>(
    () => ({
      dashboard: can(P.dashboard),
      stockSummary: can(P.report('stock_summary')),
      warehouseStock: can(P.report('warehouse_stock')),
      ageing: can(P.report('stock_ageing')),
      movement: can(P.report('movement_analysis')),
      nearExpiry: can(P.report('near_expiry')),
      replenishment: can(P.report('replenishment')),
      movements: can(P.report('stock_ledger')) || can(P.documentsRead),
      documents: can(P.documentsRead),
      // integration.read / reconciliation.read are deliberately absent: the
      // widgets they used to gate read the /v1/dashboard payload, which the
      // server authorises on dashboard.read alone.
    }),
    [can],
  )

  const ready = scope !== null && !accessLoading
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`

  const core = useQuery((signal) => fetchDashboard(signal), [scopeKey], {
    enabled: ready && perms.dashboard,
  })
  const stock = useQuery((signal) => fetchStockValue(asOf, signal), [scopeKey, asOf], {
    enabled: ready && perms.stockSummary,
  })
  const warehouses = useQuery((signal) => fetchWarehouseSplit(asOf, signal), [scopeKey, asOf], {
    enabled: ready && perms.warehouseStock,
  })
  const ageing = useQuery((signal) => fetchAgeing(asOf, signal), [scopeKey, asOf], {
    enabled: ready && perms.ageing,
  })
  const movement = useQuery(
    (signal) => fetchMovementMix(period.from || asOf, period.to || asOf, signal),
    [scopeKey, period.from, period.to, asOf],
    { enabled: ready && perms.movement },
  )
  const expiry = useQuery((signal) => fetchExpiry(nearExpiryDays, asOf, signal), [scopeKey, nearExpiryDays, asOf], {
    enabled: ready && perms.nearExpiry,
  })
  const replenishment = useQuery((signal) => fetchReplenishment(signal), [scopeKey], {
    enabled: ready && perms.replenishment,
  })
  const movements = useQuery((signal) => fetchRecentMovements(signal), [scopeKey], {
    enabled: ready && perms.movements,
  })

  const queries = [core, stock, warehouses, ageing, movement, expiry, replenishment, movements]
  const refreshing = queries.some((q) => q.loading)

  // "Synced 4m ago" must mean the data on screen, so stamp it on the falling
  // edge of the last in-flight request rather than when a refresh is asked for.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const wasRefreshing = useRef(false)
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setLastSyncedAt(Date.now())
    wasRefreshing.current = refreshing
  }, [refreshing])

  const reloads = queries.map((q) => q.reload)
  const reloadsRef = useRef(reloads)
  reloadsRef.current = reloads
  const refreshAll = useCallback(() => {
    for (const reload of reloadsRef.current) reload()
  }, [])

  return {
    asOf,
    period,
    nearExpiryDays,
    setNearExpiryDays,
    core,
    stock,
    warehouses,
    ageing,
    movement,
    expiry,
    replenishment,
    movements,
    can: perms,
    accessLoading,
    refreshAll,
    refreshing,
    lastSyncedAt,
  }
}
