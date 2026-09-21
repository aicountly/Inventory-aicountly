/**
 * Everything the cost-layers screen works out for itself, as pure functions.
 *
 * The rule the whole file is written to: nothing here invents a figure. Each
 * function is arithmetic over rows the valuation API already returned, and
 * where an input is missing it returns `null` so the screen can say "not
 * available" instead of printing a plausible number. Valuation is what an
 * auditor reads; a confident guess is worse here than a blank.
 */

import type {
  CostLayerDistribution,
  CostLayerRow,
  CostLayerStatus,
  CostLayersSummary,
  RecalcJob,
  ValuationRevision,
} from '../../../services/valuationApi'
import { layerStatusOf } from '../../../services/valuationApi'

/* ------------------------------------------------------------------ status */

export const LAYER_STATUS_LABEL: Record<CostLayerStatus, string> = {
  open: 'Open',
  partial: 'Partially consumed',
  closed: 'Closed',
  negative: 'Negative',
}

/** Full form for the legend, the drawer and the export sheet. */
export const LAYER_STATUS_SHORT: Record<CostLayerStatus, string> = {
  open: 'Open',
  partial: 'Partially consumed',
  closed: 'Closed',
  negative: 'Negative',
}

/**
 * The word in the grid's status column.
 *
 * One word, like every other status chip in the product, and for a concrete
 * reason: `Badge` sets the chip uppercase with letter-spacing, so "PARTIALLY
 * CONSUMED" is about 150px — a seventh of the table on a 1600px screen, spent
 * on a phrase the reader is scanning for shape rather than reading. The full
 * wording is on the chip's tooltip, in the drawer, in the legend beside the
 * table, on the filter chips and in the export.
 */
export const LAYER_STATUS_CHIP: Record<CostLayerStatus, string> = {
  open: 'Open',
  partial: 'Partial',
  closed: 'Closed',
  negative: 'Negative',
}

export const LAYER_STATUS_HINT: Record<CostLayerStatus, string> = {
  open: 'Received and not yet issued against.',
  partial: 'Some of the receipt has been issued; the rest is still valued here.',
  closed: 'Fully consumed — it holds no remaining value.',
  negative: 'Issued below zero: costed at the last known rate until a receipt arrives.',
}

export const LAYER_STATUS_FILTERS: readonly { value: '' | CostLayerStatus; label: string }[] = [
  { value: '', label: 'Any state' },
  { value: 'open', label: 'Open' },
  { value: 'partial', label: 'Partially consumed' },
  { value: 'closed', label: 'Closed' },
  { value: 'negative', label: 'Negative' },
]

/* -------------------------------------------------------------------- time */

/** Epoch milliseconds for an API timestamp, or null when it cannot be read. */
export function toTime(value: string | null | undefined): number | null {
  if (!value) return null
  const normalised = String(value).trim().replace(' ', 'T')
  const ms = Date.parse(normalised)
  return Number.isFinite(ms) ? ms : null
}

/** Whole days between two instants, floored. Negative when `at` is in the future. */
export function daysBetween(at: number, now: number): number {
  return Math.floor((now - at) / 86_400_000)
}

/* ------------------------------------------------------------- the periods */

