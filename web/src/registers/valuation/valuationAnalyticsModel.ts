/**
 * Everything the valuation analytics band *computes*, as pure functions.
 *
 * No React and no fetching, so it is all unit-testable in the existing node
 * vitest environment — which matters more here than anywhere else in the app,
 * because these are the figures a reader will compare against the register
 * printed beside them.
 *
 * The rule the whole module is built around: **the backend is the valuation
 * engine and this file is not.** Nothing here costs stock, resolves a method,
 * or fills a gap in a series. Every rupee figure that reaches the screen came
 * out of `GET /v1/valuation` under the same filters the register was read
 * under; what this file does is decide which dates to ask about, turn answers
 * into chart geometry, and take percentages of totals the server computed.
 *
 * Two things it deliberately refuses to do:
 *
 *  1. **Interpolate.** A trend point is a date the server was asked about. A
 *     request that fails leaves a gap in the series rather than a straight line
 *     drawn between its neighbours.
 *  2. **Force a composition.** A share is only meaningful over non-negative
 *     parts of a positive whole, and stock value can be negative (a layer
 *     consumed below zero, migrated history). Negative items are pulled out and
 *     reported as exceptions instead of being squeezed into a donut that adds
 *     to 100% by ignoring them.
 */

import type { SeriesItem, Tone } from '../../dashboard/model'
import { formatCurrencyCompact, formatQtyCompact, percentOf } from '../../dashboard/formatters'

// ---------------------------------------------------------------------------
// Period selection
// ---------------------------------------------------------------------------

export type TrendPeriod = '3' | '6' | '12' | 'fy'

export const TREND_PERIODS: { value: TrendPeriod; label: string }[] = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: 'fy', label: 'Financial year' },
]

export const DEFAULT_TREND_PERIOD: TrendPeriod = '6'

/**
 * Hard ceiling on the number of dates a trend may ask about.
 *
 * Each point is a separate valuation replay on the server, so the chart's
 * resolution is a cost someone pays. Twelve is a year of month-ends, which is
 * the longest span the control offers.
 */
export const MAX_TREND_POINTS = 12

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO date → {y, m, d}, with no Date object and so no timezone to get wrong. */
function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Last calendar day of a month, leap years included. */
export function monthEnd(year: number, month: number): string {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = month === 2 && leap ? 29 : lengths[month - 1]
  return `${year}-${pad(month)}-${pad(days)}`
}

/** "Sep 26" — the x-axis label for a month-end point. */
export function monthLabel(iso: string): string {
  const parts = parseIso(iso)
  if (!parts) return iso
  return `${MONTHS[parts.m - 1]} ${pad(parts.y % 100)}`
}

/**
 * The dates a trend asks the server about, oldest first.
 *
 * Month-ends up to the as-at date, with the as-at date itself as the final
 * point — the register's own figure has to be the one the line ends on, or the
 * chart and the total above it would disagree on the same screen.
 *
 * Clamped to the financial year because the snapshot endpoint is FY-scoped
 * (`ValuationController::snapshot` passes `fy_id` straight through): a date
 * before the year opened would be answered against this year's movements and
 * would not mean what its label says.
 */
export function trendDates(
  asOf: string,
  period: TrendPeriod,
  fy: { from: string; to: string },
): string[] {
  const end = parseIso(asOf)
  if (!end) return []

  const months = period === 'fy' ? MAX_TREND_POINTS : Number(period)
  const dates: string[] = []

  if (period === 'fy') {
    const start = parseIso(fy.from)
    if (start) {
      let y = start.y
      let m = start.m
      // Every month-end from the year's opening month up to (not including)
      // the as-at month; the as-at date is appended below.
      while ((y < end.y || (y === end.y && m < end.m)) && dates.length < MAX_TREND_POINTS - 1) {
        dates.push(monthEnd(y, m))
        m += 1
        if (m > 12) {
          m = 1
          y += 1
        }
      }
    }
  } else {
    for (let i = months - 1; i >= 1; i -= 1) {
      let m = end.m - i
      let y = end.y
      while (m < 1) {
        m += 12
        y -= 1
      }
      dates.push(monthEnd(y, m))
    }
  }

  dates.push(asOf)

  // A month-end after the as-at date is in the future of the question asked,
  // and one before the year opened is outside what the endpoint can answer.
  const lower = fy.from
  const upper = asOf
  const kept = dates.filter((d) => d >= lower && d <= upper)
  return [...new Set(kept)].sort().slice(-MAX_TREND_POINTS)
}

// ---------------------------------------------------------------------------
// The trend series
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** The date the server was asked about. */
  date: string
  label: string
  /** Total stock value the server reported at that date. */
  value: number
  /** Total quantity at that date. */
  qty: number
}

/**
 * The movement between the last two points a trend actually has.
 *
 * `null` whenever there is nothing honest to say: fewer than two points, or a
 * prior figure of zero, which has no percentage change from it. A KPI card
 * hides its delta chip in that case rather than showing "+0%" or "∞".
 */
