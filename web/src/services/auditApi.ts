/** `/v1/audit-log` — append-only audit trail, read-only. */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

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
  /** Exact match; a comma-separated list is an IN. */
  action?: string
  action_prefix?: string
  actor_uuid?: string
  source_app?: string
  source_document_type?: string
  source_document_id?: number | string
  request_id?: string
  ip_address?: string
  /** `'1'` only entries carrying a reason, `'0'` only those without. */
  has_reason?: string
  from?: string
  to?: string
}

/** One distinct value of a filterable column, with how often it occurs. */
export interface AuditFacet {
  value: string
  count: number
}

export interface AuditFacets {
  actions: AuditFacet[]
  actors: AuditFacet[]
  source_apps: AuditFacet[]
  entity_types: AuditFacet[]
}

/**
 * `GET /v1/audit-log/summary` — the figures above the table.
 *
 * Counted over the whole filtered set by the server, never derived in the
 * browser from the page on screen. `previous_total` is null unless the caller
 * bounded the period at both ends: with no previous window there is no honest
 * delta, and the cards render none rather than invent one.
 */
export interface AuditSummary {
  total: number
  previous_total: number | null
  actors: number
  source_apps: number
  event_types: number
  entity_types: number
  first_at: string | null
  last_at: string | null
  retention_years: number
  may_purge: boolean
  facets: AuditFacets
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

  /**
   * The summary for the current filters.
   *
   * Paging parameters are stripped deliberately — the figures speak for the
   * whole filtered set, so sending `page` would imply the server should narrow
   * them to one page, and a reader who turns to page 4 must not watch the
   * totals above the table change.
   */
  summary(filters: AuditFilters = {}, signal?: AbortSignal): Promise<AuditSummary> {
    const { page: _page, limit: _limit, offset: _offset, sort: _sort, order: _order, ...rest } = filters
    return api
      .get<ItemResponse<AuditSummary>>('v1/audit-log/summary', { query: rest, signal })
      .then((r) => r.data)
  },
}
