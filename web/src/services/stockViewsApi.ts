/**
 * Stock views: the materialised balance grid (`/v1/stock-balances`), the
 * append-only movement ledger (`/v1/stock-movements`) and one item's ledger with
 * running balances (`/v1/reports/stock-ledger`).
 */

import { api } from './api'
import type { ListQuery, ListResponse } from './api'

// ---- balances ----------------------------------------------------------------------------

/** Row of inv_stock_balances joined with item / warehouse / batch names. */
export interface StockBalanceGridRow {
  balance_id: number
  cmp_id: number
  item_id: number
  warehouse_id: number | null
  batch_id: number | null
  location_id?: number | null
  on_hand_qty: number | string
  reserved_qty: number | string
  committed_qty: number | string
  packed_qty: number | string
  in_transit_qty: number | string
  job_worker_qty: number | string
  quality_hold_qty: number | string
  damaged_qty: number | string
  blocked_qty: number | string
  expected_qty: number | string
  last_movement_at: string | null
  item_name: string | null
  item_sku: string | null
  warehouse_name: string | null
  batch_no: string | null
  available_qty: number | string
}

export interface BalanceFilters extends ListQuery {
  warehouse_id?: number | string
  item_id?: number | string
  nonzero?: boolean | number | string
}

export const stockBalancesApi = {
  list(filters: BalanceFilters = {}, signal?: AbortSignal): Promise<ListResponse<StockBalanceGridRow>> {
    return api.list<StockBalanceGridRow>('v1/stock-balances', filters, { signal })
  },
}

// ---- movements ----------------------------------------------------------------------------

export type MovementKind = 'physical' | 'reversal' | 'revaluation'

export interface StockMovementRow {
  movement_id: number
  movement_uuid: string
  cmp_id: number
  fy_id: number
  bo_id: number
  document_id: number | null
  line_id: number | null
  document_type: string
  document_type_label?: string
  movement_date: string
  sequence_no: number | null
  item_id: number
  warehouse_id: number | null
  location_id: number | null
  batch_id: number | null
  direction: 'in' | 'out' | string
  /** Signed base quantity (out is negative). */
  qty: number
  unit_cost: number | null
  value: number | null
  movement_kind: MovementKind | string
  reversal_of_movement_id: number | null
  created_at: string | null
  created_by: string | null
  item_name: string | null
  item_alias: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  warehouse_name: string | null
  warehouse_code: string | null
  batch_no: string | null
  document_no: string | null
  document_status: string | null
  source_app: string | null
  source_document_type: string | null
  source_document_id: number | null
  source_document_no: string | null
  party_ref: number | null
  party_name: string | null
}

export interface MovementFilters extends ListQuery {
  item_id?: number | string
  warehouse_id?: number | string
  document_id?: number | string
  batch_id?: number | string
  /** Comma-separated document type codes. */
  document_type?: string
  direction?: 'in' | 'out' | string
  movement_kind?: MovementKind | string
  from?: string
  to?: string
  all_fy?: boolean | number | string
}

export const stockMovementsApi = {
  list(filters: MovementFilters = {}, signal?: AbortSignal): Promise<ListResponse<StockMovementRow>> {
    return api.list<StockMovementRow>('v1/stock-movements', filters, { signal })
  },
}

// ---- item ledger ---------------------------------------------------------------------------

export interface LedgerRow {
  movement_id: number
  movement_uuid: string
  movement_date: string
  document_id: number
  line_id: number
  document_type: string
  document_type_label: string
  document_no: string | null
  document_status: string | null
  source_app: string | null
  source_document_type: string | null
  source_document_no: string | null
  party_ref: number | null
  party_name: string | null
  narration: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  location_id: number | null
  batch_id: number | null
  batch_no: string | null
  direction: string
  movement_kind: string
  reversal_of_movement_id: number | null
  in_qty: number
  out_qty: number
  qty: number
  line_qty: number | null
  line_unit_id: number | null
  line_unit_symbol: string | null
  line_description: string | null
  unit_cost: number | null
  value: number | null
  balance_qty: number
  balance_value: number
  created_at: string | null
}

export interface LedgerSummary {
  opening_qty: number
  opening_value: number
  in_qty: number
  out_qty: number
  in_value: number
  out_value: number
  closing_qty: number
  closing_value: number
  from: string | null
  to: string | null
  warehouse_id: number | null
}

export interface LedgerItem {
  item_id: number
  item_name: string | null
  item_alias: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  grp_name: string | null
  cat_name: string | null
  valuation_method: string | null
  is_active: number | null
}

export interface LedgerResponse extends ListResponse<LedgerRow> {
  summary: LedgerSummary
  item: LedgerItem
  report: string
}

export interface LedgerQuery extends ListQuery {
  item_id: number | string
  warehouse_id?: number | string
  from?: string
  to?: string
}

export const stockLedgerApi = {
  get(query: LedgerQuery, signal?: AbortSignal): Promise<LedgerResponse> {
    return api.list<LedgerRow>('v1/reports/stock-ledger', query, { signal }) as Promise<LedgerResponse>
  },
}
