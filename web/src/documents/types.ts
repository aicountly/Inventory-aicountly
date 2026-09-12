/**
 * Inventory document shapes as served by `/v1/inventory-documents` (DocumentService::hydrate)
 * and the create / update payload DocumentService::create accepts.
 */

export type DocumentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTING'
  | 'POSTED'
  | 'PARTIALLY_FULFILLED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'FAILED'

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTING',
  'POSTED',
  'PARTIALLY_FULFILLED',
  'COMPLETED',
  'CANCELLED',
  'REVERSED',
  'FAILED',
]

export type LineDirection = 'in' | 'out' | 'none'

export interface LineSerial {
  serial_id: number
  serial_no: string | null
}

export interface DocumentLine {
  line_id: number
  line_uuid?: string
  document_id: number
  item_id: number
  item_name?: string | null
  item_print_name?: string | null
  item_label?: string | null
  item_sku?: string | null
  warehouse_id: number | null
  warehouse_name?: string | null
  dest_warehouse_id: number | null
  dest_warehouse_name?: string | null
  location_id: number | null
  batch_id: number | null
  batch_no?: string | null
  expiry_date?: string | null
  unit_id: number | null
  unit_symbol?: string | null
  unit_name?: string | null
  direction: LineDirection
  qty: number
  conversion_factor: number
  base_qty: number
  source_transaction_rate: number | null
  source_transaction_amount: number | null
  valuation_rate: number | null
  valuation_amount: number | null
  valuation_method_applied: string | null
  landed_cost_amount: number | null
  book_qty: number | null
  physical_qty: number | null
  hsn_sac?: string | null
  description?: string | null
  sort_order: number
  metadata: Record<string, unknown> | null
  serials: LineSerial[]
}

export interface AccountingEffect {
  effect: string
  amount: number
  line_id?: number
  item_id?: number
  base_qty?: number
  valuation_rate?: number
}

/** Row of inv_document_approvals (submitted | approved | rejected). */
export interface DocumentApproval {
  approval_id: number
  action: string
  actor_uuid: string | null
  notes: string | null
  created_at: string
}

export interface PostingWarning {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface PackingMeta {
  document_id: number
  consignee_ref: number | null
  packing_status: 'open' | 'locked' | 'consumed' | 'unpacked'
  locked_by_document_id: number | null
  locked_by_external_ref: string | null
  locked_at: string | null
  box_marks: unknown
  is_locked: boolean
  is_open: boolean
}

export interface InventoryDocument {
  document_id: number
  document_uuid: string
  cmp_id: number
  bo_id: number
  fy_id: number
  document_type: string
  document_type_label?: string
  document_no: string | null
  series_id: number | null
  document_date: string
  status: DocumentStatus
  source_app: string
  source_document_type: string | null
  source_document_id: number | null
  source_document_uuid: string | null
  source_document_no: string | null
  source_document_date: string | null
  party_ref: number | null
  party_name: string | null
  dest_party_ref: number | null
  from_warehouse_id: number | null
  to_warehouse_id: number | null
  dest_bo_id: number | null
  stock_effect: string | null
  returnable: boolean | null
  expected_return_date: string | null
  movement_reason: string | null
  reason_code: string | null
  narration: string | null
  currency_code: string
  exchange_rate: number | string
  metadata: Record<string, unknown> | null
  accounting_effects: AccountingEffect[]
  reverses_document_id: number | null
  reversed_by_document_id: number | null
  approved_by: string | null
  approved_at: string | null
  posted_by: string | null
  posted_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  failure_reason: string | null
  version: number
  created_by: string | null
  created_at: string | null
  updated_by: string | null
  updated_at: string | null
  lines: DocumentLine[]
  /** Present once the API ships the approvals trail on the detail resource. */
  approvals?: DocumentApproval[]
  /** Returned by post(): non-fatal notes (negative stock warnings, FY unverified). */
  warnings?: PostingWarning[]
  duplicate?: boolean
  /** Packing lists: inv_packing_meta (null until posted). */
  packing?: PackingMeta | null
}

/** Row of GET /v1/inventory-documents. */
export interface DocumentListRow {
  document_id: number
  document_uuid: string
  document_type: string
  document_type_label?: string
  document_no: string | null
  document_date: string
  status: DocumentStatus
  source_app: string
  source_document_type: string | null
  source_document_id: number | null
  source_document_no: string | null
  party_ref: number | null
  party_name: string | null
  from_warehouse_id: number | null
  to_warehouse_id: number | null
  narration: string | null
  posted_at: string | null
  created_at: string | null
  fy_id: number
  bo_id: number
  line_count: number | string
  valuation_total: number | string
}

// ---------------------------------------------------------------------------
// Create / update payload (DocumentService::create / update)
// ---------------------------------------------------------------------------

export interface CreateDocumentLine {
  item_id: number
  warehouse_id?: number | null
  /** Transfer lines may override the header's source warehouse. */
  from_warehouse_id?: number | null
  unit_id?: number | null
  qty: number
  rate?: number | null
  amount?: number | null
  /** Required for by_line types; ignored for fixed / transfer / status types. */
  direction?: 'in' | 'out'
  batch_id?: number | null
  serials?: number[]
  book_qty?: number | null
  physical_qty?: number | null
  /** Per base unit: physical adjustment / write-in cost, revaluation new cost, production finished rate. */
  valuation_rate?: number | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

export interface JobWorkSettlement {
  pending_id: number
  qty: number
  settlement_type: 'consumed' | 'returned'
}

export interface ChallanSettlement {
  source_document_id: number
  item_id: number
  qty: number
  warehouse_id?: number | null
}

export interface DocumentMetadata {
  bom_id?: number
  production_qty?: number
  finished_rate?: number
  warehouse_id?: number | null
  job_work_settlements?: JobWorkSettlement[]
  challan_settlements?: ChallanSettlement[]
  linked_source_document_id?: number
  box_marks?: string[]
  [key: string]: unknown
}

export interface CreateDocumentPayload {
  document_type: string
  document_date: string
  document_no?: string | null
  party_ref?: number | null
  party_name?: string | null
  from_warehouse_id?: number | null
  to_warehouse_id?: number | null
  stock_effect?: string | null
  returnable?: boolean | null
  expected_return_date?: string | null
  movement_reason?: string | null
  reason_code?: string | null
  narration?: string | null
  metadata?: DocumentMetadata | null
  lines: CreateDocumentLine[]
  /** Post into negative stock (needs stock.negative_override). */
  negative_override?: boolean
}

/** Server-side print snapshot (inv_document_snapshots) with the *_json columns decoded. */
export interface PrintSnapshot {
  snap_id: number
  document_id: number
  document_variant: string
  document_no: string | null
  document_date: string | null
  currency_code: string
  header_snapshot: Record<string, unknown> | null
  source_dest_snapshot: Record<string, unknown> | null
  item_lines_snapshot: Array<Record<string, unknown>> | null
  transport_snapshot: Record<string, unknown> | null
  variant_extras_snapshot: Record<string, unknown> | null
  footer_snapshot: Record<string, unknown> | null
  template_version: string
  status: string
  created_at: string
}

/** Row of GET /v1/document-types (SettingsController::documentTypes). */
export interface DocumentTypeRow {
  code: string
  label: string
  line_mode: string
  valuation: boolean
  cogs: boolean
  native: boolean
  legacy_vch_type: number | null
}
