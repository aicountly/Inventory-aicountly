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

/**
 * The four states a layer can be in. The server derives it (ValuationController
 * ::layerStatus) so the screen, the SQL filter and the distribution all agree
 * on what "partially consumed" means; `layerStatusOf` below is the fallback for
 * a response that predates it.
 */
export type CostLayerStatus = 'open' | 'partial' | 'closed' | 'negative'
export const COST_LAYER_STATUSES: CostLayerStatus[] = ['open', 'partial', 'closed', 'negative']

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
  /* Added with the cost-layers screen; optional so a client deployed ahead of
     the API renders a dash rather than `undefined`. */
  batch_no?: string | null
  lot_no?: string | null
  expiry_date?: string | null
  batch_status?: string | null
  /** What the layer was worth when it opened — qty received x unit cost. */
  layer_value?: number
  layer_status?: CostLayerStatus | string
}

export interface CostLayersSummary {
  open_qty: number
  open_value: number
  backorder_qty: number
  /** Layers matching the filters — including the ones a state filter removed. */
  layer_count?: number
  received_qty?: number
  received_value?: number
  unit_cost_min?: number | null
  unit_cost_max?: number | null
  /** Weighted by received quantity, not the mean of the rates. */
  unit_cost_avg?: number | null
  first_received_at?: string | null
  last_received_at?: string | null
}

export interface CostLayerDistributionBucket {
  status: CostLayerStatus
  layer_count: number
  qty: number
  value: number
}

/**
 * The item's layers split BY state, at opening value.
 *
 * Deliberately blind to `open_only` and `status`: a split computed over a set
 * already narrowed to one state would report that state as the whole item.
 */
export interface CostLayerDistribution {
  layer_count: number
  total_qty: number
  total_value: number
  buckets: CostLayerDistributionBucket[]
}

export interface CostLayerItem {
  item_id: number
  item_name: string
  item_alias: string | null
  item_sku: string | null
  unit_id: number | null
  valuation_method: string | null
}

export interface CostLayersResponse extends ListResponse<CostLayerRow> {
  item: CostLayerItem
  summary: CostLayersSummary
  distribution?: CostLayerDistribution
}

export interface CostLayersQuery extends ListQuery {
  item_id: number | string
  warehouse_id?: number | string
  batch_id?: number | string
  open_only?: boolean | number | string
  layer_kind?: string
  status?: CostLayerStatus | string
  /** `received_at` window — the period the screen's period picker writes. */
  from?: string
  to?: string
  all_fy?: boolean | number | string
}

/**
 * The state of one layer, for a response that did not carry `layer_status`.
 *
 * `qty_received === null` is a layer migrated from Books, which recorded no
 * opening quantity: untouched stock, not an exhausted layer.
 */
export function layerStatusOf(row: Pick<CostLayerRow, 'qty_received' | 'qty_remaining' | 'layer_status'>): CostLayerStatus {
  const declared = row.layer_status
  if (declared === 'open' || declared === 'partial' || declared === 'closed' || declared === 'negative') return declared
  if (row.qty_remaining < 0) return 'negative'
  if (row.qty_remaining === 0) return 'closed'
  return row.qty_received === null || row.qty_remaining >= row.qty_received ? 'open' : 'partial'
}

// ---- recalculation jobs --------------------------------------------------------------------------

export type RecalcStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export const RECALC_STATUSES: RecalcStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']

/**
 * The two statuses a job is "in progress" in — what the dashboard counts as
 * `recalculations_in_progress`. `status` is split on commas server-side
 * (ValuationController::recalcJobs), so this is one filter value, not two.
 */
export const RECALC_IN_PROGRESS = 'QUEUED,RUNNING'

/**
 * The status filter the recalculations register offers.
 *
 * It exists so the dashboard cannot link to a filter value the landing page has
 * no option for: a `<select>` handed a value it does not list renders blank
 * while the filter is silently active, which reads as a broken page.
 */
export const RECALC_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: RECALC_IN_PROGRESS, label: 'In progress (queued + running)' },
  // Sentence case, not the raw token: the register's own chips read "Completed",
  // and a filter offering "COMPLETED" for the same rows is two vocabularies for
  // one thing. The VALUES are untouched — the dashboard links by value.
  ...RECALC_STATUSES.map((status) => ({ value: status, label: status.charAt(0) + status.slice(1).toLowerCase() })),
]

