/**
 * The four `/v1/dashboard/*` aggregates behind Operations, Replenishment,
 * Valuation and Controls.
 *
 * Same contract as dashboardApi.ts: the server computes every figure over the
 * whole scoped set and the browser adds nothing up. What is new here is the
 * envelope — each response carries the scope it was computed for and when it
 * was generated, so a screen can prove the numbers it is about to draw answer
 * the filters currently on it. `assertScope` below is what turns that from a
 * comment into a guarantee.
 */

import { api } from '../services/api'
import type { ItemResponse } from '../services/api'

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type MetricState = 'ready' | 'empty' | 'not_configured' | 'unavailable'

/**
 * One figure plus everything needed to render it honestly.
 *
 * `value: null` is never "zero we could not fetch" — `state` always says which
 * of the four situations it is, and the card renders a different thing for
 * each. `definition` is shown to the user, not kept for developers.
 */
export interface Metric {
  value: number | string | null
  state: MetricState
  definition: string
  /** Present on `not_configured`: what the product does not model, and why. */
  reason?: string
  /** Present on `not_configured`: the screen that answers the nearest real question. */
  instead?: string | null
  /** Set by metrics that carry a second figure — an overdue subset, say. */
  overdue?: number
  documents?: number
}

export interface DashboardScope {
  cmp_id: number
  fy_id: number
  bo_id: number
  timezone: string
  as_of?: string
  period_start?: string
  period_end?: string
}

export interface DashboardMeta {
  generated_at: string
  status: 'ready' | 'partial' | 'stale'
}

export interface DashboardEnvelope<T> {
  scope: DashboardScope
  meta: DashboardMeta
  data: T
}

/**
 * Reject a response computed for a different company, year or branch.
 *
 * The abort in `useQuery` already cancels the previous request when the scope
 * changes, but an abort is a request to stop, not a promise that nothing is
 * already in flight and about to resolve. This is the belt to that braces:
 * even if a response from the old scope lands, it is thrown away rather than
 * rendered under the new scope's heading.
 */
export function assertScope<T>(envelope: DashboardEnvelope<T>, expected: { cmp_id: number; fy_id: number; bo_id: number }): DashboardEnvelope<T> {
  const s = envelope.scope
  if (s.cmp_id !== expected.cmp_id || s.fy_id !== expected.fy_id || s.bo_id !== expected.bo_id) {
    throw new Error('This answer was computed for a different company, year or branch. Refresh to reload it.')
  }
  return envelope
}

async function getEnvelope<T>(path: string, query: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<DashboardEnvelope<T>> {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue
    search.set(k, String(v))
  }
  const qs = search.toString()
  const res = await api.get<ItemResponse<DashboardEnvelope<T>>>(`${path}${qs ? `?${qs}` : ''}`, { signal })
  return res.data
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type FlowClass = 'receipt' | 'issue' | 'transfer' | 'adjustment'

export interface HourlyBucket {
  hour: number
  receipt: number
  issue: number
  transfer: number
  adjustment: number
}

export interface InFlightRow {
  document_id: number
  document_no: string | null
  document_type: string
  document_type_label: string
  document_date: string
  posted_at: string | null
  status: string
  party_name: string | null
  pending_kind: string
  direction: string
  from_warehouse_id: number | null
  from_warehouse_name: string | null
  to_warehouse_id: number | null
  to_warehouse_name: string | null
  expected_return_date: string | null
  lines: number
  outstanding_qty: number
  /** Three states, kept apart: nothing is "late" without an agreed date. */
  timeliness: 'overdue' | 'on_time' | 'undated'
}

export interface CountProgressRow {
  warehouse_id: number | null
  warehouse_name: string | null
  counted_lines: number
  total_lines: number
  documents: number
}

export interface CountDocumentRow {
  document_id: number
  document_no: string | null
  document_date: string
  status: string
  warehouse_id: number | null
  warehouse_name: string | null
  total_lines: number
  counted_lines: number
  variance_lines: number
}

export interface OperationsData {
  date: string
  timezone: string
  metrics: Record<string, Metric>
  hourly: { buckets: HourlyBucket[]; truncated_at_hour: number | null }
  in_flight: {
    open_documents: number
    overdue_documents: number
    by_kind: { kind: string; direction: string; documents: number; lines: number; outstanding_qty: number; overdue: number; undated: number }[]
    rows: InFlightRow[]
  }
  count_progress: CountProgressRow[]
  count_documents: CountDocumentRow[]
}

export function fetchOperations(date: string, signal?: AbortSignal): Promise<DashboardEnvelope<OperationsData>> {
  return getEnvelope<OperationsData>('v1/dashboard/operations', { date }, signal)
}

// ---------------------------------------------------------------------------
// Valuation bridge
// ---------------------------------------------------------------------------

export interface BridgeComponent {
  net: number
  gross_in: number
  gross_out: number
  movements: number
}

export interface ValuationBridgeData {
  from: string
  to: string
  warehouse_id: number | null
  opening: Metric
  closing: Metric
  components: {
    inward: BridgeComponent
    outward: BridgeComponent
    transfer: BridgeComponent
    adjustment: BridgeComponent
    other: BridgeComponent
  }
  reversals: { net: number; movements: number }
  revaluations: { net: number; movements: number }
  unvalued_movements: number
  definition: string
}

export function fetchValuationBridge(
  from: string,
  to: string,
  warehouseId: number | null,
  signal?: AbortSignal,
): Promise<DashboardEnvelope<ValuationBridgeData>> {
  return getEnvelope<ValuationBridgeData>('v1/dashboard/valuation-bridge', { from, to, warehouse_id: warehouseId ?? undefined }, signal)
}

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

export interface DemandPoint {
  date: string
  qty: number
}

export interface DemandData {
  item_id: number
  warehouse_id: number | null
  as_of: string
  history_days: number
  horizon_days: number
  series: DemandPoint[]
  total_qty: number
  days_with_demand: number
  movements: number
  daily_mean: number
  /** Always `trailing_mean` today. Named so a screen never implies more. */
  method: string
  first_demand_date: string | null
  covered_days: number
  sufficient_history: boolean
  sufficiency_rule: string
  demand_basis: string
}

export function fetchDemand(
  itemId: number,
  warehouseId: number | null,
  asOf: string,
  historyDays: number,
  horizonDays: number,
  signal?: AbortSignal,
): Promise<DashboardEnvelope<DemandData>> {
  return getEnvelope<DemandData>(
    'v1/dashboard/demand',
    { item_id: itemId, warehouse_id: warehouseId ?? undefined, as_of: asOf, history_days: historyDays, horizon_days: horizonDays },
    signal,
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export interface ExceptionRow {
  key: string
  label: string
  severity: 'high' | 'medium' | 'low'
  /** Counted in the unit named by `scope` — never summed across rows. */
  issues: number
  scope: string
  detail: string
  path: string
}

export interface ControlsData {
  exceptions: ExceptionRow[]
  open_exception_kinds: number
  open_exception_issues: number
  exception_counting_rule: string
  delivery: {
    by_status: Record<string, number>
    pending: number
    failed: number
    delivered: number
    last_delivered_at: string | null
    unacknowledged_revisions: number
  }
  approvals: {
    pending: number
    approved_not_posted: number
  }
}

export function fetchControls(signal?: AbortSignal): Promise<DashboardEnvelope<ControlsData>> {
  return getEnvelope<ControlsData>('v1/dashboard/controls', {}, signal)
}
