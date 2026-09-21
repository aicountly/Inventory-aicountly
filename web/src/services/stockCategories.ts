/**
 * The two stock-category endpoints that are not plain CRUD.
 *
 * `stockCategoriesApi` in services/masters.ts still owns list / get / create /
 * update / delete — this only adds what the revamped screen needs on top: the
 * company-wide figures above the list, and the bulk activate / deactivate the
 * selection bar calls. Both are server-side for the same reason: a total
 * derived from the page on screen contradicts the footer beside it, and a
 * "deactivate 12" that fires twelve PUTs is twelve chances to half-finish.
 */

import { api } from './api'
import type { ItemResponse } from './api'

export interface StockCategoryMostUsed {
  stock_cat_id: number
  cat_name: string
  item_count: number
}

export interface StockCategorySummary {
  total: number
  active: number
  inactive: number
  /** Categories created since the 1st of the current month. */
  created_this_month: number
  /** null while nothing is categorised yet — never a stand-in category. */
  most_used: StockCategoryMostUsed | null
  /** Items in the company with no stock category at all. */
  uncategorised_items: number
}

function toInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** `GET /v1/stock-categories/summary`. */
export async function fetchStockCategorySummary(signal?: AbortSignal): Promise<StockCategorySummary> {
  const res = await api.get<ItemResponse<Partial<StockCategorySummary>>>('v1/stock-categories/summary', { signal })
  const d = res.data ?? {}
  const most = d.most_used
  return {
    total: toInt(d.total),
    active: toInt(d.active),
    inactive: toInt(d.inactive),
    created_this_month: toInt(d.created_this_month),
    most_used:
      most && toInt(most.stock_cat_id) > 0
        ? { stock_cat_id: toInt(most.stock_cat_id), cat_name: String(most.cat_name ?? ''), item_count: toInt(most.item_count) }
        : null,
    uncategorised_items: toInt(d.uncategorised_items),
  }
}

export interface BulkStatusResult {
  updated: number
  is_active: number
}

/** `POST /v1/stock-categories/bulk-status`. */
export async function bulkSetStockCategoryStatus(ids: readonly number[], isActive: boolean): Promise<BulkStatusResult> {
  const res = await api.post<ItemResponse<Partial<BulkStatusResult>>>('v1/stock-categories/bulk-status', {
    ids: [...ids],
    is_active: isActive ? 1 : 0,
  })
  return { updated: toInt(res.data?.updated), is_active: isActive ? 1 : 0 }
}