/**
 * The trigger vocabulary of `inv_valuation_recalc_jobs.trigger_kind` (migration
 * 003). A closed set written down once, so the filter cannot offer a value the
 * column never holds and the register cannot label one it does.
 */
export const RECALC_TRIGGER_KINDS = [
  'manual',
  'backdated_document',
  'reversal',
  'revaluation',
  'method_change',
  'migration_rebuild',
] as const

export type RecalcTriggerKind = (typeof RECALC_TRIGGER_KINDS)[number]

/** Which job timestamp a date range narrows. Mirrors the controller's `date_field`. */
export const RECALC_DATE_FIELDS = [
  { value: 'queued', label: 'Queued' },
  { value: 'finished', label: 'Finished' },
  { value: 'effective', label: 'Effective from' },
] as const

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
  /** The reason a person typed when they queued it (migration 010). */
  remarks: string | null
  requested_by: string | null
  cancelled_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  item_name: string | null
  item_sku: string | null
  warehouse_name: string | null
  trigger_document_no: string | null
  trigger_document_type: string | null
  affected_document_ids: number[]
  /** Detail resource only. */
  revision_summary?: { revisions: number; delta_total: number; unacknowledged: number; published: number }
}

/**
 * The server's figures for the register's KPI cards.
 *
 * Counted over the whole filtered set with the STATUS filter deliberately left
 * out, because the cards are the status breakdown — see
 * ValuationController::recalcSummary. `ignores_status_filter` is the server
 * saying so, so the screen can print it rather than assume it.
 */
export interface RecalcSummary {
  total: number
  by_status: Partial<Record<RecalcStatus, number>> & Record<string, number>
  in_progress: number
  cogs_delta: number
  queued_this_month: number
  queued_prev_month: number
  cogs_delta_this_month: number
  cogs_delta_prev_month: number
  month_start: string
  ignores_status_filter: boolean
}

export interface RecalcFilters extends ListQuery {
  status?: string
  item_id?: number | string
  warehouse_id?: number | string
  trigger_kind?: string
  trigger_document_id?: number | string
  /** '1' = dry runs only, '0' = live runs only, absent = both. */
  dry_run?: number | string
  has_cogs_impact?: number | string
  /** `queued` (default) | `finished` | `effective`. */
  date_field?: string
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
  /** Why this restatement was asked for. Stored on the job for the audit trail. */
  remarks?: string | null
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
  /* --- the line's own context and the job that revalued it. Optional: an API older
     than the revisions screen's rebuild does not send them, and the detail panel
     leaves the field out rather than inventing one. --- */
  warehouse_id?: number | null
  warehouse_name?: string | null
  unit_symbol?: string | null
  valuation_method_applied?: string | null
  trigger_kind?: string | null
  trigger_document_id?: number | null
  dry_run?: boolean | null
  job_status?: string | null
  job_requested_by?: string | null
}

/**
 * Where a revision has got to between the two products.
 *
 * Inventory generates it (`awaiting`), publishes it to Books (`published`), and marks it
 * `acknowledged` once Books confirms the COGS was re-posted. The three are kept apart
 * because only the middle one means "Books has it and has not answered" — collapsing them
 * would hide a revision that never left Inventory at all.
 */
export type RevisionBooksState = 'awaiting' | 'published' | 'acknowledged'

export type RevisionBooksFilter = '' | RevisionBooksState | 'unacknowledged'
export type RevisionDeltaFilter = '' | 'increase' | 'decrease' | 'none'

export interface RevisionFilters extends ListQuery {
  acknowledged?: 0 | 1 | '' | string
  books?: RevisionBooksFilter | string
  job_id?: number | string
  document_id?: number | string
  item_id?: number | string
  warehouse_id?: number | string
  source_app?: string
  delta?: RevisionDeltaFilter | string
  /** Minimum absolute valuation delta, in company base currency. */
  min_abs_delta?: number | string
  from?: string
  to?: string
}

// ---- revision summary (KPIs, charts, insights) ---------------------------------------------------

/** Totals over one set of revisions. Every field is a server aggregate, never a page sum. */
export interface RevisionTotals {
  revisions: number
  net_delta: number
  abs_delta: number
  increased: number
  decreased: number
  unchanged: number
  items_affected: number
  items_increased: number
  items_decreased: number
  jobs: number
  acknowledged: number
  published_unacknowledged: number
  awaiting_publish: number
}

export interface RevisionTimelinePoint {
  day: string
  revisions: number
  increased: number
  decreased: number
  net_delta: number
}