export interface PeriodOption {
  /** `2026-04`, or '' for the whole financial year. */
  value: string
  label: string
  from: string
  to: string
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

/**
 * One option per month of the financial year, newest first, with the whole
 * year on top.
 *
 * Driven by the FY the header already selected rather than by a calendar year:
 * an Indian book year runs April to March, and a period list that started in
 * January would offer three months the ledger does not have and hide three it
 * does. An unreadable range yields just the "whole year" option — never a
 * guessed twelve months.
 */
export function periodOptions(fyFrom: string, fyTo: string): PeriodOption[] {
  const all: PeriodOption = { value: '', label: 'Whole financial year', from: fyFrom, to: fyTo }
  const start = /^(\d{4})-(\d{2})/.exec(fyFrom || '')
  const end = /^(\d{4})-(\d{2})/.exec(fyTo || '')
  if (!start || !end) return [all]

  const months: PeriodOption[] = []
  let year = Number(start[1])
  let month = Number(start[2])
  const endYear = Number(end[1])
  const endMonth = Number(end[2])
  // 24 is a guard, not a limit: no financial year is longer, and a malformed
  // range must not spin here.
  for (let i = 0; i < 24; i += 1) {
    if (year > endYear || (year === endYear && month > endMonth)) break
    months.push({
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: monthLabel(year, month),
      from: `${year}-${String(month).padStart(2, '0')}-01`,
      to: lastDayOfMonth(year, month),
    })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  months.reverse()
  return [all, ...months]
}

/** The option a stored `period` value refers to, or the whole-year default. */
export function periodFor(options: readonly PeriodOption[], value: string): PeriodOption | null {
  if (!value) return null
  return options.find((o) => o.value === value) ?? null
}

/* ------------------------------------------------------------ distribution */

export type DistributionMeasure = 'value' | 'qty'

export interface DistributionSegment {
  status: CostLayerStatus
  label: string
  layerCount: number
  /** Signed — a negative bucket stays negative in the legend. */
  amount: number
  /** 0–100, computed over the magnitudes so the bar always sums to 100. */
  share: number
}

/**
 * The item's layers split by state, at opening value (or opening quantity).
 *
 * Opening value, not remaining value: a closed layer has nothing remaining, so
 * a split over remaining value would price every exhausted layer at zero and
 * claim the item's cost had never moved. Shares run over magnitudes so a
 * backorder bucket cannot push the bar past 100%.
 */
export function distributionSegments(
  distribution: CostLayerDistribution | null | undefined,
  measure: DistributionMeasure,
): DistributionSegment[] {
  const buckets = distribution?.buckets ?? []
  if (buckets.length === 0) return []
  const amountOf = (b: (typeof buckets)[number]) => (measure === 'value' ? b.value : b.qty)
  const magnitude = buckets.reduce((sum, b) => sum + Math.abs(amountOf(b)), 0)
  return buckets
    .filter((b) => b.layer_count > 0)
    .map((b) => ({
      status: b.status,
      label: LAYER_STATUS_SHORT[b.status] ?? b.status,
      layerCount: b.layer_count,
      amount: amountOf(b),
      share: magnitude > 0 ? (Math.abs(amountOf(b)) / magnitude) * 100 : 0,
    }))
}

/* ------------------------------------------------------------- cost spread */

export interface CostSpread {
  min: number
  max: number
  /** Weighted by received quantity — what a unit of this item actually cost. */
  avg: number
  /**
   * How far the cheapest layer sits below the dearest, as a percentage of the
   * dearest: 0% when every layer cost the same, approaching 100% when one
   * layer cost almost nothing.
   *
   * Measured against the dearest layer rather than the average ON PURPOSE. A
   * span divided by the average is unbounded — an item with layers at 0.85 and
   * 15.60 around a weighted average of 1.56 reports "943.9% variance", which is
   * arithmetically true and reads on a KPI card as a broken number. This one
   * stays inside 0–100, so a threshold means the same thing on every item.
   */
  spreadPct: number
  layerCount: number
}

/**
 * How far apart the layer costs of one item sit.
 *
 * Returns null on a single layer, or where no layer has a cost: a spread needs
 * two costs to be a spread, and dividing by a zero dearest cost would print
 * `Infinity%`.
 */
export function costSpread(summary: CostLayersSummary | null | undefined): CostSpread | null {
  if (!summary) return null
  const { unit_cost_min: min, unit_cost_max: max, unit_cost_avg: avg, layer_count: count } = summary
  if (min == null || max == null || avg == null) return null
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(avg)) return null
  if (max === 0 || (count ?? 0) < 2) return null
  return {
    min,
    max,
    avg,
    spreadPct: ((max - min) / Math.abs(max)) * 100,
    layerCount: count ?? 0,
  }
}

/* --------------------------------------------------------------- exceptions */

export type ExceptionSeverity = 'critical' | 'high' | 'medium' | 'low'

export const SEVERITY_ORDER: Record<ExceptionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export interface LayerException {
  key: string
  category: string
  severity: ExceptionSeverity
  layerId: number
  headline: string
  /** Why this layer was flagged, in the reader's terms. */
  detail: string
  /** What it does to the valuation if it is real. */
  impact: string
  /** What to go and check. Never "we fixed it". */
  action: string
  warehouse: string | null
  documentNo: string | null
  documentId: number | null
  at: string | null
}

export interface ExceptionOptions {
  /** Weighted average unit cost to measure a variance against. */
  avgUnitCost?: number | null
  /** Clock reading, injected so the tests are not time-dependent. */
  now?: number
  /** An untouched open layer older than this is stale. */
  staleDays?: number
  /** A layer this far from the average unit cost is a variance. */
  variancePct?: number
}

/**
 * The layers worth a second look, found by reading the rows already on screen.
 *
 * Every rule is a fact about a row — a negative balance, a zero cost, a missing
 * source document, an expiry in the past — not a score and not a prediction.
 * Nothing here resolves anything: valuation exceptions are corrected by posting
 * a document or running a recalculation, both of which a person has to approve.
 */
export function detectExceptions(
  rows: readonly CostLayerRow[],
  options: ExceptionOptions = {},
): LayerException[] {
  const now = options.now ?? Date.now()
  const staleDays = options.staleDays ?? 180
  const variancePct = options.variancePct ?? 25
  const avg = options.avgUnitCost ?? null
  const found: LayerException[] = []

  for (const row of rows) {
    const status = layerStatusOf(row)
    const at = row.received_at ?? row.created_at ?? null
    const base = {
      layerId: row.layer_id,
      warehouse: row.warehouse_name ?? null,
      documentNo: row.source_document_no ?? null,
      documentId: row.source_document_id ?? null,
      at,
    }

    if (status === 'negative') {
      found.push({
        ...base,
        key: `negative-${row.layer_id}`,
        category: 'Negative stock layer',
        severity: 'critical',
        headline: `Balance of ${row.qty_remaining} below zero`,
        detail:
          'Stock was issued before a receipt existed for it, so this layer carries a negative balance costed at the last known rate.',
        impact: 'The item is valued at an estimated rate until the receipt that covers it is posted.',
        action: 'Post the missing receipt, then recalculate from its date so the issues are re-costed.',
      })
    }

    if (row.unit_cost <= 0 && (row.qty_received ?? row.qty_remaining) > 0) {
      found.push({
        ...base,
        key: `zero-cost-${row.layer_id}`,
        category: 'Zero or negative unit cost',
        severity: 'high',
        headline: `Layer opened at a unit cost of ${row.unit_cost}`,
        detail:
          'A receipt layer with no cost values every unit it issues at nothing, which understates COGS for as long as it is open.',
        impact: 'Closing value and COGS are both understated by the whole of this layer.',
        action: 'Check the source document’s rate, then re-price it with a stock revaluation.',
      })
    }

    if (avg != null && avg !== 0 && row.unit_cost > 0) {
      const deviation = ((row.unit_cost - avg) / Math.abs(avg)) * 100
      if (Math.abs(deviation) >= variancePct) {
        const multiple = row.unit_cost / Math.abs(avg)
        found.push({
          ...base,
          key: `variance-${row.layer_id}`,
          category: 'Unit cost variance',
          severity: 'medium',
          // Past double the average a percentage stops being readable — "above
          // by 699.9%" is true and means nothing at a glance, where "8.0x the
          // average layer cost" lands immediately.
          headline:
            multiple >= 2
              ? `${multiple.toFixed(1)}x the average layer cost`
              : `${deviation > 0 ? 'Above' : 'Below'} the average layer cost by ${Math.abs(deviation).toFixed(1)}%`,
          detail: `This layer opened at ${row.unit_cost} against a weighted average of ${avg.toFixed(4)} across the item’s layers.`,
          impact: 'Issues drawn from this layer will cost noticeably more or less than the item’s other stock.',
          action: 'Confirm the purchase rate, landed cost allocation and unit conversion on the source document.',
        })
      }
    }

    if (row.layer_kind === 'receipt' && row.source_document_id === null) {
      found.push({
        ...base,
        key: `unlinked-${row.layer_id}`,
        category: 'Missing receipt linkage',
        severity: 'medium',
        headline: 'Receipt layer with no source document',
        detail: 'The layer records a receipt but no document is linked to it, so its cost cannot be traced.',
        impact: 'The layer cannot be audited back to a purchase or production record.',
        action: 'Trace the movement in the stock ledger and re-link or re-post the receipt.',
      })
    }

    const expiry = toTime(row.expiry_date)
    if (expiry !== null && expiry < now && row.qty_remaining > 0) {
      found.push({
        ...base,
        key: `expired-${row.layer_id}`,
        category: 'Expired batch still valued',
        severity: 'high',
        headline: `Batch ${row.batch_no ?? row.batch_id ?? ''} expired with stock remaining`.trim(),
        detail: 'The batch on this layer passed its expiry date while the layer still holds quantity and value.',
        impact: 'Closing value includes stock that may no longer be saleable.',
        action: 'Write the batch off or quarantine it, so the valuation stops carrying it.',
      })
    }

    const receivedAt = toTime(row.received_at)
    const consumed = row.qty_consumed ?? 0
    if (status === 'open' && receivedAt !== null && consumed === 0) {
      const age = daysBetween(receivedAt, now)
      if (age >= staleDays) {
        found.push({
          ...base,
          key: `stale-${row.layer_id}`,
          category: 'Layer never consumed',
          severity: 'low',
          headline: `Open for ${age} days with nothing issued against it`,
          detail: 'Under FIFO an untouched layer this old usually means the stock is not moving, or issues are drawing from elsewhere.',
          impact: 'Value is held against stock that may be obsolete or already gone physically.',
          action: 'Check physical stock for this batch and warehouse, then count or write down as required.',
        })
      }
    }

    const created = toTime(row.created_at)
    if (receivedAt !== null && created !== null && daysBetween(receivedAt, created) >= 1) {
      found.push({
        ...base,
        key: `backdated-${row.layer_id}`,
        category: 'Backdated receipt',
        severity: 'low',
        headline: `Entered ${daysBetween(receivedAt, created)} days after its receipt date`,
        detail: 'Issues posted between the two dates were costed before this layer existed.',
        impact: 'Earlier issues may hold a cost the layer would have changed.',
        action: 'Run a recalculation from the receipt date to re-cost everything after it.',
      })
    }
  }

  return found.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    return (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0)
  })
}

