/**
 * Pure transforms behind the Valuation dashboard.
 *
 * Two distinctions this module exists to keep straight, because collapsing
 * either one produces a screen that reads plausibly and is wrong:
 *
 *  1. **Ageing is not movement class.** Ageing asks how long the stock still on
 *     hand has been sitting there; movement class asks how recently the ITEM
 *     last moved. An item can be fast-moving and hold a 200-day-old layer. They
 *     are shown as two panels with two headings and are never added together.
 *
 *  2. **A composition must compose.** A percentage split is only meaningful
 *     over non-negative parts of a positive whole. Negative buckets are pulled
 *     out and shown as exceptions rather than forced into a chart that adds to
 *     100% by ignoring them.
 */

import type { AgeBucketKey, MovementAnalysisSummary, MovementClass, StockAgeingSummary } from '../services/reportsApi'
import type { BridgeComponent, ValuationBridgeData } from './aggregatesApi'
import { formatCurrencyCompact, formatQtyCompact, percentOf } from './formatters'
import { drill } from './kpiNavigation'
import type { SeriesItem, Tone } from './model'

// ---------------------------------------------------------------------------
// The value bridge
// ---------------------------------------------------------------------------

export interface BridgeStepSpec {
  key: string
  label: string
  delta: number
  display: string
  sub?: string
}

/**
 * The bridge's steps, in the order a reader walks them.
 *
 * Transfers are included as a step even though they net to zero at company
 * scope. Dropping them would be tidier and would hide the one thing a reader
 * filtering by warehouse needs to see: at warehouse scope the two legs do NOT
 * cancel, and the residual is that warehouse's net internal movement. A step
 * that is zero here and non-zero there, with the same label, is exactly the
 * right behaviour.
 */
export function bridgeSteps(data: ValuationBridgeData): BridgeStepSpec[] {
  const c = data.components
  const step = (key: string, label: string, comp: BridgeComponent, sub?: string): BridgeStepSpec => ({
    key,
    label,
    delta: comp.net,
    display: formatCurrencyCompact(comp.net),
    sub: sub ?? `${comp.movements.toLocaleString('en-IN')} movements`,
  })

  const steps = [
    step('inward', 'Receipts', c.inward),
    step('outward', 'Issues', c.outward),
    step('adjustment', 'Adjustments', c.adjustment),
    step(
      'transfer',
      'Transfers',
      c.transfer,
      data.warehouse_id === null
        ? 'Net to zero at company scope'
        : 'Net internal movement for this warehouse',
    ),
  ]

  // "Other" only earns a bar when it is actually something. A permanent zero
  // step is noise on a chart that has to be read quickly.
  if (Math.abs(c.other.net) >= 0.01 || c.other.movements > 0) {
    steps.push(step('other', 'Other', c.other))
  }

  return steps
}

