/**
 * Stock-side endpoints the document screens lean on: availability, balances, pending
 * quantities (challans / job work / deferred purchases), packing lists and reservations.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'
import type { InventoryDocument } from '../documents/types'
import { newIdempotencyKey } from './documentsApi'

function idempotent(): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': newIdempotencyKey() } }
}

// ---- availability ----------------------------------------------------------------------

export interface AvailabilityCheckLine {
  item_id: number
  warehouse_id?: number | null
  batch_id?: number | null
  /** Base units. */
  qty: number
}

export interface AvailabilityCheckResult {
  index: number
  item_id: number
  requested: number
  available: number
  on_hand: number
  ok: boolean
  short_by?: number
  shortfall?: number
}

export interface AvailabilityRow {
  item_id: number
  warehouse_id: number | null
  batch_id?: number | null
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
  projected: number
}

export interface StockBalanceRow {
  balance_id: number
  item_id: number
  item_name: string | null
  item_sku: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  batch_id: number | null
  batch_no: string | null
  on_hand_qty: number | string
  reserved_qty: number | string
  packed_qty: number | string
  job_worker_qty: number | string
  available_qty: number | string
}

export const availabilityApi = {
  async check(lines: AvailabilityCheckLine[], signal?: AbortSignal): Promise<{ ok: boolean; lines: AvailabilityCheckResult[] }> {
    const res = await api.post<ItemResponse<{ ok: boolean; lines: AvailabilityCheckResult[] }>>('v1/availability/check', { lines }, { signal })
    return res.data
  },

  async forItems(itemIds: number[], warehouseId?: number | null, byBatch = false, signal?: AbortSignal): Promise<AvailabilityRow[]> {
    if (itemIds.length === 0) return []
    const res = await api.get<ItemResponse<AvailabilityRow[]>>('v1/availability', {
      query: { item_ids: itemIds.join(','), warehouse_id: warehouseId ?? undefined, by_batch: byBatch ? 1 : undefined },
      signal,
    })
    return res.data
  },

  balances(query: ListQuery & { warehouse_id?: number; item_id?: number; nonzero?: boolean } = {}, signal?: AbortSignal): Promise<ListResponse<StockBalanceRow>> {
    return api.list<StockBalanceRow>('v1/stock-balances', query, { signal })
  },
}

/** `short_by` today, `shortfall` per the published contract. */
export function shortBy(r: AvailabilityCheckResult): number {
  return Number(r.short_by ?? r.shortfall ?? 0) || 0
}

// ---- pending quantities -----------------------------------------------------------------

export type PendingKind = 'challan' | 'deferred_purchase' | 'job_work'

/**
 * The register's display status, which is NOT the stored one.
 *
 * `inv_pending_quantities.status` knows open / partial / settled / cancelled.
 * The register adds `overdue` (past the document's expected return date, or past
 * the company's grace period when it recorded none) and `settling` (part-settled
 * with a settlement inside the settling window — work in progress, as against a
 * `partial` that stalled). Both are derived in SQL by PendingRegisterQuery so the
 * filter, the badge and the KPI count cannot disagree.
 */
export type PendingStatus = 'open' | 'partial' | 'overdue' | 'settling' | 'settled' | 'cancelled'

export type PendingPriority = 'high' | 'medium' | 'low'

export interface PendingRow {
  pending_id: number
  cmp_id: number
  fy_id: number
  document_id: number
  line_id: number | null
  pending_kind: PendingKind
  direction: 'in' | 'out'
  item_id: number
  item_name: string | null
  item_sku: string | null
  hsn_sac: string | null
  unit_id: number | null
  unit_symbol: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  party_ref: number | null
  /** Carried on the document, so a register row can name the party rather than its id. */
  party_name: string | null
  qty_original: number
  qty_settled: number
  qty_open: number

  /** Inventory's own cost for the line — the captured valuation rate, else item WAC. */
  unit_cost: number
  /** qty_open × unit_cost. At cost, never at a selling price. */
  pending_value: number

  document_no: string | null
  document_date: string | null
  document_type: string
  document_type_label?: string
  document_status: string | null

  /** What the document promised, where it recorded one. */
  expected_return_date: string | null
  /** The date the line is measured late against: the above, or document date + grace. */
  due_date: string | null
  /** False when `due_date` is the company's grace period standing in for a promise. */
  has_expected_date: boolean
  ageing_days: number
  days_overdue: number
  is_overdue: boolean

