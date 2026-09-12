/** `/v1/audit-log` — append-only audit trail, read-only. */

import { api } from './api'
import type { ListQuery, ListResponse } from './api'

export interface AuditLogRow {
  audit_id: number
  cmp_id: number
  entity_type: string
  entity_id: number
  entity_uuid: string | null
  action: string
  actor_uuid: string | null
  source_app: string | null
  source_document_type: string | null
  source_document_id: number | null
  source_document_uuid: string | null
  reason: string | null
  approval_ref: string | null
  reversal_ref: number | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  meta: Record<string, unknown> | null
  request_id: string | null
  ip_address: string | null
  created_at: string
}

export interface AuditFilters extends ListQuery {
  entity_type?: string
  entity_id?: number | string
  action?: string
  action_prefix?: string
  actor_uuid?: string
  source_app?: string
  source_document_type?: string
  source_document_id?: number | string
  request_id?: string
  from?: string
  to?: string
}

/** Entity types the audit trail records today (free text on the server; this only seeds the filter). */
export const AUDIT_ENTITY_TYPES = ['document', 'item', 'item_group', 'stock_category', 'brand', 'uom', 'warehouse', 'warehouse_group', 'location', 'bom', 'batch', 'serial', 'reservation', 'settings', 'period_lock', 'access_profile', 'member', 'access', 'reconciliation_run', 'integration_event', 'inbound_event', 'valuation_revision', 'recalc_job'] as const

export const auditApi = {
  list(filters: AuditFilters = {}, signal?: AbortSignal): Promise<ListResponse<AuditLogRow>> {
    return api.list<AuditLogRow>('v1/audit-log', filters, { signal })
  },

  entity(type: string, id: number, query: ListQuery = {}, signal?: AbortSignal): Promise<ListResponse<AuditLogRow>> {
    return api.list<AuditLogRow>(`v1/audit-log/entity/${encodeURIComponent(type)}/${id}`, query, { signal })
  },
}