/** Whether the bridge's own steps reach its closing figure. */
export function bridgeCloses(data: ValuationBridgeData): { closes: boolean; residual: number } {
  const opening = typeof data.opening.value === 'number' ? data.opening.value : 0
  const closing = typeof data.closing.value === 'number' ? data.closing.value : 0
  const sum = bridgeSteps(data).reduce((acc, s) => acc + s.delta, 0)
  const residual = closing - (opening + sum)
  return { closes: Math.abs(residual) < 0.01, residual }
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

const AGE_ORDER: AgeBucketKey[] = ['0_30', '31_60', '61_90', '91_180', '180_plus']
const AGE_TONE: Record<AgeBucketKey, Tone> = {
  '0_30': 'success',
  '31_60': 'info',
  '61_90': 'warning',
  '91_180': 'danger',
  '180_plus': 'critical',
}

/** Which figure the ageing panel is split by. Value is the default. */
export type AgeingBasis = 'value' | 'quantity'

export interface AgeingView {
  /** Buckets with a non-negative value — the ones a share can be taken of. */
  buckets: SeriesItem[]
  /** Buckets whose value is below zero. Shown as exceptions, not as a share. */
  negatives: SeriesItem[]
  /** Total of the non-negative buckets — the base every share is taken of. */
  positiveTotal: number
  /** The report's own total, negatives included. */
  reportedTotal: number
  /** True when a share breakdown would be misleading and is not drawn. */
  compositionInvalid: boolean
  /** The basis this view was built on. */
  basis: AgeingBasis
  /** The centre figure for the donut, already formatted for `basis`. */
  totalDisplay: string
  /** What the centre figure is, in two words. */
  totalLabel: string
}

/**
 * Ageing buckets, with negatives separated out.
 *
 * A negative bucket is real — a cost layer consumed below zero, or migrated
 * history — and it cannot be a slice of a pie. Forcing it into one makes the
 * remaining slices add to more than the whole, so the shares here are taken
 * over the non-negative buckets only and the screen says so.
 */
export function ageingView(summary: StockAgeingSummary | null, asOf: string, basis: AgeingBasis = 'value'): AgeingView {
  const byValue = basis === 'value'
  const format = (n: number) => (byValue ? formatCurrencyCompact(n) : `${formatQtyCompact(n)} units`)

  if (!summary) {
    return {
      buckets: [],
      negatives: [],
      positiveTotal: 0,
      reportedTotal: 0,
      compositionInvalid: false,
      basis,
      totalDisplay: format(0),
      totalLabel: byValue ? 'Total value' : 'Total quantity',
    }
  }

  const rows = AGE_ORDER.map((key) => ({
    key,
    label: summary.bucket_labels?.[key] ?? key.replace(/_/g, '-'),
    bucket: summary.buckets[key] ?? { qty: 0, value: 0 },
  }))

  // The basis picks the measured figure; the "cannot be a slice" rule then
  // applies to THAT figure. A bucket can be positive in value and negative in
  // quantity, so which buckets are exceptions genuinely depends on the toggle.
  const measure = (b: { qty: number; value: number }) => (byValue ? b.value : b.qty)

  const positives = rows.filter((r) => measure(r.bucket) >= 0)
  const negatives = rows.filter((r) => measure(r.bucket) < 0)
  const positiveTotal = positives.reduce((acc, r) => acc + measure(r.bucket), 0)
  const max = Math.max(...positives.map((r) => measure(r.bucket)), 0)

  const toItem = (r: (typeof rows)[number], useShare: boolean): SeriesItem => {
    const n = measure(r.bucket)
    return {
      key: r.key,
      label: r.label,
      value: n,
      display: format(n),
      share: useShare ? percentOf(n, positiveTotal) : 0,
      scale: max > 0 ? Math.min(100, (Math.abs(n) / max) * 100) : 0,
      tone: AGE_TONE[r.key],
      // The secondary line always shows the OTHER measure, so switching the
      // toggle never hides a figure — it swaps which one is the headline.
      sub: byValue ? `${formatQtyCompact(r.bucket.qty)} units` : formatCurrencyCompact(r.bucket.value),
      to: drill.stockAgeing({ asOf }),
    }
  }

  return {
    buckets: positives.map((r) => toItem(r, true)),
    negatives: negatives.map((r) => toItem(r, false)),
    positiveTotal,
    reportedTotal: byValue ? summary.total_value : summary.total_qty,
    compositionInvalid: negatives.length > 0 || positiveTotal <= 0,
    basis,
    // The centre of the donut reports the base the slices were taken over, not
    // the report's own total: with a negative bucket excluded those differ, and
    // a centre figure the slices do not add to is the thing this file exists
    // to prevent.
    totalDisplay: format(positiveTotal),
    totalLabel: byValue ? 'Total value' : 'Total quantity',
  }
}

/** The bucket carrying stock with no receipt date — absent from the report. */
export function unknownAgeNote(summary: StockAgeingSummary | null): string | null {
  if (!summary) return null
  const bucketed = AGE_ORDER.reduce((acc, k) => acc + (summary.buckets[k]?.value ?? 0), 0)
  const gap = summary.total_value - bucketed
  if (Math.abs(gap) < 0.01) return null
  // Not folded into the oldest bucket: stock whose receipt date is unknown is
  // not stock that is known to be old.
  return `${formatCurrencyCompact(gap)} of stock is not in any age bucket — its cost layers carry no receipt date.`
}

// ---------------------------------------------------------------------------
// Movement classification
// ---------------------------------------------------------------------------

const MOVEMENT_ORDER: MovementClass[] = ['fast', 'slow', 'non_moving', 'dead']
const MOVEMENT_LABEL: Record<MovementClass, string> = {
  fast: 'Fast moving',
  slow: 'Slow moving',
  non_moving: 'Non-moving',
  dead: 'Dead stock',
}
const MOVEMENT_TONE: Record<MovementClass, Tone> = {
  fast: 'success',
  slow: 'info',
  non_moving: 'warning',
  dead: 'critical',
}

export interface MovementThresholdNote {
  label: string
  detail: string
}

/**
 * The thresholds behind the classification, in words.
 *
 * Shown on the card rather than hidden in a tooltip: "slow-moving: ₹5.84 L" is
 * a number someone might write off stock over, and they are entitled to know it
 * means "no issue in 60 days" before they do.
 */
export function movementThresholds(summary: MovementAnalysisSummary | null): MovementThresholdNote[] {
  if (!summary) return []
  const t = summary.thresholds
  return [
    { label: 'Fast moving', detail: `issued within ${t.fast_days} days` },
    { label: 'Slow moving', detail: `last issued ${t.fast_days}–${t.slow_days} days ago` },
    { label: 'Non-moving', detail: `last issued ${t.slow_days}–${t.dead_days} days ago` },
    { label: 'Dead stock', detail: `no issue for over ${t.dead_days} days` },
  ]
}

/**
 * Items per movement class, as a valid composition.
 *
 * Counts items rather than value, because the movement report's summary carries
 * item counts and on-hand quantities per class but not value per class. Showing
 * a currency figure here would mean deriving it from something else and
 * labelling it as though it came from this report.
 */
export function movementSeriesForValuation(summary: MovementAnalysisSummary | null): SeriesItem[] {
  if (!summary) return []
  const total = MOVEMENT_ORDER.reduce((acc, k) => acc + (summary.by_class[k]?.items ?? 0), 0)
  const max = MOVEMENT_ORDER.reduce((m, k) => Math.max(m, summary.by_class[k]?.items ?? 0), 0)
  return MOVEMENT_ORDER.map((k) => {
    const c = summary.by_class[k] ?? { items: 0, on_hand: 0, period_out_qty: 0 }
    return {
      key: k,
      label: MOVEMENT_LABEL[k],
      value: c.items,
      display: `${c.items.toLocaleString('en-IN')} items`,
      share: percentOf(c.items, total),
      scale: max > 0 ? Math.min(100, (c.items / max) * 100) : 0,
      tone: MOVEMENT_TONE[k],
      sub: `${formatQtyCompact(c.on_hand)} on hand`,
      to: drill.movementAnalysis({ from: summary.from, to: summary.to, cls: k }),
    }
  })
}