/* ----------------------------------------------------------------- activity */

export type ActivityKind = 'recalculation' | 'revision' | 'receipt' | 'issue'

export interface ActivityEvent {
  key: string
  kind: ActivityKind
  title: string
  /** ISO-ish timestamp as the API sent it; the view formats it. */
  at: string | null
  /** The reference line — document number, job, actor. */
  meta: string
  detail: string
  /** In-app link to the record behind the event, when there is one. */
  to?: string
  /** Completed / failed, for the icon tone. Only recalculations carry it. */
  failed?: boolean
}

export interface ActivityInput {
  layers: readonly CostLayerRow[]
  jobs: readonly RecalcJob[]
  revisions: readonly ValuationRevision[]
  limit?: number
}

/**
 * One timeline over four real sources: recalculation jobs, the COGS revisions
 * they published, the receipts that opened the layers on screen, and the issues
 * that consumed them.
 *
 * Nothing is fetched for it beyond what the page already has, and an event is
 * only listed if the record behind it exists — there is no "system tidied up"
 * filler line.
 */
export function activityEvents({ layers, jobs, revisions, limit = 6 }: ActivityInput): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const job of jobs) {
    const finished = job.finished_at ?? job.started_at ?? job.created_at
    const failed = job.status === 'FAILED'
    events.push({
      key: `job-${job.job_id}`,
      kind: 'recalculation',
      failed,
      title: failed
        ? 'Recalculation failed'
        : job.status === 'COMPLETED'
          ? `Recalculation ${job.dry_run ? 'dry run ' : ''}completed`
          : `Recalculation ${job.status.toLowerCase()}`,
      at: finished,
      meta: job.requested_by ? `By ${job.requested_by}` : 'System',
      detail: failed
        ? (job.failure_reason ?? 'The job stopped before it finished.')
        : `${job.revised_line_count ?? 0} of ${job.affected_line_count ?? 0} lines revised from ${job.from_date}`,
      to: `/valuation/recalculations?item_id=${job.item_id ?? ''}`,
    })
  }

  for (const revision of revisions) {
    events.push({
      key: `revision-${revision.revision_id}`,
      kind: 'revision',
      title: 'Valuation revised',
      at: revision.created_at,
      meta: revision.document_no ?? (revision.document_id ? `#${revision.document_id}` : 'Revision'),
      detail: `${revision.old_valuation_rate ?? '—'} → ${revision.new_valuation_rate ?? '—'} per unit${
        revision.acknowledged ? ', acknowledged by Books' : ', awaiting Books'
      }`,
      to: revision.document_id ? `/documents/${revision.document_id}` : undefined,
    })
  }

  for (const layer of layers) {
    events.push({
      key: `layer-${layer.layer_id}`,
      kind: 'receipt',
      title: layer.layer_kind === 'revaluation' ? 'Layer revalued' : 'Layer opened',
      at: layer.received_at,
      meta: layer.source_document_no ?? layer.warehouse_name ?? 'Receipt',
      detail: `${layer.qty_received ?? layer.qty_remaining} units at ${layer.unit_cost}`,
      to: layer.source_document_id ? `/documents/${layer.source_document_id}` : undefined,
    })
    for (const consumption of layer.consumptions ?? []) {
      events.push({
        key: `consumption-${consumption.consumption_id}`,
        kind: 'issue',
        title: 'Issued from layer',
        at: consumption.document_date ?? consumption.created_at,
        meta: consumption.document_no ?? (consumption.document_id ? `#${consumption.document_id}` : 'Movement'),
        detail: `${consumption.qty} units at ${consumption.unit_cost}`,
        to: consumption.document_id ? `/documents/${consumption.document_id}` : undefined,
      })
    }
  }

  return events
    .filter((e) => e.at !== null)
    .sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ insight */

