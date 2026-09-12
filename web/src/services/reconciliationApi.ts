/**
 * `/v1/reconciliation` — Inventory closing valuation vs the Books stock ledger,
 * explained through buckets, plus the live composite posting status per
 * Books-sourced document.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

export type ReconciliationStatus = 'COMPLETED' | 'FAILED' | 'BOOKS_UNAVAILABLE'
export const RECONCILIATION_STATUSES: ReconciliationStatus[] = ['COMPLETED', 'FAILED', 'BOOKS_UNAVAILABLE']

export interface ReconciliationRun {
  run_id: number
  run_uuid: string | null
  cmp_id: number
  fy_id: number
  bo_id: number
  as_of_date: string
  inventory_closing_value: number | null
  inventory_closing_qty: number | null
  books_stock_ledger_balance: number | null
  difference: number | null
  status: ReconciliationStatus | string
  requested_by: string | null
  created_at: string
}

export interface BucketDocument {
  document_id: number
  document_uuid?: string | null
  document_type?: string | null
  document_no: string | null
  document_date: string
  status?: string
  source_app?: string | null
  source_document_type?: string | null
  source_document_id?: number | null
  source_document_no?: string | null
  reason?: string | null
  stock_effect?: number
  amount?: number
  gap?: number
}

/** Every bucket carries amount + count; the rest depends on the bucket. */
export interface ReconciliationBucket {
  amount: number
  count: number
  documents?: BucketDocument[]
  entries?: PostingStatusEntry[]
  books_reported?: unknown[]
  books_reported_total?: number
  stock_effect?: number
  inventory_total?: number
  inventory_opening_value?: number
  books_opening_balance?: number | null
  books_reported_flag?: boolean
  delta_total?: number
  oldest?: string | null
  newest?: string | null
  closing_valuation?: number
  opening_plus_movements?: number
  movement_value_in?: number
  movement_value_out?: number
  unvalued_movements?: number
  [key: string]: unknown
}

export interface ReconciliationBreakdown {
  as_of: string
  sign_convention: string
  explained_total: number
  residual: number | null
  books: { available: boolean; status: number; error: string | null }
  buckets: Record<string, ReconciliationBucket>
  error?: string
}

export type SyncStatus =
  | 'IN_SYNC'
  | 'PENDING_INVENTORY'
  | 'FAILED_INVENTORY'
  | 'REVERSED_INVENTORY'
  | 'CANCELLED_IN_BOOKS'
  | 'MISSING_IN_BOOKS'
  | 'MISSING_IN_INVENTORY'
  | 'PENDING_IN_BOOKS'
  | 'FAILED_IN_BOOKS'
  | 'BOOKS_UNAVAILABLE'
  | 'CANCELLED_BOTH'

export const SYNC_STATUSES: SyncStatus[] = [
  'IN_SYNC',
  'PENDING_INVENTORY',
  'FAILED_INVENTORY',
  'REVERSED_INVENTORY',
  'CANCELLED_IN_BOOKS',
  'MISSING_IN_BOOKS',
  'MISSING_IN_INVENTORY',
  'PENDING_IN_BOOKS',
  'FAILED_IN_BOOKS',
  'BOOKS_UNAVAILABLE',
  'CANCELLED_BOTH',
]

export interface PostingStatusEntry {
  sync_status: SyncStatus | string
  inventory: {
    document_id: number
    document_uuid: string | null
    document_type: string
    document_no: string | null
    document_date: string
    status: string
    posted_at: string | null
    cancelled_at: string | null
    failure_reason: string | null
    stock_effect: number
    bo_id: number
  } | null
  source: {
    source_app: string | null
    source_document_type: string | null
    source_document_id: number | null
    source_document_uuid: string | null
    source_document_no: string | null
  }
  books: {
    source_document_id: number
    source_document_uuid: string | null
    source_document_type: string | null
    document_no: string | null
    document_date: string | null
    status: string | null
    amount: number | null
    raw?: unknown
  } | null
}

export interface DocumentStatusBlock {
  books_available: boolean
  books_error: string | null
  summary: Record<string, number>
  entries: PostingStatusEntry[]
  truncated?: boolean
}

export interface ReconciliationRunDetail extends ReconciliationRun {
  breakdown: ReconciliationBreakdown | null
  document_status: DocumentStatusBlock | null
}

export interface RunFilters extends ListQuery {
  status?: string
  from?: string
  to?: string
  all_fy?: boolean | number | string
}

export interface PostingStatusFilters extends ListQuery {
  sync_status?: string
  source_document_type?: string
  source_document_id?: number | string
}

export interface PostingStatusResponse extends ListResponse<PostingStatusEntry> {
  summary: Record<string, number>
  books_available: boolean
  books_error: string | null
}

export const reconciliationApi = {
  runs(filters: RunFilters = {}, signal?: AbortSignal): Promise<ListResponse<ReconciliationRun>> {
    return api.list<ReconciliationRun>('v1/reconciliation', filters, { signal })
  },

  async run(asOf?: string): Promise<ReconciliationRunDetail> {
    const res = await api.post<ItemResponse<ReconciliationRunDetail>>('v1/reconciliation/run', asOf ? { as_of: asOf } : {})
    return res.data
  },

  async get(id: number, signal?: AbortSignal): Promise<ReconciliationRunDetail> {
    const res = await api.get<ItemResponse<ReconciliationRunDetail>>(`v1/reconciliation/${id}`, { signal })
    return res.data
  },

  postingStatus(filters: PostingStatusFilters = {}, signal?: AbortSignal): Promise<PostingStatusResponse> {
    return api.list<PostingStatusEntry>('v1/reconciliation/posting-status', filters, { signal }) as Promise<PostingStatusResponse>
  },
}
