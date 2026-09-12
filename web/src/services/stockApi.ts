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
  unit_id: number | null
  unit_symbol: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  party_ref: number | null
  qty_original: number
  qty_settled: number
  qty_open: number
  status: 'open' | 'partial'
  document_no: string | null
  document_date: string | null
  document_type: string
  document_type_label?: string
}

export interface PendingListResponse extends ListResponse<PendingRow> {
  summary?: { qty_open: number; rows: number }
}

export interface PendingFilters extends ListQuery {
  kind?: PendingKind
  direction?: 'in' | 'out'
  party_ref?: number
  item_id?: number
  warehouse_id?: number
  document_id?: number
}

export const pendingApi = {
  list(filters: PendingFilters = {}, signal?: AbortSignal): Promise<PendingListResponse> {
    return api.list<PendingRow>('v1/pending-quantities', { limit: 500, ...filters }, { signal }) as Promise<PendingListResponse>
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
