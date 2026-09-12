/**
 * `/v1/valuation/*` — closing valuation snapshot, unit costs under a chosen
 * method, FIFO/LIFO cost layers, backdated recalculation jobs and the COGS
 * revisions they publish to Books.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

export type ReportMethod = 'AS_PER_MASTER' | 'FIFO' | 'LIFO' | 'WAC'
export const REPORT_METHODS: ReportMethod[] = ['AS_PER_MASTER', 'FIFO', 'LIFO', 'WAC']
export const METHOD_LABELS: Record<ReportMethod, string> = {
  AS_PER_MASTER: 'As per item master',
  FIFO: 'FIFO',
  LIFO: 'LIFO',
  WAC: 'Weighted average',
}

// ---- snapshot ---------------------------------------------------------------------------------

export interface ValuationSnapshotRow {
  item_id: number
  item_name: string | null
  item_alias: string | null
  item_sku?: string | null
  unit_id?: number | null
  unit_symbol?: string | null
  valuation_method?: string | null
  closing_qty: number
  unit_cost: number
  stock_value: number
  valuation_method_applied: string | null
}

export interface ValuationSnapshotSummary {
  as_of: string
  method: string
  total_qty: number
  total_value: number
  item_count: number
}

export interface ValuationSnapshotResponse extends ListResponse<ValuationSnapshotRow> {
  summary: ValuationSnapshotSummary
}

export interface SnapshotQuery extends ListQuery {
  as_of?: string
  method?: ReportMethod | string
  item_id?: number | string
  warehouse_id?: number | string
}

// ---- unit costs --------------------------------------------------------------------------------

export interface UnitCostRow {
  item_id: number
  unit_cost: number
  valuation_method_applied: string | null
}

// ---- cost layers --------------------------------------------------------------------------------

export interface CostLayerConsumption {
  consumption_id: number
  layer_id: number
  document_id: number | null
  line_id: number | null
  movement_id: number | null
  qty: number
  unit_cost: number
  amount: number
  created_at: string | null
  document_no: string | null
  document_type: string | null
  document_date: string | null
  document_status: string | null
}

export interface CostLayerRow {
  layer_id: number
  fy_id: number | null
  item_id: number
  warehouse_id: number | null
  batch_id: number | null
  layer_kind: 'opening' | 'receipt' | 'backorder' | 'revaluation' | string
  qty_received: number | null
  qty_remaining: number
  unit_cost: number
  received_at: string | null
  source_document_id: number | null
  source_line_id: number | null
  created_at: string | null
  warehouse_name: string | null
  source_document_no: string | null
  source_document_type: string | null
  source_document_date: string | null
  qty_consumed: number | null
  remaining_value: number
  consumptions: CostLayerConsumption[]
}

export interface CostLayersResponse extends ListResponse<CostLayerRow> {
  item: { item_id: number; item_name: string; item_alias: string | null; item_sku: string | null; unit_id: number | null; valuation_method: string | null }
  summary: { open_qty: number; open_value: number; backorder_qty: number }
}

export interface CostLayersQuery extends ListQuery {
  item_id: number | string
  warehouse_id?: number | string
  open_only?: boolean | number | string
  layer_kind?: string
  all_fy?: boolean | number | string
}

// ---- recalculation jobs --------------------------------------------------------------------------

export type RecalcStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export const RECALC_STATUSES: RecalcStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']

export interface RecalcJob {
  job_id: number
  job_uuid: string
  cmp_id: number
  fy_id: number | null
  item_id: number | null
  warehouse_id: number | null
  from_date: string
  to_date: string | null
  trigger_kind: string
  trigger_document_id: number | null
  status: RecalcStatus | string
  dry_run: boolean
  affected_line_count: number | null
  revised_line_count: number | null
  cogs_delta: number
  failure_reason: string | null
  requested_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  item_name: string | null
  item_sku: string | null
  trigger_document_no: string | null
  trigger_document_type: string | null
  affected_document_ids: number[]
  /** Detail resource only. */
  revision_summary?: { revisions: number; delta_total: number; unacknowledged: number; published: number }
}