export interface ValuationInsight {
  key: string
  tone: 'critical' | 'warning' | 'info'
  headline: string
  detail: string
  /** What a reader should look at next. Advisory — never an applied change. */
  action: string
}

/** Weighted average unit cost of a set of layers, or null when there is no quantity. */
export function weightedAverageCost(rows: readonly CostLayerRow[]): number | null {
  let qty = 0
  let value = 0
  for (const row of rows) {
    const received = row.qty_received ?? row.qty_remaining
    if (!Number.isFinite(received) || received <= 0) continue
    qty += received
    value += received * row.unit_cost
  }
  return qty > 0 ? value / qty : null
}

export interface InsightOptions {
  now?: number
  /** Layers at the end of the series treated as "the latest receipts". */
  recentCount?: number
  /** Below this the cost move is not worth a card. */
  movePct?: number
}

/**
 * The one thing about this item's layers most worth saying, or nothing.
 *
 * It is labelled an insight, and it is exactly that: arithmetic over the layers
 * on screen, computed in the browser, stating what the rows show. No model is
 * called, no conclusion is drawn that the figures do not support, and the card
 * it feeds changes no valuation — every corrective action it names is a
 * document or a recalculation a person has to run.
 *
 * Returning null is a real answer and the common one: a well-behaved item gets
 * a card saying nothing stood out, not a manufactured observation.
 */
