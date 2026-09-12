/**
 * `/v1/reports/*` — read-only inventory reports (InventoryReportService).
 * Every report answers the list envelope plus `summary` and `report`.
 */

import { api } from './api'
import type { ListQuery, ListResponse } from './api'

export interface ReportResponse<T, S = Record<string, unknown>> extends ListResponse<T> {
  summary: S
  report: string
}

export function fetchReport<T, S = Record<string, unknown>>(path: string, query: ListQuery, signal?: AbortSignal): Promise<ReportResponse<T, S>> {
  return api.list<T>(`v1/reports/${path}`, query, { signal }) as Promise<ReportResponse<T, S>>
}

/** Columns every item-keyed report shares (InventoryReportService::itemColumns). */
export interface ReportItemColumns {
  item_id: number
  item_name: string | null
  item_alias: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  item_grp_id: number | null
  grp_name?: string | null
  stock_cat_id: number | null
  cat_name?: string | null
  valuation_method?: string | null
  is_active?: number | null
}

export interface StockSummaryRow extends ReportItemColumns {
  opening_qty: number
  in_qty: number
  out_qty: number
  closing_qty: number
  unit_cost: number
  closing_value: number
  valuation_method_applied: string | null
}

export interface StockSummarySummary {
  items: number
  opening_qty: number
  in_qty: number
  out_qty: number
  closing_qty: number
  closing_value: number
  from: string | null
  to: string
}

export interface WarehouseStockRow extends StockSummaryRow {
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
}

export interface WarehouseStockSummary {
  rows: number
  closing_qty: number
  closing_value: number
  by_warehouse: { warehouse_id: number | null; warehouse_name: string | null; closing_qty: number; closing_value: number }[]
  to: string
}

export interface BatchStockRow extends ReportItemColumns {
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  batch_id: number
  batch_no: string | null
  lot_no: string | null
  mfg_date: string | null
  expiry_date: string | null
  batch_status: string | null
  days_to_expiry: number | null
  is_expired: boolean
  last_movement_at: string | null
  on_hand: number
  reserved: number
  committed: number
  packed: number
  in_transit: number
  job_worker: number
  quality_hold: number
  damaged: number
  blocked: number
  expected: number
  available: number
  unit_cost: number
  stock_value: number
}

export interface BatchStockSummary {
  batches: number
  items: number
  on_hand: number
  reserved: number
}

export interface SerialStockRow {
  serial_id: number
  serial_uuid: string | null
  serial_no: string
  status: string
  unit_cost: number | null
  warranty_until: string | null
  created_at: string | null
  updated_at: string | null
  item_id: number
  item_name: string | null
  item_alias: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  batch_id: number | null
  batch_no: string | null
  expiry_date: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  location_id: number | null
  location_code: string | null
  location_name: string | null
  received_document_id: number | null
  received_document_no: string | null
  received_date: string | null
  received_document_type: string | null
  issued_document_id: number | null
  issued_document_no: string | null
  issued_date: string | null
  issued_document_type: string | null
  issued_to: string | null
}

export interface SerialStockSummary {
  by_status: Record<string, number>
  statuses_applied: string[] | null
  total_all_statuses: number
}

export type AgeBucketKey = '0_30' | '31_60' | '61_90' | '91_180' | '180_plus'
export interface AgeBucket {
  qty: number
  value: number
}

export interface StockAgeingRow extends ReportItemColumns {
  warehouse_id: number | null
  warehouse_name: string | null
  buckets: Record<AgeBucketKey, AgeBucket>
  total_qty: number
  total_value: number
  oldest_days: number | null
  newest_days: number | null
  weighted_age_days: number | null
  layers: number
  aged_from: string | null
}

export interface StockAgeingSummary {
  items: number
  total_qty: number
  total_value: number
  buckets: Record<AgeBucketKey, AgeBucket>
  bucket_labels: Record<AgeBucketKey, string>
  as_of: string
}

export type MovementClass = 'fast' | 'slow' | 'non_moving' | 'dead'

export interface MovementAnalysisRow extends ReportItemColumns {
  on_hand: number
  period_in_qty: number
  period_out_qty: number
  period_out_value: number
  period_out_docs: number
  last_movement_date: string | null
  last_in_date: string | null
  last_out_date: string | null
  days_since_last_out: number | null
  days_since_last_movement: number | null
  classification: MovementClass
  days_of_cover: number | null
}

export interface MovementAnalysisSummary {
  from: string
  to: string
  thresholds: { fast_days: number; slow_days: number; dead_days: number }
  by_class: Record<MovementClass, { items: number; on_hand: number; period_out_qty: number }>
}

export interface NearExpiryRow extends ReportItemColumns {
  batch_id: number
  batch_no: string | null
  lot_no: string | null
  mfg_date: string | null
  expiry_date: string
  batch_status: string | null
  days_to_expiry: number
  is_expired: boolean
  shelf_life_days: number | null
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  on_hand: number
  reserved: number
  packed: number
  quality_hold: number
  damaged: number
  blocked: number
  unit_cost: number
  stock_value: number
}

export interface NearExpirySummary {
  as_of: string
  days: number
  until: string
  include_expired: boolean
  batches: number
  items: number
  on_hand: number
  expired_batches: number
  expired_qty: number
}

export interface ReplenishmentRow extends ReportItemColumns {
  standard_cost: number | null
  min_stock_qty: number | null
  max_stock_qty: number | null
  reorder_point_qty: number | null
  reorder_qty: number | null
  safety_stock_qty: number | null
  lead_time_days: number | null
  default_warehouse_id: number | null
  default_warehouse_name: string | null
  on_hand: number
  reserved: number
  committed: number
  packed: number
  in_transit: number
  job_worker: number
  quality_hold: number
  damaged: number
  blocked: number
  expected_balance: number
  available: number
  expected: number
  pending_out: number
  projected: number
  triggered: boolean
  reasons: string[]
  target_basis: string | null
  target_qty: number | null
  suggested_qty: number
  suggested_value: number | null
  needed_by: string | null
}

export interface ReplenishmentSummary {
  triggered_total: number
  page_suggested_qty: number
  page_suggested_value: number
  warehouse_id: number | null
}
