/**
 * The reads the Material Issue screen needs beyond the shared document APIs.
 *
 * Every one of them is an existing Inventory endpoint used as it already is —
 * nothing here adds a table, a cache or a copy of another Aicountly product's
 * data. The production documents the "Against Production" mode references are
 * Inventory's own PRODUCTION documents, read live from the documents endpoint.
 */

import { documentsApi } from '../../services/documentsApi'
import { fetchReport } from '../../services/reportsApi'
import type { WarehouseStockRow, WarehouseStockSummary } from '../../services/reportsApi'
import type { DocumentListRow } from '../types'
import { deltaPercent, monthWindow, previousMonthWindow } from './insightWindows'

/** Statuses that mean the stock actually left — what a "this month" figure should count. */
const SETTLED = 'POSTED,PARTIALLY_FULFILLED,COMPLETED'

export interface IssueInsights {
  /** Closing quantity in the warehouse asked for (all warehouses when none). */
  currentStock: number
  /** Item lines issued in the calendar month of `asOf`. */
  issuedLines: number
  /** SUM(valuation_amount) of those lines — what the stock that left cost. */
  issuedValue: number
  /** Change on the previous calendar month, or null when it had nothing to compare. */
  issuedLinesDelta: number | null
  issuedValueDelta: number | null
}

/**
 * The three figures on the Live Stock Insight card, plus their month-on-month
 * change.
 *
 * `limit: 1` on both reads: the server computes each summary over the whole
 * filtered set before it slices the page (InventoryReportService::warehouseStock,
 * DocumentsController::summarise), so one row is all this card needs to pay for.
 */
export async function fetchIssueInsights(
  options: { warehouseId?: number | null; asOf: string; signal?: AbortSignal },
): Promise<IssueInsights> {
  const { warehouseId = null, asOf, signal } = options
  const thisMonth = monthWindow(asOf)
  const lastMonth = previousMonthWindow(asOf)

  const stockRead = fetchReport<WarehouseStockRow, WarehouseStockSummary>(
    'warehouse-stock',
    { to: asOf, warehouse_id: warehouseId ?? undefined, nonzero: 1, limit: 1 },
    signal,
  )
  const issuedRead = thisMonth
    ? documentsApi.list({ document_type: 'MATERIAL_ISSUE', status: SETTLED, from: thisMonth.from, to: thisMonth.to, summary: 1, limit: 1 }, signal)
    : Promise.resolve(null)
  const baselineRead = lastMonth
    ? documentsApi.list({ document_type: 'MATERIAL_ISSUE', status: SETTLED, from: lastMonth.from, to: lastMonth.to, summary: 1, limit: 1 }, signal)
    : Promise.resolve(null)

  const [stock, issued, baseline] = await Promise.all([stockRead, issuedRead, baselineRead])

  const issuedLines = Number(issued?.summary?.line_count ?? 0)
  const issuedValue = Number(issued?.summary?.valuation_total ?? 0)
  const priorLines = Number(baseline?.summary?.line_count ?? 0)
  const priorValue = Number(baseline?.summary?.valuation_total ?? 0)

  return {
    currentStock: Number(stock.summary?.closing_qty ?? 0),
    issuedLines,
    issuedValue,
    issuedLinesDelta: deltaPercent(issuedLines, priorLines),
    issuedValueDelta: deltaPercent(issuedValue, priorValue),
  }
}

/**
 * Posted production documents to issue against.
 *
 * PRODUCTION is one of Inventory's own document types, so this is a read of
 * this product's own register — not a work order pulled out of another
 * Aicountly application. If a manufacturing product ever owns work orders, it
 * gets its own adapter beside this one and its own live API; it does not get a
 * copy of its table here.
 */
export async function searchProductionDocuments(q: string, signal?: AbortSignal): Promise<DocumentListRow[]> {
  const res = await documentsApi.list(
    { document_type: 'PRODUCTION', status: SETTLED, q: q.trim() || undefined, limit: 20, sort: 'document_date', order: 'desc' },
    signal,
  )
  return res.data
}
