/**
 * Items → Bulk Tax Rate Update — the Inventory-side client for
 * `/v1/operations/bulk-tax-update/*`, a thin proxy onto Books' own Operations →
 * Bulk Update engine (target `item_tax_category`; see the PHP service's docblock
 * for why this has to be a proxy rather than a local Inventory write).
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

/** One row of the item grid — Books' own bulk-update record shape, camel-free to match it exactly. */
export interface BulkTaxUpdateRow {
  id: number
  label: string
  item_grp_name?: string | null
  stock_cat_name?: string | null
  tax_cat_name?: string | null
  tax_cat_id?: number | null
  hsn_sac?: string | null
}

export interface BulkTaxUpdateRecordsQuery extends ListQuery {
  stock_cat_id?: number | ''
  item_grp_id?: number | ''
  tax_cat_id?: number | ''
  hsn?: string
}

export function fetchBulkTaxUpdateRecords(query: BulkTaxUpdateRecordsQuery = {}): Promise<ListResponse<BulkTaxUpdateRow>> {
  return api.list<BulkTaxUpdateRow>('v1/operations/bulk-tax-update/records', query)
}

/** Books' own tax-category master — the only place a rate_percent exists. */
export interface BooksTaxCategory {
  tax_cat_id: number
  tax_cat_name: string
  rate_percent?: number | string | null
  is_active?: number
}

export async function fetchBulkTaxCategories(signal?: AbortSignal): Promise<BooksTaxCategory[]> {
  const res = await api.get<ItemResponse<BooksTaxCategory[]> | { data?: BooksTaxCategory[] }>(
    'v1/operations/bulk-tax-update/tax-categories',
    { signal },
  )
  return Array.isArray(res?.data) ? res.data : []
}

export function taxCategoryOptionLabel(cat: BooksTaxCategory): string {
  const rate = cat.rate_percent === null || cat.rate_percent === undefined ? null : Number(cat.rate_percent)
  return rate === null || Number.isNaN(rate) ? cat.tax_cat_name : `${cat.tax_cat_name} (${rate}%)`
}

/** One row of a validate/apply batch — Books takes {id, values: {tax_cat_id}}. */
export interface BulkTaxUpdateBatchRow {
  id: number
  label?: string
  values: { tax_cat_id: number }
}

export interface BulkTaxUpdateChange {
  field: string
  label: string
  from: unknown
  to: unknown
  deferred?: boolean
}

export interface BulkTaxUpdateRowResult {
  id: number
  row?: number
  label: string
  changes: BulkTaxUpdateChange[]
  errors: Record<string, string>
  notes: string[]
  status: 'ok' | 'error' | 'unchanged'
}

export interface BulkTaxUpdateValidation {
  rows: BulkTaxUpdateRowResult[]
  summary: { total: number; updatable: number; unchanged: number; invalid: number }
}

export interface BulkTaxUpdateApplyResult {
  target: string
  target_label: string
  updated: number
  unchanged: number
  changed_fields: number
  rows: BulkTaxUpdateRowResult[]
}

interface BatchRequest {
  rows: BulkTaxUpdateBatchRow[]
  effective_from?: string
}

export function validateBulkTaxUpdate(rows: BulkTaxUpdateBatchRow[], effectiveFrom: string): Promise<ItemResponse<BulkTaxUpdateValidation>> {
  const body: BatchRequest = { rows }
  if (effectiveFrom) body.effective_from = effectiveFrom
  return api.post<ItemResponse<BulkTaxUpdateValidation>>('v1/operations/bulk-tax-update/validate', body)
}

export function applyBulkTaxUpdate(rows: BulkTaxUpdateBatchRow[], effectiveFrom: string): Promise<ItemResponse<BulkTaxUpdateApplyResult>> {
  const body: BatchRequest = { rows }
  if (effectiveFrom) body.effective_from = effectiveFrom
  return api.post<ItemResponse<BulkTaxUpdateApplyResult>>('v1/operations/bulk-tax-update/apply', body)
}
