/**
 * `/v1/inventory-documents` and the document-type / audit reads the document screens use.
 * Mutations that the server treats idempotently send a fresh `Idempotency-Key` per call.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'
import type { CreateDocumentPayload, DocumentListRow, DocumentTypeRow, InventoryDocument, PrintSnapshot } from '../documents/types'

const BASE = 'v1/inventory-documents'

export interface DocumentListFilters extends ListQuery {
  /** Comma-separated codes accepted. */
  document_type?: string
  /** Comma-separated statuses accepted. */
  status?: string
  from?: string
  to?: string
  /** Any line in the warehouse (or header from/to). */
  warehouse_id?: number | string
  from_warehouse_id?: number | string
  item_id?: number | string
  source_app?: string
  party_ref?: number | string
  all_fy?: boolean
}

export interface MutationResponse<T> extends ItemResponse<T> {
  duplicate?: boolean
}

export interface AuditRow {
  audit_id: number
  entity_type: string
  entity_id: number
  action: string
  actor_uuid: string | null
  reason: string | null
  source_app: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  meta: Record<string, unknown> | null
  created_at: string
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function idempotent(): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': newIdempotencyKey() } }
}

export const documentsApi = {
  list(filters: DocumentListFilters = {}, signal?: AbortSignal): Promise<ListResponse<DocumentListRow>> {
    return api.list<DocumentListRow>(BASE, filters, { signal })
  },

  async get(id: number, signal?: AbortSignal): Promise<InventoryDocument> {
    const res = await api.get<ItemResponse<InventoryDocument>>(`${BASE}/${id}`, { signal })
    return res.data
  },

  async create(payload: CreateDocumentPayload): Promise<InventoryDocument> {
    const res = await api.post<MutationResponse<InventoryDocument>>(BASE, payload, idempotent())
    return res.data
  },

  /** Create and post in one call (`/post`). Negative-stock blocks surface as ApiError negative_stock_blocked. */
  async createAndPost(payload: CreateDocumentPayload): Promise<InventoryDocument> {
    const res = await api.post<MutationResponse<InventoryDocument>>(`${BASE}/post`, payload, idempotent())
    return res.data
  },

  async update(id: number, payload: CreateDocumentPayload): Promise<InventoryDocument> {
    const res = await api.put<ItemResponse<InventoryDocument>>(`${BASE}/${id}`, payload)
    return res.data
  },

  submit: (id: number, notes?: string) => lifecycle(id, 'submit', notes),
  approve: (id: number, notes?: string) => lifecycle(id, 'approve', notes),
  reject: (id: number, notes?: string) => lifecycle(id, 'reject', notes),
  cancel: (id: number, reason?: string) => lifecycle(id, 'cancel', reason),

  async post(id: number, options: { negativeOverride?: boolean } = {}): Promise<InventoryDocument> {
    const res = await api.post<MutationResponse<InventoryDocument>>(`${BASE}/${id}/post`, { negative_override: !!options.negativeOverride }, idempotent())
    return { ...res.data, duplicate: res.duplicate ?? res.data.duplicate }
  },

  async reverse(id: number, reason: string): Promise<InventoryDocument> {
    const res = await api.post<MutationResponse<InventoryDocument>>(`${BASE}/${id}/reverse`, { reason }, idempotent())
    return { ...res.data, duplicate: res.duplicate ?? res.data.duplicate }
  },

  async printSnapshot(id: number, signal?: AbortSignal): Promise<PrintSnapshot> {
    const res = await api.get<ItemResponse<PrintSnapshot>>(`${BASE}/${id}/print-snapshot`, { signal })
    return res.data
  },

  async documentTypes(signal?: AbortSignal): Promise<DocumentTypeRow[]> {
    const res = await api.get<ItemResponse<DocumentTypeRow[]>>('v1/document-types', { signal })
    return res.data
  },

  /** Audit trail for one document, oldest first. Needs audit.read — callers tolerate 403. */
  auditTrail(id: number, signal?: AbortSignal): Promise<ListResponse<AuditRow>> {
    return api.list<AuditRow>(`v1/audit-log/entity/document/${id}`, { limit: 200, sort: 'created_at', order: 'asc' }, { signal })
  },
}

async function lifecycle(id: number, action: 'submit' | 'approve' | 'reject' | 'cancel', notes?: string): Promise<InventoryDocument> {
  const body = notes && notes.trim() ? { notes: notes.trim(), reason: notes.trim() } : {}
  const res = await api.post<ItemResponse<InventoryDocument>>(`${BASE}/${id}/${action}`, body)
  return res.data
}