  /** The stored settlement state, kept beside the derived display status. */
  settlement_status: 'open' | 'partial' | 'settled' | 'cancelled' | string
  status: PendingStatus
  priority: PendingPriority
  last_activity_at: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** Every figure over the WHOLE filtered set — never the page on screen. */
export interface PendingSummaryResponse {
  open_lines: number
  open_quantity: number
  overdue_lines: number
  overdue_quantity: number
  overdue_value: number
  pending_value: number
  average_ageing_days: number
  inbound_pending: number
  outbound_pending: number
  /** Outbound − inbound: what the register is net exposed to. */
  net_exposure: number
  original_qty_total: number
  settled_qty_total: number
  open_qty_total: number
  settled_today: number
  settled_today_qty: number
  item_count: number
  party_count: number
  warehouse_count: number
  document_count: number
  /** The pre-existing envelope, kept so nothing that read it breaks. */
  qty_open: number
  rows: number
}

/**
 * The same figures a month back (and yesterday, for the daily count), so the KPI
 * cards can show a real delta.
 *
 * Reconstructed from the settlement trail rather than stored, and `null` when it
 * cannot be computed — StatCard then renders its hint and no percentage, which is
 * the designed fallback. Nothing here is ever estimated.
 */
export interface PendingComparison {
  open_lines: number
  open_quantity: number
  overdue_lines: number
  pending_value: number
  average_ageing_days: number
  settled_today: number
  as_of: string
  settled_as_of: string
}

export interface PendingTrendPoint {
  date: string
  open_lines: number
  open_quantity: number
  pending_value: number
}

export interface PendingBreakdownRow {
  /** The id behind the group, for a drill-down. Null where the label IS the value. */
  key: string | null
  label: string
  lines: number
  open_quantity: number
  pending_value: number
  overdue_lines: number
  max_ageing_days: number
}

export interface PendingBreakdowns {
  kind: PendingBreakdownRow[]
  warehouse: PendingBreakdownRow[]
  item: PendingBreakdownRow[]
  party: PendingBreakdownRow[]
  ageing: PendingBreakdownRow[]
  direction: PendingBreakdownRow[]
}

/** The thresholds the ageing, overdue and priority derivations were made on. */
export interface PendingPolicy {
  grace_days: number
  high_overdue_days: number
  high_ageing_days: number
  high_value: number
  settling_window_days: number
}

export interface PendingListResponse extends ListResponse<PendingRow> {
  summary?: PendingSummaryResponse
  previous?: PendingComparison | null
  trend?: PendingTrendPoint[]
  breakdowns?: PendingBreakdowns
  policy?: PendingPolicy
  /** Only sent on an empty page: true when nothing is pending at all. */
  unfiltered_empty?: boolean
}

/** Ageing buckets the API filters on, matching PendingRegisterPolicy. */
export const PENDING_AGEING_BUCKETS = [
  { value: '0_7', label: '0 – 7 days' },
  { value: '8_15', label: '8 – 15 days' },
  { value: '16_30', label: '16 – 30 days' },
  { value: '31_60', label: '31 – 60 days' },
  { value: '60_', label: 'Over 60 days' },
] as const

export interface PendingFilters extends ListQuery {
  kind?: PendingKind
  direction?: 'in' | 'out'
  party_ref?: number
  item_id?: number
  item_search?: string
  warehouse_id?: number
  document_id?: number
  document_no?: string
  document_type?: string
  from?: string
  to?: string
  /** CSV of PendingStatus. Empty means the register's default: open and partial. */
  status?: string
  priority?: string
  ageing_bucket?: string
  ageing_from?: number
  ageing_to?: number
  min_open_qty?: number
  max_open_qty?: number
  min_pending_value?: number
  max_pending_value?: number
  overdue_only?: string
  /** Which optional aggregate blocks to compute; `''` asks for none. */
  include?: string
}

export const pendingApi = {
  list(filters: PendingFilters = {}, signal?: AbortSignal): Promise<PendingListResponse> {
    return api.list<PendingRow>('v1/pending-quantities', { limit: 100, ...filters }, { signal }) as Promise<PendingListResponse>
  },
}

// ---- packing lists -----------------------------------------------------------------------

export interface PackingListRow {
  document_id: number
  document_uuid: string
  document_no: string | null
  document_date: string
  status: string
  source_app: string
  party_ref: number | null
  party_name: string | null
  from_warehouse_id: number | null
  narration: string | null
  posted_at: string | null
  created_at: string | null
  fy_id: number
  bo_id: number
  consignee_ref: number | null
  packing_status: 'open' | 'locked' | 'consumed' | 'unpacked' | null
  locked_by_document_id: number | null
  locked_by_external_ref: string | null
  locked_at: string | null
  box_marks: unknown
  line_count: number
  total_base_qty: number
  is_locked: boolean
  is_open: boolean
}

export interface PackingFilters extends ListQuery {
  party_ref?: number
  /** csv of open,locked,consumed,unpacked,none */
  status?: string
  doc_status?: string
  warehouse_id?: number
  item_id?: number
  from?: string
  to?: string
  all_fy?: boolean
}

export const packingApi = {
  list(filters: PackingFilters = {}, signal?: AbortSignal): Promise<ListResponse<PackingListRow>> {
    return api.list<PackingListRow>('v1/packing-lists', filters, { signal })
  },
  async get(id: number, signal?: AbortSignal): Promise<InventoryDocument> {
    const res = await api.get<ItemResponse<InventoryDocument>>(`v1/packing-lists/${id}`, { signal })
    return res.data
  },
  async unpack(id: number, reason?: string): Promise<InventoryDocument> {
    const res = await api.post<ItemResponse<InventoryDocument>>(`v1/packing-lists/${id}/unpack`, reason ? { reason } : {}, idempotent())
    return res.data
  },
  async lock(id: number, body: { external_ref?: string; document_id?: number } = {}): Promise<InventoryDocument> {
    const res = await api.post<ItemResponse<InventoryDocument>>(`v1/packing-lists/${id}/lock`, body)
    return res.data
  },
  async unlock(id: number, body: { external_ref?: string; force?: boolean } = {}): Promise<InventoryDocument> {
    const res = await api.post<ItemResponse<InventoryDocument>>(`v1/packing-lists/${id}/unlock`, body)
    return res.data
  },
}

// ---- reservations -------------------------------------------------------------------------

export type ReservationStatus = 'active' | 'partial' | 'fulfilled' | 'released' | 'expired'

export interface Reservation {
  reservation_id: number
  reservation_uuid: string
  cmp_id: number
  fy_id: number
  bo_id: number
  document_id: number | null
  item_id: number
  item_name: string | null
  item_sku: string | null
  unit_symbol: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  batch_id: number | null
  batch_no: string | null
  qty: number
  fulfilled_qty: number
  open_qty: number
  status: ReservationStatus
  source_app: string
  source_document_type: string | null
  source_document_id: number | null
  source_document_uuid: string | null
  expires_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  is_open: boolean
  is_expired: boolean
  balance?: Record<string, number>
}

export interface ReservationFilters extends ListQuery {
  status?: string
  open?: boolean
  item_id?: number
  warehouse_id?: number
  batch_id?: number
  document_id?: number
  source_app?: string
  expired?: boolean
  all_fy?: boolean
}

export interface CreateReservationPayload {
  item_id: number
  /** Base units. */
  qty: number
  warehouse_id?: number | null
  batch_id?: number | null
  document_id?: number | null
  source_document_type?: string | null
  source_document_id?: number | null
  expires_at?: string | null
}

export const reservationsApi = {
  list(filters: ReservationFilters = {}, signal?: AbortSignal): Promise<ListResponse<Reservation>> {
    return api.list<Reservation>('v1/reservations', filters, { signal })
  },
  async create(payload: CreateReservationPayload): Promise<Reservation> {
    const res = await api.post<ItemResponse<Reservation>>('v1/reservations', payload, idempotent())
    return res.data
  },
  async release(id: number, body: { qty?: number | null; reason?: string } = {}): Promise<Reservation> {
    const res = await api.post<ItemResponse<Reservation>>(`v1/reservations/${id}/release`, body, idempotent())
    return res.data
  },
  async fulfil(id: number, body: { qty?: number | null; document_id?: number | null; release_remainder?: boolean; reason?: string } = {}): Promise<Reservation> {
    const res = await api.post<ItemResponse<Reservation>>(`v1/reservations/${id}/fulfil`, body, idempotent())
    return res.data
  },
}
