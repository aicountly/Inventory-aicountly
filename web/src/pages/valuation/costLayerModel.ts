/**
 * Everything the cost-layer workspace derives from what the API already sent.
 *
 * Pure on purpose. `GET /v1/valuation/cost-layers` returns the layers, their
 * consumptions and a three-figure summary; it does not return a status, a
 * distribution, a variance or an insight. Those are readings of the same rows,
 * and a reading that lives in a component cannot be unit-tested, cannot be
 * reused by the export and drifts from the badge the moment either changes.
 *
 * Nothing in this file invents a figure. Every number it returns is computed
 * from a field the server sent; where a question cannot be answered from those
 * fields (a previous-period variance, a scheduled next recalculation) the
 * answer is `null` and the screen says so rather than showing a plausible
 * number nobody computed.
 */

import type { CostLayerRow, RecalcJob, ValuationRevision } from '../../services/valuationApi'

// ---------------------------------------------------------------------------
// Layer status
// ---------------------------------------------------------------------------

/**
 * What a layer is, as a reader of the register would name it.
 *
 * Derived rather than stored: `inv_cost_layers` keeps quantities and a kind,
 * and "open / partially consumed / closed" is arithmetic over the quantities.
 * `negative` and `revised` come from the kind because they are not quantity
 * states — a backorder layer is a costing placeholder for stock issued below
 * zero, and a revaluation layer is the audit trail of a re-costing.
 */
export type LayerStatus = 'open' | 'partial' | 'closed' | 'negative' | 'revised'

export const LAYER_STATUS_LABEL: Record<LayerStatus, string> = {
  open: 'Open',
  partial: 'Partially consumed',
  closed: 'Closed',
  negative: 'Negative',
  revised: 'Revised',
}

/**
 * The same states, for a column a reader scans rather than reads.
 *
 * Only `partial` actually shortens, and it is the one that matters: "Partially
 * consumed" is 150px of a grid that has twelve columns to fit, and it was
 * pushing the status of every row off the edge. The full phrase stays on the
 * chip's tooltip, in the layer panel and in the distribution legend, so the
 * word is never the only place the state is spelled out.
 */