export function trendDelta(points: readonly TrendPoint[]): { current: TrendPoint; previous: TrendPoint } | null {
  if (points.length < 2) return null
  const current = points[points.length - 1]
  const previous = points[points.length - 2]
  return { current, previous }
}

// ---------------------------------------------------------------------------
// Composition: value by item
// ---------------------------------------------------------------------------

/** One item's contribution, as the register reported it. */
export interface ValuedRow {
  key: string
  label: string
  value: number
  qty?: number
  to?: string
}

export interface CompositionView {
  /** Slices to draw, largest first, with any remainder folded into one row. */
  slices: SeriesItem[]
  /** The whole the shares are taken of — the server's own total. */
  total: number
  /** Items whose value is below zero: real, but not a slice of anything. */
  negatives: number
  /** True when a share breakdown would mislead and must not be drawn. */
  invalid: boolean
}

const SLICE_TONES: Tone[] = ['primary', 'success', 'info', 'teal', 'violet', 'warning', 'neutral']

/**
 * Top contributors plus a single "Others" row, over the server's total.
 *
 * The remainder is `total - sum(shown)`, not the sum of rows this screen
 * happens to be holding: the donut is fed the top few rows of a set that may
 * run to thousands, and adding up the page would make "Others" the size of one
 * page's tail rather than of the rest of the company's stock.
 */
export function composition(
  rows: readonly ValuedRow[],
  total: number,
  options: { maxSlices?: number; othersLabel?: string; formatValue?: (n: number) => string } = {},
): CompositionView {
  const maxSlices = options.maxSlices ?? 6
  const format = options.formatValue ?? formatCurrencyCompact
  const negatives = rows.filter((r) => r.value < 0).length
  const positives = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value)

  if (total <= 0 || positives.length === 0) {
    return { slices: [], total, negatives, invalid: true }
  }

  const head = positives.slice(0, maxSlices)
  const shown = head.reduce((acc, r) => acc + r.value, 0)
  const remainder = total - shown
  const max = head.length ? head[0].value : 0

  const slices: SeriesItem[] = head.map((r, i) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    display: format(r.value),
    share: percentOf(r.value, total),
    scale: max > 0 ? Math.min(100, (r.value / max) * 100) : 0,
    tone: SLICE_TONES[i % SLICE_TONES.length],
    to: r.to,
    sub: r.qty === undefined ? undefined : `${formatQtyCompact(r.qty)} units`,
  }))

  // Rounding in the server's own totals can leave a few paise behind; a slice
  // worth less than a rupee is noise, not a category.
  if (remainder >= 1) {
    slices.push({
      key: '__others__',
      label: options.othersLabel ?? 'Others',
      value: remainder,
      display: format(remainder),
      share: percentOf(remainder, total),
      scale: max > 0 ? Math.min(100, (remainder / max) * 100) : 0,
      tone: 'neutral',
    })
  }

  return { slices, total, negatives, invalid: false }
}

/** The sentence shown under a composition that had to leave something out. */
export function negativesNote(view: CompositionView, noun = 'item'): string | null {
  if (view.negatives === 0) return null
  const plural = view.negatives === 1 ? noun : `${noun}s`
  return `${view.negatives} ${plural} with a negative stock value ${
    view.negatives === 1 ? 'is' : 'are'
  } not in this split — a share can only be taken of a positive whole. The total above includes ${
    view.negatives === 1 ? 'it' : 'them'
  }.`
}

// ---------------------------------------------------------------------------
// Composition: value by warehouse
// ---------------------------------------------------------------------------

export interface WarehouseValue {
  warehouseId: number
  name: string
  value: number
  qty: number
}

export type WarehouseMeasure = 'value' | 'qty'

/**
 * Warehouse bars, with whatever the warehouses do not account for named.
 *
 * Stock can sit against no warehouse at all — opening rows migrated without
 * one, movements posted before a warehouse was mandatory — and such stock is in
 * the company total but in none of the per-warehouse answers. Showing the bars
 * alone would present a set that quietly adds up to less than the figure
 * printed above it, so the difference is drawn as its own row.
 */
export function warehouseComposition(
  warehouses: readonly WarehouseValue[],
  companyTotal: { value: number; qty: number },
  measure: WarehouseMeasure,
): CompositionView {
  const pick = (w: { value: number; qty: number }) => (measure === 'value' ? w.value : w.qty)
  const format = measure === 'value' ? formatCurrencyCompact : formatQtyCompact

  const rows: ValuedRow[] = warehouses.map((w) => ({
    key: String(w.warehouseId),
    label: w.name,
    value: pick(w),
    qty: measure === 'value' ? w.qty : undefined,
  }))

  // `composition` folds `total - sum(shown)` into a final row, which is exactly
  // the stock the per-warehouse answers did not account for.
  return composition(rows, pick(companyTotal), {
    maxSlices: 8,
    othersLabel: 'Unassigned to a warehouse',
    formatValue: format,
  })
}
