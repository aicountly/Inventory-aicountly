/**
 * The dashboard's data layer.
 *
 * Nothing here invents an endpoint. Every call below hits a route that already
 * exists in server-php/app/Config/Routes.php, and every aggregate it reads is
 * one the server computes over the **whole filtered set** before it slices the
 * page — see InventoryReportService: each report builds `$summary` in the same
 * loop that builds `$rows` and only then does `array_slice($rows, $offset, $limit)`.
 *
 * That is what makes a one-row request an honest company total: asking for
 * `limit=1` returns a full summary for a few hundred bytes. Where a widget also
 * wants a short list (top items by value, the next batches to expire), it asks
 * for exactly as many rows as it renders and gets the totals in the same round
 * trip — one request per widget, no client-side aggregation, and no page-limited
 * number ever presented as a company figure.
 *
 * Widgets load independently: a slow valuation walk on one report must not hold
 * up the rest of the page, and a 403 on one report (permissions are per report
 * slug) must not blank the dashboard.
 */

import { api } from './../services/api'
import type { ListResponse } from '../services/api'
import { fetchReport } from '../services/reportsApi'
import type {
  MovementAnalysisSummary,
  NearExpirySummary,
  ReplenishmentRow,
  ReplenishmentSummary,
  StockAgeingSummary,
  StockSummaryRow,
  StockSummarySummary,
  NearExpiryRow,
  WarehouseStockSummary,
} from '../services/reportsApi'
import type { StockMovementRow } from '../services/stockViewsApi'

/** How many rows each list-bearing widget renders. */
export const WIDGET_ROWS = 6
/** Summary-only widgets still have to ask for at least one row. */
const SUMMARY_ONLY = 1

// ---------------------------------------------------------------------------
// Stock value + the dearest items (one call)
// ---------------------------------------------------------------------------

export interface StockValueSnapshot {
  summary: StockSummarySummary
  /** The `WIDGET_ROWS` most valuable items as at `asOf`. */
  topItems: StockSummaryRow[]
  total: number
}

export async function fetchStockValue(asOf: string, signal?: AbortSignal): Promise<StockValueSnapshot> {
  const res = await fetchReport<StockSummaryRow, StockSummarySummary>(
    'stock-summary',
    { to: asOf, nonzero: 1, sort: 'closing_value', order: 'desc', limit: WIDGET_ROWS, page: 1 },
    signal,
  )
  return { summary: res.summary, topItems: res.data, total: res.meta.total }
}

// ---------------------------------------------------------------------------
// Value by warehouse — summary.by_warehouse covers every warehouse, not the page
// ---------------------------------------------------------------------------

export async function fetchWarehouseSplit(asOf: string, signal?: AbortSignal): Promise<WarehouseStockSummary> {
  const res = await fetchReport<unknown, WarehouseStockSummary>(
    'warehouse-stock',
    { to: asOf, nonzero: 1, limit: SUMMARY_ONLY, page: 1 },
    signal,
  )
  return res.summary
}

// ---------------------------------------------------------------------------
// Ageing buckets
// ---------------------------------------------------------------------------

export async function fetchAgeing(asOf: string, signal?: AbortSignal): Promise<StockAgeingSummary> {
  const res = await fetchReport<unknown, StockAgeingSummary>(
    'stock-ageing',
    { as_of: asOf, limit: SUMMARY_ONLY, page: 1 },
    signal,
  )
  return res.summary
}

// ---------------------------------------------------------------------------
// Movement mix (fast / slow / non-moving / dead)
// ---------------------------------------------------------------------------

export async function fetchMovementMix(from: string, to: string, signal?: AbortSignal): Promise<MovementAnalysisSummary> {
  const res = await fetchReport<unknown, MovementAnalysisSummary>(
    'movement-analysis',
    { from, to, limit: SUMMARY_ONLY, page: 1 },
    signal,
  )
  return res.summary
}

// ---------------------------------------------------------------------------
// Reorder advice
// ---------------------------------------------------------------------------

export interface ReplenishmentSnapshot {
  summary: ReplenishmentSummary
  rows: ReplenishmentRow[]
  total: number
}

export async function fetchReplenishment(warehouseId: number | null = null, signal?: AbortSignal): Promise<ReplenishmentSnapshot> {
  const res = await fetchReport<ReplenishmentRow, ReplenishmentSummary>(
    'replenishment',
    { only_triggered: 1, warehouse_id: warehouseId ?? undefined, limit: WIDGET_ROWS, page: 1 },
    signal,
  )
  return { summary: res.summary, rows: res.data, total: res.meta.total }
}

// ---------------------------------------------------------------------------
// Expiry — one call answers both "expiring soon" and "already expired"
// ---------------------------------------------------------------------------

export interface ExpirySnapshot {
  summary: NearExpirySummary
  rows: NearExpiryRow[]
  /** Batches inside the window that have NOT expired yet. */
  expiringSoon: number
  expired: number
}

export async function fetchExpiry(days: number, asOf: string, signal?: AbortSignal): Promise<ExpirySnapshot> {
  const res = await fetchReport<NearExpiryRow, NearExpirySummary>(
    'near-expiry',
    { days, as_of: asOf, include_expired: 1, sort: 'expiry_date', order: 'asc', limit: WIDGET_ROWS, page: 1 },
    signal,
  )
  const expired = res.summary.expired_batches
  return {
    summary: res.summary,
    rows: res.data,
    expiringSoon: Math.max(0, res.summary.batches - expired),
    expired,
  }
}

// ---------------------------------------------------------------------------
// Recent movement ledger
// ---------------------------------------------------------------------------

export async function fetchRecentMovements(signal?: AbortSignal): Promise<StockMovementRow[]> {
  const res = await api.list<StockMovementRow>(
    'v1/stock-movements',
    { sort: 'movement_date', order: 'desc', limit: WIDGET_ROWS + 2, page: 1 },
    { signal },
  )
  return (res as ListResponse<StockMovementRow>).data
}