export const LAYER_STATUS_SHORT: Record<LayerStatus, string> = {
  open: 'Open',
  partial: 'Partial',
  closed: 'Closed',
  negative: 'Negative',
  revised: 'Revised',
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Quantity actually taken out of the layer, whatever the server chose to send. */
export function consumedQty(row: CostLayerRow): number {
  if (typeof row.qty_consumed === 'number' && Number.isFinite(row.qty_consumed)) return row.qty_consumed
  if (typeof row.qty_received === 'number') return row.qty_received - num(row.qty_remaining)
  return row.consumptions?.reduce((sum, c) => sum + num(c.qty), 0) ?? 0
}

export function layerStatus(row: CostLayerRow): LayerStatus {
  // A layer issued below zero is negative whatever else is true of it: that is
  // the state an inventory controller has to act on, and burying it under
  // "open" because some of it was consumed would hide the only row that matters.
  if (num(row.qty_remaining) < 0 || row.layer_kind === 'backorder') return 'negative'
  if (row.layer_kind === 'revaluation') return 'revised'
  const consumed = consumedQty(row)
  if (num(row.qty_remaining) === 0) return 'closed'
  return consumed > 0 ? 'partial' : 'open'
}

/**
 * What the layer was worth when it opened — quantity received at its own cost.
 *
 * Distinct from `remaining_value`, which the server sends and which is what is
 * LEFT. Both are real; they answer different questions, and the distribution
 * band needs this one or every closed layer contributes nothing and the band
 * silently stops being a distribution.
 */
export function layerReceiptValue(row: CostLayerRow): number {
  const qty = typeof row.qty_received === 'number' ? row.qty_received : num(row.qty_remaining)
  return qty * num(row.unit_cost)
}

export function layerReceiptQty(row: CostLayerRow): number {
  return typeof row.qty_received === 'number' ? row.qty_received : num(row.qty_remaining)
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export type DistributionMeasure = 'value' | 'qty'

export interface DistributionSegment {
  status: LayerStatus
  label: string
  layers: number
  amount: number
  /** 0–100, of the measured total. */
  share: number
}

/** The order the band is drawn in — life cycle, left to right. */
const DISTRIBUTION_ORDER: LayerStatus[] = ['open', 'partial', 'closed', 'negative', 'revised']

/**
 * Share of the item's RECEIPT value (or quantity) by layer status.
 *
 * Measured at receipt, not at what remains, for the reason above: a band drawn
 * on remaining value can only ever show open and partly-consumed layers, so
 * "22% closed" — the figure that tells a controller how much of this item's
 * cost has already reached COGS — would be undrawable.
 */
export function layerDistribution(
  rows: readonly CostLayerRow[],
  measure: DistributionMeasure,
): { segments: DistributionSegment[]; total: number } {
  const buckets = new Map<LayerStatus, { layers: number; amount: number }>()
  for (const row of rows) {
    const status = layerStatus(row)
    const amount = Math.abs(measure === 'value' ? layerReceiptValue(row) : layerReceiptQty(row))
    const bucket = buckets.get(status) ?? { layers: 0, amount: 0 }
    bucket.layers += 1
    bucket.amount += amount
    buckets.set(status, bucket)
  }
  const total = [...buckets.values()].reduce((sum, b) => sum + b.amount, 0)
  const segments = DISTRIBUTION_ORDER.filter((s) => buckets.has(s)).map((status) => {
    const bucket = buckets.get(status) as { layers: number; amount: number }
    return {
      status,
      label: LAYER_STATUS_LABEL[status],
      layers: bucket.layers,
      amount: bucket.amount,
      share: total > 0 ? (bucket.amount / total) * 100 : 0,
    }
  })
  return { segments, total }
}

// ---------------------------------------------------------------------------
// Cost statistics
// ---------------------------------------------------------------------------

export interface CostStats {
  /** Layers that still hold stock. */
  openLayers: number
  totalLayers: number
  minUnitCost: number | null
  maxUnitCost: number | null
  /** Weighted by the quantity still on hand — what the stock on hand averages. */
  weightedAvgCost: number | null
  /**
   * (max − min) / weighted average, as a percentage, over the OPEN layers.
   *
   * This is a spread, not a period-on-period variance: Inventory has no
   * endpoint that returns the previous period's unit cost, so the card that
   * would have carried one carries this instead and says which it is.
   */
  spreadPct: number | null
  openQty: number
  openValue: number
}

export function costStats(rows: readonly CostLayerRow[]): CostStats {
  const open = rows.filter((r) => num(r.qty_remaining) > 0)
  let qty = 0
  let value = 0
  let min: number | null = null
  let max: number | null = null
  for (const row of open) {
    const q = num(row.qty_remaining)
    const c = num(row.unit_cost)
    qty += q
    value += q * c
    min = min === null ? c : Math.min(min, c)
    max = max === null ? c : Math.max(max, c)
  }
  const weighted = qty > 0 ? value / qty : null
  const spread =
    weighted !== null && weighted !== 0 && min !== null && max !== null
      ? ((max - min) / Math.abs(weighted)) * 100
      : null
  return {
    openLayers: open.length,
    totalLayers: rows.length,
    minUnitCost: min,
    maxUnitCost: max,
    weightedAvgCost: weighted,
    spreadPct: spread,
    openQty: qty,
    openValue: value,
  }
}

// ---------------------------------------------------------------------------
// Refinement — the filters the API cannot express
// ---------------------------------------------------------------------------

/**
 * `GET /v1/valuation/cost-layers` filters on item, warehouse, layer kind,
 * open-only and financial year. Everything else a controller wants to slice by
 * — a status that is arithmetic, a received-date window, a cost band, a batch —
 * has no parameter, so the page asks for the item's layers and refines them
 * here.
 *
 * Kept in one predicate so the table, the count in the panel heading and the
 * export can never disagree about what "partially consumed" means.
 */
export interface LayerRefinement {
  status?: LayerStatus | null
  /** Open layers whose receipt is older than this many days. */
  agingDays?: number | null
  /** Remaining value at or above this — the "high value" chip. */
  minRemainingValue?: number | null
  batchId?: number | null
  receivedFrom?: string | null
  receivedTo?: string | null
  costMin?: number | null
  costMax?: number | null
  /** Layer has no source document linked. */
  unlinkedOnly?: boolean
}

export function isRefinementActive(r: LayerRefinement): boolean {
  return Boolean(
    r.status ||
      r.agingDays ||
      r.minRemainingValue ||
      r.batchId ||
      r.receivedFrom ||
      r.receivedTo ||
      r.costMin != null ||
      r.costMax != null ||
      r.unlinkedOnly,
  )
}

/** Whole days between an ISO date and `now`, or null when the date is unusable. */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (!Number.isFinite(then)) return null
  return Math.round((today - then) / 86_400_000)
}

export function matchesRefinement(
  row: CostLayerRow,
  refinement: LayerRefinement,
  now: Date = new Date(),
): boolean {
  if (refinement.status && layerStatus(row) !== refinement.status) return false
  if (refinement.agingDays) {
    const age = daysSince(row.received_at, now)
    if (num(row.qty_remaining) <= 0) return false
    if (age === null || age < refinement.agingDays) return false
  }
  if (refinement.minRemainingValue && num(row.remaining_value) < refinement.minRemainingValue) return false
  if (refinement.batchId && row.batch_id !== refinement.batchId) return false
  if (refinement.receivedFrom && (row.received_at ?? '') < refinement.receivedFrom) return false
  // `received_at` may carry a time; comparing against a bare date would drop the
  // last day of the window, so the bound is widened to the end of that day.
  if (refinement.receivedTo && (row.received_at ?? '') > `${refinement.receivedTo}￿`) return false
  if (refinement.costMin != null && num(row.unit_cost) < refinement.costMin) return false
  if (refinement.costMax != null && num(row.unit_cost) > refinement.costMax) return false
  if (refinement.unlinkedOnly && row.source_document_id !== null) return false
  return true
}

export function refineLayers(
  rows: readonly CostLayerRow[],
  refinement: LayerRefinement,
  now: Date = new Date(),
): CostLayerRow[] {
  if (!isRefinementActive(refinement)) return [...rows]
  return rows.filter((row) => matchesRefinement(row, refinement, now))
}

// ---------------------------------------------------------------------------
// Quick filters
// ---------------------------------------------------------------------------

export interface QuickFilterSpec {
  key: string
  label: string
  /** Server parameters this chip sets, if any. */
  server?: { open_only?: '1' | '0'; layer_kind?: string }
  refinement?: LayerRefinement
  hint: string
}

/** Open layers older than this read as ageing stock a controller should look at. */
export const AGING_DAYS = 180

/*
 * `open_only` is spelled out on every chip that needs it, because the server
 * reads it as `qty_remaining > 0`. A negative layer has a NEGATIVE remainder,
 * so "negative layers" with the open-only toggle left on would ask the server
 * for rows it has just been told to exclude and come back empty — the chip
 * would look broken on exactly the item it exists to surface.
 */
export const QUICK_FILTERS: readonly QuickFilterSpec[] = [
  { key: 'all', label: 'All layers', hint: 'Every layer this item has in scope' },
  {
    key: 'open',
    label: 'Open only',
    server: { open_only: '1' },
    hint: 'Layers that still hold stock \u2014 filtered by the server',
  },
  {
    key: 'aging',
    label: 'At risk (ageing)',
    server: { open_only: '1' },
    refinement: { agingDays: AGING_DAYS },
    hint: `Open layers received more than ${AGING_DAYS} days ago`,
  },
  {
    key: 'high_value',
    label: 'High value',
    server: { open_only: '1' },
    hint: 'The layers holding the top fifth of the remaining value',
  },
  {
    key: 'negative',
    label: 'Negative layers',
    server: { layer_kind: 'backorder', open_only: '0' },
    hint: 'Stock issued below zero, costed at the last known rate',
  },
  {
    key: 'partial',
    label: 'Partially consumed',
    server: { open_only: '1' },
    refinement: { status: 'partial' },
    hint: 'Layers part-issued and still holding stock',
  },
  {
    key: 'closed',
    label: 'Closed',
    server: { open_only: '0' },
    refinement: { status: 'closed' },
    hint: 'Layers fully consumed',
  },
]

export function quickFilter(key: string | null | undefined): QuickFilterSpec {
  return QUICK_FILTERS.find((f) => f.key === key) ?? QUICK_FILTERS[0]
}

/**
 * The "high value" chip's threshold, derived from the rows themselves.
 *
 * A fixed rupee figure would mean something different for paracetamol and for
 * a turbine, so the cut is the 80th percentile of remaining value across the
 * item's own layers. With fewer than five layers there is no distribution to
 * cut, and the chip passes everything rather than pretending to rank.
 */
export function highValueThreshold(rows: readonly CostLayerRow[]): number | null {
  const values = rows
    .map((r) => num(r.remaining_value))
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  if (values.length < 5) return null
  return values[Math.floor(values.length * 0.8)] ?? null
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ActivityKind = 'receipt' | 'issue' | 'recalculation' | 'revision'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  title: string
  /** ISO date or datetime — whatever the source row carried. */
  at: string
  /** Document number, job reference or actor. */
  reference: string | null
  detail: string
  to?: string
}

/**
 * The item's valuation history, assembled from records that already exist.
 *
 * Every entry is a row the API returned: a layer is a receipt, a consumption is
 * an issue, a recalculation job is a re-costing and a revision is a published
 * cost change. There is no activity feed endpoint and this does not pretend to
 * be one — it is four real lists merged on their own timestamps.
 */
export function buildActivity(
  layers: readonly CostLayerRow[],
  jobs: readonly RecalcJob[],
  revisions: readonly ValuationRevision[],
  limit = 8,
): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const layer of layers) {
    if (!layer.received_at) continue
    events.push({
      id: `layer-${layer.layer_id}`,
      kind: 'receipt',
      title: layer.layer_kind === 'opening' ? 'Opening layer' : 'Receipt added',
      at: layer.received_at,
      reference: layer.source_document_no ?? (layer.source_document_id ? `#${layer.source_document_id}` : null),
      detail: `${layerReceiptQty(layer)} received into ${layer.warehouse_name ?? 'stock'}`,
      to: layer.source_document_id ? `/documents/${layer.source_document_id}` : undefined,
    })
    for (const c of layer.consumptions ?? []) {
      if (!c.document_date && !c.created_at) continue
      events.push({
        id: `consumption-${c.consumption_id}`,
        kind: 'issue',
        title: 'Item issued',
        at: (c.document_date ?? c.created_at) as string,
        reference: c.document_no ?? (c.document_id ? `#${c.document_id}` : null),
        detail: `${c.qty} issued from the layer received ${layer.received_at}`,
        to: c.document_id ? `/documents/${c.document_id}` : undefined,
      })
    }
  }

  for (const job of jobs) {
    const at = job.finished_at ?? job.created_at
    if (!at) continue
    events.push({
      id: `job-${job.job_id}`,
      kind: 'recalculation',
      title: job.status === 'FAILED' ? 'Recalculation failed' : `Recalculation ${job.status.toLowerCase()}`,
      at,
      reference: job.requested_by ?? 'System',
      detail:
        job.status === 'FAILED'
          ? (job.failure_reason ?? 'The job did not finish.')
          : `${job.revised_line_count ?? 0} of ${job.affected_line_count ?? 0} lines revised${job.dry_run ? ' (dry run)' : ''}`,
      to: '/valuation/recalculations',
    })
  }

  for (const revision of revisions) {
    if (!revision.created_at) continue
    events.push({
      id: `revision-${revision.revision_id}`,
      kind: 'revision',
      title: 'Valuation revised',
      at: revision.created_at,
      reference: revision.document_no ?? (revision.document_id ? `#${revision.document_id}` : null),
      detail: `Cost ${revision.old_valuation_rate ?? '—'} → ${revision.new_valuation_rate ?? '—'}${
        revision.acknowledged ? ', applied in Books' : ', awaiting Books'
      }`,
      to: '/valuation/revisions',
    })
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type InsightSeverity = 'info' | 'warning' | 'critical'

export interface ValuationInsight {
  key: string
  severity: InsightSeverity
  title: string
  /** One or two sentences, carrying the figures the check actually measured. */
  detail: string
  /** What a human should do. Never what the screen has done. */
  action: string
}

export interface InsightContext {
  itemName: string
  unitSymbol?: string | null
  now?: Date
}

/** A receipt has to move this much against the running average to be worth a word. */
const COST_MOVE_PCT = 15
/** Below this the spread is ordinary batch-to-batch variation. */
const SPREAD_PCT = 25
/** Warehouses whose unit costs differ by more than this are worth checking. */
const WAREHOUSE_SPREAD_PCT = 10

function pct(from: number, to: number): number {
  return ((to - from) / Math.abs(from)) * 100
}

function round1(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

/**
 * Advisory readings of the item's layers.
 *
 * Every finding names the figures it was computed from, so a reader can check
 * it against the table rather than take it on trust. None of them changes
 * anything: there is no auto-correction here and no endpoint is called. A
 * finding is a prompt to look, and the action it suggests is always something
 * a person does.
 *
 * It deliberately returns an empty list when nothing is unusual. An insight
 * card that always has something to say is one nobody reads.
 */
export function buildInsights(
  rows: readonly CostLayerRow[],
  ctx: InsightContext,
): ValuationInsight[] {
  const now = ctx.now ?? new Date()
  const out: ValuationInsight[] = []
  const unit = ctx.unitSymbol ? ` ${ctx.unitSymbol}` : ''

  const receipts = rows
    .filter((r) => r.layer_kind === 'receipt' || r.layer_kind === 'opening')
    .slice()
    .sort((a, b) => String(a.received_at ?? '').localeCompare(String(b.received_at ?? '')))

  // 1 / 2 — the newest receipt against the average of the ones before it.
  if (receipts.length >= 3) {
    const latest = receipts[receipts.length - 1]
    const prior = receipts.slice(0, -1)
    const priorQty = prior.reduce((s, r) => s + layerReceiptQty(r), 0)
    const priorValue = prior.reduce((s, r) => s + layerReceiptValue(r), 0)
    const priorAvg = priorQty > 0 ? priorValue / priorQty : null
    const latestCost = num(latest.unit_cost)
    if (priorAvg !== null && priorAvg > 0 && latestCost > 0) {
      const move = pct(priorAvg, latestCost)
      if (move >= COST_MOVE_PCT) {
        out.push({
          key: 'cost_increase',
          severity: move >= COST_MOVE_PCT * 2 ? 'warning' : 'info',
          title: `Unit cost rose ${round1(move)} on the latest receipt`,
          detail: `${latest.source_document_no ?? 'The latest receipt'} on ${latest.received_at ?? 'an unknown date'} costed ${ctx.itemName} at ${latestCost}${unit}, against ${priorAvg.toFixed(4)} averaged over the previous ${prior.length} receipts.`,
          action: 'Check the supplier rate, the landed-cost apportionment and whether this batch is a different grade.',
        })
      } else if (move <= -COST_MOVE_PCT) {
        out.push({
          key: 'cost_decrease',
          severity: 'info',
          title: `Unit cost fell ${round1(move)} on the latest receipt`,
          detail: `${latest.source_document_no ?? 'The latest receipt'} costed at ${latestCost}${unit}, against ${priorAvg.toFixed(4)} averaged over the previous ${prior.length} receipts.`,
          action: 'Confirm the purchase rate and that freight and duty were apportioned onto this receipt.',
        })
      }
    }
  }

  // 3 — stock issued below zero.
  const negatives = rows.filter((r) => num(r.qty_remaining) < 0 || r.layer_kind === 'backorder')
  if (negatives.length > 0) {
    const qty = negatives.reduce((s, r) => s + num(r.qty_remaining), 0)
    out.push({
      key: 'negative_layer',
      severity: 'critical',
      title: `${negatives.length} negative layer${negatives.length === 1 ? '' : 's'} on this item`,
      detail: `${Math.abs(qty)}${unit} has been issued below zero and is costed at the last known rate until a receipt arrives. The valuation of those issues will change when it does.`,
      action: 'Post the missing receipt, then recalculate from its date so the issues pick up the real cost.',
    })
  }

  // 4 — a receipt costed at nothing.
  const zeroCost = rows.filter((r) => num(r.unit_cost) === 0 && layerReceiptQty(r) > 0 && r.layer_kind !== 'backorder')
  if (zeroCost.length > 0) {
    out.push({
      key: 'zero_cost',
      severity: 'warning',
      title: `${zeroCost.length} layer${zeroCost.length === 1 ? '' : 's'} received at zero cost`,
      detail: `Stock was taken in with no unit cost, so anything issued from ${zeroCost.length === 1 ? 'it' : 'them'} reaches COGS at nothing and closing stock is understated.`,
      action: 'Open the receipt and check whether the rate was left blank or the cost is genuinely nil.',
    })
  }

  // 5 — ageing stock nobody has touched.
  const stale = rows.filter((r) => {
    if (num(r.qty_remaining) <= 0) return false
    const age = daysSince(r.received_at, now)
    return age !== null && age >= AGING_DAYS && consumedQty(r) === 0
  })
  if (stale.length > 0) {
    const value = stale.reduce((s, r) => s + num(r.remaining_value), 0)
    out.push({
      key: 'stale_layer',
      severity: 'warning',
      title: `${stale.length} layer${stale.length === 1 ? '' : 's'} untouched for over ${AGING_DAYS} days`,
      detail: `${value.toFixed(2)} of value is sitting in layers received more than ${AGING_DAYS} days ago from which nothing has been issued.`,
      action: 'Review for obsolescence, expiry or a write-down before the year closes.',
    })
  }

  // 6 — the same item costing different money in different warehouses.
  const byWarehouse = new Map<string, { qty: number; value: number }>()
  for (const row of rows) {
    if (num(row.qty_remaining) <= 0) continue
    const key = row.warehouse_name ?? `#${row.warehouse_id ?? 0}`
    const bucket = byWarehouse.get(key) ?? { qty: 0, value: 0 }
    bucket.qty += num(row.qty_remaining)
    bucket.value += num(row.qty_remaining) * num(row.unit_cost)
    byWarehouse.set(key, bucket)
  }
  if (byWarehouse.size >= 2) {
    const averages = [...byWarehouse.entries()]
      .filter(([, b]) => b.qty > 0)
      .map(([name, b]) => ({ name, avg: b.value / b.qty }))
      .sort((a, b) => a.avg - b.avg)
    const low = averages[0]
    const high = averages[averages.length - 1]
    if (low && high && low.avg > 0) {
      const gap = pct(low.avg, high.avg)
      if (gap >= WAREHOUSE_SPREAD_PCT) {
        out.push({
          key: 'warehouse_spread',
          severity: 'info',
          title: `Unit cost differs ${round1(gap)} between warehouses`,
          detail: `Open stock averages ${high.avg.toFixed(4)} in ${high.name} and ${low.avg.toFixed(4)} in ${low.name}.`,
          action: 'Expected where transfers carry freight; worth checking if the two were bought on the same terms.',
        })
      }
    }
  }

  // 7 — a wide spread across what is still on hand.
  const stats = costStats(rows)
  if (
    stats.spreadPct !== null &&
    stats.spreadPct >= SPREAD_PCT &&
    stats.openLayers >= 2 &&
    !out.some((i) => i.key === 'cost_increase' || i.key === 'cost_decrease')
  ) {
    out.push({
      key: 'cost_spread',
      severity: 'info',
      title: `Open layers span ${stats.spreadPct.toFixed(1)}% in unit cost`,
      detail: `The stock on hand is held at between ${stats.minUnitCost?.toFixed(4)} and ${stats.maxUnitCost?.toFixed(4)}, averaging ${stats.weightedAvgCost?.toFixed(4)}. Which layers are issued first will move COGS noticeably.`,
      action: 'Confirm the item is on the method you intend — FIFO and weighted average give different answers at this spread.',
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export interface ValuationException {
  key: string
  severity: InsightSeverity
  category: string
  subject: string
  warehouse: string | null
  document: string | null
  at: string | null
  reason: string
  impact: string
  action: string
  to?: string
}

export interface ExceptionContext {
  itemName: string
  now?: Date
}

/**
 * Everything on this item that a valuation reviewer should not sign off without
 * looking at, gathered from the layers, the recalculation jobs and the
 * revisions that have not reached Books.
 *
 * It reports. It never resolves: a negative layer is fixed by posting the
 * missing receipt, not by a screen deciding what the cost should have been.
 */
export function buildExceptions(
  rows: readonly CostLayerRow[],
  jobs: readonly RecalcJob[],
  revisions: readonly ValuationRevision[],
  ctx: ExceptionContext,
): ValuationException[] {
  const now = ctx.now ?? new Date()
  const out: ValuationException[] = []

  for (const row of rows) {
    const where = row.warehouse_name ?? null
    const doc = row.source_document_no ?? (row.source_document_id ? `#${row.source_document_id}` : null)
    const to = row.source_document_id ? `/documents/${row.source_document_id}` : undefined

    if (num(row.qty_remaining) < 0 || row.layer_kind === 'backorder') {
      out.push({
        key: `negative-${row.layer_id}`,
        severity: 'critical',
        category: 'Negative stock layer',
        subject: ctx.itemName,
        warehouse: where,
        document: doc,
        at: row.received_at,
        reason: `${Math.abs(num(row.qty_remaining))} issued below zero, held at ${num(row.unit_cost)}.`,
        impact: 'COGS on those issues is provisional and will change when the receipt is posted.',
        action: 'Post the missing receipt, then recalculate from its date.',
        to,
      })
    }

    if (num(row.unit_cost) === 0 && layerReceiptQty(row) > 0 && row.layer_kind !== 'backorder') {
      out.push({
        key: `zero-cost-${row.layer_id}`,
        severity: 'warning',
        category: 'Zero-cost receipt',
        subject: ctx.itemName,
        warehouse: where,
        document: doc,
        at: row.received_at,
        reason: `${layerReceiptQty(row)} taken in at no cost.`,
        impact: 'Closing stock is understated and issues from this layer reach COGS at nil.',
        action: 'Check the receipt rate before the period is closed.',
        to,
      })
    }

    if (typeof row.qty_received === 'number' && consumedQty(row) > row.qty_received + 1e-6) {
      out.push({
        key: `over-consumed-${row.layer_id}`,
        severity: 'critical',
        category: 'Consumption exceeds receipt',
        subject: ctx.itemName,
        warehouse: where,
        document: doc,
        at: row.received_at,
        reason: `${consumedQty(row)} consumed from a layer of ${row.qty_received}.`,
        impact: 'The layer balance cannot be reconciled to its movements.',
        action: 'Raise this with support — the consumption ledger disagrees with the layer.',
        to,
      })
    }

    if (row.source_document_id === null && row.layer_kind === 'receipt') {
      out.push({
        key: `unlinked-${row.layer_id}`,
        severity: 'warning',
        category: 'Missing receipt linkage',
        subject: ctx.itemName,
        warehouse: where,
        document: null,
        at: row.received_at,
        reason: 'The layer has no source document.',
        impact: 'The cost cannot be traced back to a receipt on audit.',
        action: 'Check whether the source document was deleted after the layer was written.',
      })
    }

    const age = daysSince(row.received_at, now)
    if (num(row.qty_remaining) > 0 && consumedQty(row) === 0 && age !== null && age >= AGING_DAYS) {
      out.push({
        key: `stale-${row.layer_id}`,
        severity: 'info',
        category: 'Ageing layer',
        subject: ctx.itemName,
        warehouse: where,
        document: doc,
        at: row.received_at,
        reason: `Received ${age} days ago and nothing has been issued from it.`,
        impact: `${num(row.remaining_value)} of value may need a write-down.`,
        action: 'Review for obsolescence or expiry.',
        to,
      })
    }
  }

  for (const job of jobs) {
    if (job.status !== 'FAILED') continue
    out.push({
      key: `job-${job.job_id}`,
      severity: 'critical',
      category: 'Failed recalculation',
      subject: job.item_name ?? ctx.itemName,
      warehouse: null,
      document: `Job #${job.job_id}`,
      at: job.finished_at ?? job.created_at,
      reason: job.failure_reason ?? 'The job stopped without a reason.',
      impact: 'Costs after the job’s from-date may not reflect the backdated change.',
      action: 'Re-run the recalculation once the cause is cleared.',
      to: '/valuation/recalculations',
    })
  }

  const pending = revisions.filter((r) => !r.acknowledged)
  if (pending.length > 0) {
    const delta = pending.reduce((s, r) => s + num(r.delta_amount), 0)
    out.push({
      key: 'revisions-pending',
      severity: 'warning',
      category: 'Revision awaiting Books',
      subject: ctx.itemName,
      warehouse: null,
      document: `${pending.length} revision${pending.length === 1 ? '' : 's'}`,
      at: pending[0]?.created_at ?? null,
      reason: 'Cost changes have been published but Books has not acknowledged them.',
      impact: `${delta.toFixed(2)} of COGS movement is not yet reflected in the accounts.`,
      action: 'Follow up in Valuation › Revisions; unacknowledged revisions also show in reconciliation.',
      to: '/valuation/revisions',
    })
  }

  const rank: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
