import { useMemo } from 'react'
import { useAccess } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { P } from '../../services/access'
import { useQuery } from '../../hooks/useQuery'
import { fetchReport } from '../../services/reportsApi'
import type { MovementAnalysisRow, MovementAnalysisSummary } from '../../services/reportsApi'

/** How far back "fast moving" looks. Named so the card's caption cannot drift from it. */
export const FAST_MOVING_DAYS = 30
const TOP_N = 5

/** `to` minus (days - 1), so the window is inclusive of both ends. */
export function windowStart(to: string, days = FAST_MOVING_DAYS): string {
  const d = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return to
  d.setUTCDate(d.getUTCDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

export interface FastMovingFilters {
  /** The register's As-at date: the window ends where the register's figures do. */
  to: string
  warehouseId?: string
  itemGroupId?: string
  stockCategoryId?: string
}

/**
 * The five items that moved out most over the last thirty days.
 *
 * Read from `/v1/reports/movement-analysis`, which is where Inventory's outward-movement
 * figures already live — no second store, no duplicated aggregate, no new endpoint. The
 * register's own warehouse, group and category filters are passed through so the card is
 * about the same stock the table is, and the window ends at the register's As-at date so
 * a back-dated read gets the thirty days that ended then rather than the thirty that end
 * today.
 *
 * Gated on the reader's permission for that report. Someone who may not open movement
 * analysis does not get its figures through a side door on another screen — the card
 * simply is not there.
 */
export function useFastMovingItems(filters: FastMovingFilters) {
  const { can } = useAccess()
  const { scope } = useCompany()
  const allowed = can(P.report('movement_analysis'))

  const query = useMemo(
    () => ({
      from: windowStart(filters.to),
      to: filters.to,
      warehouse_id: filters.warehouseId || undefined,
      item_grp_id: filters.itemGroupId || undefined,
      stock_cat_id: filters.stockCategoryId || undefined,
      sort: 'period_out_qty',
      order: 'desc' as const,
      page: 1,
      limit: TOP_N,
    }),
    [filters.to, filters.warehouseId, filters.itemGroupId, filters.stockCategoryId],
  )

  const result = useQuery(
    (signal) =>
      fetchReport<MovementAnalysisRow, MovementAnalysisSummary>(
        'movement-analysis',
        query,
        signal,
      ),
    [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: allowed && scope !== null && Boolean(filters.to) },
  )

  // An item with nothing out over the window is not a fast mover; the endpoint returns
  // every stock item and sorts, so the tail of a small company is all zeroes.
  const rows = useMemo(
    () => (result.data?.data ?? []).filter((r) => r.period_out_qty > 0),
    [result.data],
  )

  return { allowed, rows, loading: result.loading, error: result.error, window: query }
}
