import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { useQuery } from '../hooks/useQuery'
import { lookupApi } from '../services/lookupApi'
import type { WarehouseRow } from '../services/lookupApi'
import { defaultPeriod } from '../reports/helpers'
import { todayIso } from '../utils/format'
import { isDashboardViewId, resolveView, writePreferredView } from './views'
import type { DashboardViewId } from './views'

/**
 * Everything the five dashboards are scoped by, and the URL that carries it.
 *
 * ## What lives in the URL
 *
 * `view`, `as_of`, `warehouse_id` and (on Replenishment) `item_id`. All four
 * survive a tab change, a reload and the browser's back button, because the
 * URL is the only state a person can send to a colleague. Everything else —
 * company, financial year, branch — belongs to Manage and to the existing
 * CompanyProvider; the dashboards read it and never try to own it.
 *
 * ## Warehouse membership
 *
 * A warehouse belongs to a branch. When the branch changes, a warehouse from
 * the old one is no longer a valid filter, and leaving it in the URL would
 * scope every figure on the page to a warehouse the user cannot see in the
 * picker — a filter that is invisible and still applied. `effectiveWarehouseId`
 * is therefore the SELECTED warehouse only while it is still a member of the
 * current branch, and the effect below clears the stale value out of the URL
 * so the next reload is honest too. Warehouses at `bo_id` 0 are company-wide
 * and belong to every branch, which is the same rule the balance scans use.
 */

export interface DashboardScopeState {
  view: DashboardViewId | null
  setView: (id: DashboardViewId) => void

  /** Tenant identity. Changing it must invalidate every query on the page. */
  scopeKey: string
  scope: { cmp_id: number; fy_id: number; bo_id: number } | null
  ready: boolean

  /** The date every "as at" figure is computed for. */
  asOf: string
  setAsOf: (iso: string) => void
  /** Reporting period for flow figures — the FY, never past `asOf`. */
  period: { from: string; to: string }

  warehouses: WarehouseRow[]
  warehousesLoading: boolean
  /** What the user picked — may be stale for a moment after a branch change. */
  selectedWarehouseId: number | null
  /** What to actually filter by: the selection, once validated. */
  effectiveWarehouseId: number | null
  setWarehouseId: (id: number | null) => void
  /** True when the selection was dropped because it is not in this branch. */
  warehouseDropped: boolean

  itemId: number | null
  setItemId: (id: number | null) => void

  /** The filters that travel with a tab change. */
  preserved: Record<string, string | number | undefined>
}

export function useDashboardScope(): DashboardScopeState {
  const [params, setParams] = useSearchParams()
  const { scope, fyRange, boId } = useCompany()
  const { can, loading: accessLoading } = useAccess()

  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`
  const ready = scope !== null && !accessLoading

  const view = useMemo(
    () => resolveView(params.get('view'), can, accessLoading),
    [params, can, accessLoading],
  )

  // Remember the dashboard, but only once it is settled — writing on every
  // render would store a view resolved while permissions were still loading.
  useEffect(() => {
    if (view && !accessLoading) writePreferredView(view)
  }, [view, accessLoading])

  const today = useMemo(() => todayIso(), [])
  const rawAsOf = params.get('as_of')
  const asOf = useMemo(() => (isIsoDate(rawAsOf) ? (rawAsOf as string) : today), [rawAsOf, today])
  const period = useMemo(() => defaultPeriod(fyRange, asOf), [fyRange, asOf])

  const warehousesQuery = useQuery((signal) => lookupApi.warehouses(signal), [scopeKey], {
    enabled: ready,
    resetKey: scopeKey,
  })
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data])

  const selectedWarehouseId = useMemo(() => {
    const raw = params.get('warehouse_id')
    const n = raw === null ? NaN : Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [params])

  // A warehouse at bo_id 0 is company-wide; anything else must match the branch.
  const memberOfBranch = useCallback(
    (w: WarehouseRow) => boId === 0 || w.bo_id === 0 || w.bo_id === boId,
    [boId],
  )
  const branchWarehouses = useMemo(() => warehouses.filter(memberOfBranch), [warehouses, memberOfBranch])

  const selectionIsValid =
    selectedWarehouseId === null ||
    // Until the list lands nothing can be judged stale, so the filter is
    // honoured rather than silently dropped on every page load.
    warehousesQuery.loading ||
    warehouses.length === 0 ||
    branchWarehouses.some((w) => w.warehouse_id === selectedWarehouseId)

  const effectiveWarehouseId = selectionIsValid ? selectedWarehouseId : null
  const warehouseDropped = selectedWarehouseId !== null && !selectionIsValid

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
          return next
        },
        // Replace, not push: a filter change is not a place in history anyone
        // wants to step back through one warehouse at a time.
        { replace: true },
      )
    },
    [setParams],
  )

  // Clear a warehouse that no longer belongs to the branch, so the URL cannot
  // keep re-applying an invisible filter after a reload.
  useEffect(() => {
    if (warehouseDropped) setParam('warehouse_id', null)
  }, [warehouseDropped, setParam])

  const setView = useCallback(
    (id: DashboardViewId) => {
      if (!isDashboardViewId(id)) return
      setParam('view', id)
    },
    [setParam],
  )

  const setAsOf = useCallback(
    (iso: string) => setParam('as_of', isIsoDate(iso) && iso !== todayIso() ? iso : null),
    [setParam],
  )

  const setWarehouseId = useCallback(
    (id: number | null) => setParam('warehouse_id', id === null ? null : String(id)),
    [setParam],
  )

  const itemId = useMemo(() => {
    const raw = params.get('item_id')
    const n = raw === null ? NaN : Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [params])

  const setItemId = useCallback(
    (id: number | null) => setParam('item_id', id === null ? null : String(id)),
    [setParam],
  )

  const preserved = useMemo<Record<string, string | number | undefined>>(
    () => ({
      as_of: asOf === today ? undefined : asOf,
      warehouse_id: effectiveWarehouseId ?? undefined,
    }),
    [asOf, today, effectiveWarehouseId],
  )

  return {
    view,
    setView,
    scopeKey,
    scope: scope ? { cmp_id: scope.cmp_id, fy_id: scope.fy_id, bo_id: scope.bo_id } : null,
    ready,
    asOf,
    setAsOf,
    period,
    warehouses: branchWarehouses,
    warehousesLoading: warehousesQuery.loading,
    selectedWarehouseId,
    effectiveWarehouseId,
    setWarehouseId,
    warehouseDropped,
    itemId,
    setItemId,
    preserved,
  }
}

function isIsoDate(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