/** Movement grouped by the KIND of document that caused it — a purchase, a stock journal. */
export interface RevisionSourceSplit {
  document_type: string | null
  revisions: number
  net_delta: number
  abs_delta: number
}

export interface RevisionItemSplit {
  item_id: number
  item_name: string | null
  item_sku: string | null
  revisions: number
  net_delta: number
  abs_delta: number
  /** Largest rate change on the item, as a percentage of the old valuation rate. */
  peak_change_pct: number | null
  /** The same measure averaged over the trailing baseline window. */
  baseline_pct: number | null
  baseline_samples: number
}

export interface RevisionTriggerSplit {
  trigger_kind: string | null
  jobs: number
  revisions: number
  net_delta: number
  abs_delta: number
}

export interface RevisionSummary {
  window: { from: string; to: string; days: number; explicit_range: boolean; previous_from: string; previous_to: string }
  /** The filtered set — the rows the table is showing. */
  filtered: RevisionTotals
  /** The same filters over the window immediately before this one. */
  previous: RevisionTotals
  /** Company / branch state, with no screen filter applied. */
  company: {
    revisions: number
    acknowledged: number
    pending: number
    pending_delta: number
    awaiting_publish: number
    published_unacknowledged: number
    created_last_7d: number
    created_prev_7d: number
    acknowledged_today: number
    acknowledged_yesterday: number
  }
  jobs: { queued: number; running: number; failed: number }
  timeline: RevisionTimelinePoint[]
  by_source: RevisionSourceSplit[]
  top_items: RevisionItemSplit[]
  baseline_days: number
  triggers: RevisionTriggerSplit[]
}

export interface RevisionSummaryQuery extends RevisionFilters {
  /** Length of the timeline window when the filters carry no explicit date range. */
  days?: number
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

  /** KPI figures for the same filters the list is showing. */
  async recalcSummary(filters: RecalcFilters = {}, signal?: AbortSignal): Promise<RecalcSummary> {
    const res = await api.get<ItemResponse<RecalcSummary>>('v1/valuation/recalculations/summary', { query: filters, signal })
    return res.data
  },

  async recalcJob(id: number, signal?: AbortSignal): Promise<RecalcJob> {
    const res = await api.get<ItemResponse<RecalcJob>>(`v1/valuation/recalculations/${id}`, { signal })
    return res.data
  },

  /**
   * `idempotencyKey` is not optional in spirit: this call restates historical
   * valuation and publishes COGS revisions to Books, so a retried or
   * double-submitted request must come back with the FIRST job rather than
   * queue a second one. The screen mints one key per form submission.
   */
  async enqueueRecalc(payload: EnqueueRecalcPayload, idempotencyKey?: string): Promise<RecalcJob> {
    const res = await api.post<ItemResponse<RecalcJob>>('v1/valuation/recalculations', payload, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined)
    return res.data
  },

  async runRecalc(id: number): Promise<RecalcJob> {
    const res = await api.post<ItemResponse<RecalcJob>>(`v1/valuation/recalculations/${id}/run`, {})
    return res.data
  },

  /** Queued jobs only — the server refuses anything that has already started. */
  async cancelRecalc(id: number): Promise<RecalcJob> {
    const res = await api.post<ItemResponse<RecalcJob>>(`v1/valuation/recalculations/${id}/cancel`, {})
    return res.data
  },

  revisions(filters: RevisionFilters = {}, signal?: AbortSignal): Promise<ListResponse<ValuationRevision>> {
    return api.list<ValuationRevision>('v1/valuation/revisions', filters, { signal })
  },

  /**
   * The screen's cards, charts and insights, as server aggregates over the same filters.
   *
   * Paging parameters are dropped deliberately: a summary of "page 2" is not a summary.
   */
  async revisionsSummary(query: RevisionSummaryQuery = {}, signal?: AbortSignal): Promise<RevisionSummary> {
    const { page, limit, offset, sort, order, ...filters } = query
    void page
    void limit
    void offset
    void sort
    void order
    const res = await api.get<ItemResponse<RevisionSummary>>('v1/valuation/revisions/summary', { query: filters, signal })
    return res.data
  },

  async ackRevisions(revisionIds: number[]): Promise<AckResult> {
    const res = await api.post<ItemResponse<AckResult>>('v1/valuation/revisions/ack', { revision_ids: revisionIds })
    return res.data
  },
}