export function deriveInsight(
  rows: readonly CostLayerRow[],
  summary: CostLayersSummary | null | undefined,
  exceptions: readonly LayerException[],
  options: InsightOptions = {},
): ValuationInsight | null {
  const recentCount = options.recentCount ?? 2
  const movePct = options.movePct ?? 10

  const negatives = exceptions.filter((e) => e.category === 'Negative stock layer')
  if (negatives.length > 0) {
    return {
      key: 'negative',
      tone: 'critical',
      headline: `${negatives.length} layer${negatives.length === 1 ? '' : 's'} carry a negative balance`,
      detail:
        'Stock was issued before a receipt covered it, so those issues are costed at the last known rate rather than a real one.',
      action: 'Post the missing receipts, then recalculate from the earliest of their dates.',
    }
  }

  const zeroCost = exceptions.filter((e) => e.category === 'Zero or negative unit cost')
  if (zeroCost.length > 0) {
    return {
      key: 'zero-cost',
      tone: 'critical',
      headline: `${zeroCost.length} layer${zeroCost.length === 1 ? '' : 's'} opened with no unit cost`,
      detail: 'Units issued from a zero-cost layer leave COGS untouched, which understates the cost of sales.',
      action: 'Check the rate on each source document and re-price with a stock revaluation.',
    }
  }

  // The cost move: the last few receipts against the weighted average of the
  // ones before them. Needs at least one layer on each side to mean anything.
  const receipts = rows
    .filter((r) => (r.qty_received ?? 0) > 0 && toTime(r.received_at) !== null)
    .slice()
    .sort((a, b) => (toTime(a.received_at) ?? 0) - (toTime(b.received_at) ?? 0))
  if (receipts.length >= recentCount + 1) {
    const recent = receipts.slice(-recentCount)
    const baseline = receipts.slice(0, -recentCount)
    const recentAvg = weightedAverageCost(recent)
    const baselineAvg = weightedAverageCost(baseline)
    if (recentAvg != null && baselineAvg != null && baselineAvg !== 0) {
      const move = ((recentAvg - baselineAvg) / Math.abs(baselineAvg)) * 100
      if (Math.abs(move) >= movePct) {
        const rose = move > 0
        return {
          key: 'cost-move',
          tone: rose ? 'warning' : 'info',
          headline: `Unit cost ${rose ? 'rose' : 'fell'} ${Math.abs(move).toFixed(1)}% on the last ${recent.length} receipt${
            recent.length === 1 ? '' : 's'
          }`,
          detail: `They opened at a weighted average of ${recentAvg.toFixed(4)} against ${baselineAvg.toFixed(4)} across the ${baseline.length} earlier layer${
            baseline.length === 1 ? '' : 's'
          }.`,
          action: rose
            ? 'Review supplier pricing, landed cost allocation and batch grade before the next purchase.'
            : 'Confirm the lower rate is real and not a missing landed cost or a wrong unit conversion.',
        }
      }
    }
  }

  const stale = exceptions.filter((e) => e.category === 'Layer never consumed')
  if (stale.length > 0) {
    return {
      key: 'stale',
      tone: 'warning',
      headline: `${stale.length} open layer${stale.length === 1 ? '' : 's'} have never been issued against`,
      detail: 'Under FIFO the oldest layer should empty first, so untouched old layers usually mean the stock is not moving.',
      action: 'Count the affected batches and warehouses, then write down what is no longer sellable.',
    }
  }

  const spread = costSpread(summary)
  if (spread && spread.spreadPct >= 40) {
    return {
      key: 'spread',
      tone: 'info',
      headline: `The cheapest layer sits ${spread.spreadPct.toFixed(1)}% below the dearest`,
      detail: `They opened at ${spread.min} and ${spread.max}, against a weighted average of ${spread.avg.toFixed(4)} across the item's layers.`,
      action: 'Expect COGS to step as issues move between layers; check whether the spread is pricing or unit conversion.',
    }
  }

  return null
}

