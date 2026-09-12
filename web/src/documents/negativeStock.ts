/**
 * `negative_stock_blocked` (422) from DocumentPostingService::enforceNegativeStock carries the
 * first offending line in `error.details`: {item_id, item_name, warehouse_id, on_hand, required,
 * short_by}. Later API versions may return a list; both shapes are accepted.
 */

import { isApiError } from '../services/api'
import { toNumber } from '../utils/format'
import type { LineDraft } from './formModel'
import type { DocumentLine } from './types'

export const NEGATIVE_STOCK_CODE = 'negative_stock_blocked'

export interface NegativeStockDetail {
  item_id: number | null
  item_name: string | null
  warehouse_id: number | null
  on_hand: number | null
  required: number | null
  short_by: number | null
}

function detailFrom(raw: unknown): NegativeStockDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const itemId = toNumber(r.item_id)
  if (itemId === null && r.item_name === undefined) return null
  return {
    item_id: itemId,
    item_name: typeof r.item_name === 'string' ? r.item_name : null,
    warehouse_id: toNumber(r.warehouse_id),
    on_hand: toNumber(r.on_hand),
    required: toNumber(r.required),
    short_by: toNumber(r.short_by ?? r.shortfall),
  }
}

/** Offending lines when `err` is a negative-stock block, else null. */
export function parseNegativeStock(err: unknown): NegativeStockDetail[] | null {
  if (!isApiError(err) || err.code !== NEGATIVE_STOCK_CODE) return null
  const details = err.details as unknown
  const list: unknown[] = Array.isArray(details)
    ? details
    : details && typeof details === 'object' && Array.isArray((details as { lines?: unknown }).lines)
      ? ((details as { lines: unknown[] }).lines)
      : [details]
  const out = list.map(detailFrom).filter((d): d is NegativeStockDetail => d !== null)
  return out
}

function matches(detail: NegativeStockDetail, itemId: number | null, warehouseId: number | null): boolean {
  if (detail.item_id === null || itemId === null || detail.item_id !== itemId) return false
  if (detail.warehouse_id === null || warehouseId === null) return true
  return detail.warehouse_id === warehouseId
}

/** Keys of the draft lines the block refers to (out lines of the same item and warehouse). */
export function offendingDraftKeys(lines: LineDraft[], details: NegativeStockDetail[]): string[] {
  return lines.filter((l) => l.direction !== 'in' && details.some((d) => matches(d, l.item_id, l.warehouse_id))).map((l) => l.key)
}

/** Ids of the stored lines the block refers to. */
export function offendingLineIds(lines: DocumentLine[], details: NegativeStockDetail[]): number[] {
  return lines.filter((l) => l.direction === 'out' && details.some((d) => matches(d, l.item_id, l.warehouse_id))).map((l) => l.line_id)
}