export interface RecalcFilters extends ListQuery {
  status?: string
  item_id?: number | string
  trigger_kind?: string
  trigger_document_id?: number | string
  from?: string
  to?: string
  all_fy?: boolean | number | string
}

export interface EnqueueRecalcPayload {
  from_date: string
  item_id?: number | null
  dry_run?: boolean
  run_now?: boolean
  trigger_document_id?: number | null
}

// ---- revisions -----------------------------------------------------------------------------------

export interface ValuationRevision {
  revision_id: number
  revision_uuid: string
  job_id: number | null
  document_id: number | null
  line_id: number | null
  source_app: string | null
  source_document_type: string | null
  source_document_id: number | null
  source_document_uuid: string | null
  old_valuation_rate: number | null
  new_valuation_rate: number | null
  old_valuation_amount: number | null
  new_valuation_amount: number | null
  delta_amount: number | null
  published_at: string | null
  acknowledged_at: string | null
  acknowledged_by_app: string | null
  created_at: string
  document_no: string | null
  document_type: string | null
  document_date: string | null
  document_status: string | null
  source_document_no: string | null
  item_id: number | null
  direction: string | null
  base_qty: number | null
  item_name: string | null
  item_sku: string | null
  acknowledged: boolean
}

export interface RevisionFilters extends ListQuery {
  acknowledged?: 0 | 1 | '' | string
  job_id?: number | string
  document_id?: number | string
  item_id?: number | string
  source_app?: string
  from?: string
  to?: string
}

export interface AckResult {
  acknowledged: number
  already_acknowledged: number
  unknown_revision_ids: number[]
  acknowledged_by_app: string
  acknowledged_at: string
}

export const valuationApi = {
  snapshot(query: SnapshotQuery = {}, signal?: AbortSignal): Promise<ValuationSnapshotResponse> {
    return api.list<ValuationSnapshotRow>('v1/valuation', query, { signal }) as Promise<ValuationSnapshotResponse>
  },

  async unitCosts(itemIds: number[], options: { asOf?: string; method?: ReportMethod | string; warehouseId?: number | null } = {}, signal?: AbortSignal): Promise<UnitCostRow[]> {
    if (itemIds.length === 0) return []
    const res = await api.get<{ data: UnitCostRow[] }>('v1/valuation/unit-costs', {
      query: { item_ids: itemIds.join(','), as_of: options.asOf, method: options.method, warehouse_id: options.warehouseId ?? undefined },
      signal,
    })
    return res.data
  },

  costLayers(query: CostLayersQuery, signal?: AbortSignal): Promise<CostLayersResponse> {
    return api.list<CostLayerRow>('v1/valuation/cost-layers', query, { signal }) as Promise<CostLayersResponse>
  },

  recalcJobs(filters: RecalcFilters = {}, signal?: AbortSignal): Promise<ListResponse<RecalcJob>> {
    return api.list<RecalcJob>('v1/valuation/recalculations', filters, { signal })
  },

  async recalcJob(id: number, signal?: AbortSignal): Promise<RecalcJob> {
    const res = await api.get<ItemResponse<RecalcJob>>(`v1/valuation/recalculations/${id}`, { signal })
    return res.data
  },

  async enqueueRecalc(payload: EnqueueRecalcPayload): Promise<RecalcJob> {
    const res = await api.post<ItemResponse<RecalcJob>>('v1/valuation/recalculations', payload)
    return res.data
  },

  async runRecalc(id: number): Promise<RecalcJob> {
    const res = await api.post<ItemResponse<RecalcJob>>(`v1/valuation/recalculations/${id}/run`, {})
    return res.data
  },

  revisions(filters: RevisionFilters = {}, signal?: AbortSignal): Promise<ListResponse<ValuationRevision>> {
    return api.list<ValuationRevision>('v1/valuation/revisions', filters, { signal })
  },

  async ackRevisions(revisionIds: number[]): Promise<AckResult> {
    const res = await api.post<ItemResponse<AckResult>>('v1/valuation/revisions/ack', { revision_ids: revisionIds })
    return res.data
  },
}