/* --------------------------------------------------------------------- KPIs */

/** Layers still holding value — what the "open layers" card counts. */
export function openLayerCount(distribution: CostLayerDistribution | null | undefined): number | null {
  if (!distribution) return null
  return distribution.buckets
    .filter((b) => b.status === 'open' || b.status === 'partial')
    .reduce((sum, b) => sum + b.layer_count, 0)
}

/* ------------------------------------------------------------- quick views */

export interface QuickView {
  key: string
  label: string
  /**
   * The URL parameters this view writes. Every key any view can write is
   * cleared first, so picking one is a whole answer rather than a layer on top
   * of the last one.
   */
  params: Record<string, string>
  hint: string
}

/** Every parameter the chips own, so switching view cannot leave a stray one. */
export const QUICK_VIEW_KEYS = ['status', 'sort', 'order'] as const

export const QUICK_VIEWS: readonly QuickView[] = [
  { key: 'all', label: 'All layers', params: {}, hint: 'Every layer in the period, whatever state it is in.' },
  { key: 'open', label: 'Open', params: { status: 'open' }, hint: 'Received and not yet issued against.' },
  {
    key: 'partial',
    label: 'Partially consumed',
    params: { status: 'partial' },
    hint: 'Part of the receipt has been issued; the rest is still valued.',
  },
  { key: 'closed', label: 'Closed', params: { status: 'closed' }, hint: 'Fully consumed — no remaining value.' },
  {
    key: 'negative',
    label: 'Negative layers',
    params: { status: 'negative' },
    hint: 'Issued below zero and costed at the last known rate.',
  },
  {
    key: 'aging',
    label: 'At risk (ageing)',
    params: { status: 'open', sort: 'received_at', order: 'asc' },
    hint: 'Oldest open layers first — under FIFO these should have emptied already.',
  },
  {
    key: 'high-value',
    label: 'High value',
    params: { sort: 'remaining_value', order: 'desc' },
    hint: 'The layers holding the most remaining value.',
  },
] as const

/**
 * Which chip is lit for the filters currently in the URL.
 *
 * Specific views win: "at risk (ageing)" also sets `status=open`, so a plain
 * "open" chip would otherwise light up beside it and the row would claim two
 * answers to one question.
 */
export function activeQuickView(current: { status?: string; sort?: string; order?: string }): string {
  const candidates = QUICK_VIEWS.filter((v) => v.key !== 'all')
    .slice()
    .sort((a, b) => Object.keys(b.params).length - Object.keys(a.params).length)
  for (const view of candidates) {
    const matches = Object.entries(view.params).every(([key, value]) => (current[key as keyof typeof current] ?? '') === value)
    if (matches) return view.key
  }
  return (current.status ?? '') === '' ? 'all' : ''
}
