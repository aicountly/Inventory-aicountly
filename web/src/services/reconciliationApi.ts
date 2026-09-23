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
  /**
   * Inventory-internal-only figures (valuation_method_variance, transfer_valuation_gap) --
   * neither reads anything Books reported, so neither is counted in `explained_total`/`residual`
   * and neither belongs in `buckets`, where it would read as a real Books comparison. Absent on
   * runs computed before this field existed.
   */
  diagnostics?: Record<string, ReconciliationBucket>
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
  | 'BOOKS_STATUS_UNKNOWN'

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
  'BOOKS_STATUS_UNKNOWN',
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

/**
 * The last known verdict for this company — ONE indexed row on the server, never a fresh
 * reconciliation. The banner that shows it says how old it is rather than pretending it is live.
 */
export interface ReconciliationStatusSummary {
  has_run: boolean
  run_id?: number
  as_of_date?: string
  ran_at?: string
  status?: ReconciliationStatus | string
  difference?: number | null
  inventory_closing_value?: number
  books_stock_ledger_balance?: number | null
  opening_difference?: number
  unexplained?: number
  /**
   * Which system Books says owns the Stock-in-Hand figure, and therefore what a difference MEANS.
   * On `inventory` both ways a person could diverge the two are closed, so a gap is a defect; on
   * `manual` it is a figure somebody chose. Null when the run predates Books reporting it.
   */
  stock_source: 'manual' | 'inventory' | null
}

export interface HealAction {
  bucket: string
  action: string
  amount: number
  detail: string
  performed: boolean
  result: string | null
}

export interface HealSkipped {
  bucket: string
  amount: number
  reason: string
}

export interface HealResult {
  dry_run: boolean
  as_of: string
  difference: number | null
  actions: HealAction[]
  skipped: HealSkipped[]
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

  async status(signal?: AbortSignal): Promise<ReconciliationStatusSummary> {
    const res = await api.get<ItemResponse<ReconciliationStatusSummary>>('v1/reconciliation/status', { signal })
    return res.data
  },

  /** `dryRun` asks for the plan; without it the safe actions are performed. */
  async heal(dryRun: boolean): Promise<HealResult> {
    const res = await api.post<ItemResponse<HealResult>>('v1/reconciliation/heal', { dry_run: dryRun })
    return res.data
  },

  postingStatus(filters: PostingStatusFilters = {}, signal?: AbortSignal): Promise<PostingStatusResponse> {
    return api.list<PostingStatusEntry>('v1/reconciliation/posting-status', filters, { signal }) as Promise<PostingStatusResponse>
  },
}
