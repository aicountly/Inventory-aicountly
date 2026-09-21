/**
 * The arithmetic behind the method comparison, with no React in it.
 *
 * Every stock value on this screen was computed by the valuation engine: four
 * calls to `GET /v1/valuation`, one per method, at one date and one scope.
 * Nothing here re-costs anything. What it does is the *comparison* — the
 * differences between four answers the server already gave, and the sentences
 * that describe them — which is presentation, belongs in the browser, and is
 * the only part of this screen worth unit-testing on its own.
 *
 * Pure: no fetching, no formatting of currency, no DOM.
 */

import type { ReportMethod, ValuationSnapshotSummary } from '../../../services/valuationApi'
import { METHOD_LABELS } from '../../../services/valuationApi'

/** The basis the books are actually kept on; every difference is measured from it. */
export const BASIS: ReportMethod = 'AS_PER_MASTER'

/**
 * The server's own precision. Its figures are rounded to four decimals before
 * they are sent, so `a - b` is only ever noise below that — and `85,12,940 -
 * 84,65,220` landing on 47719.999999996 would print as a difference that is
 * wrong in its last digit for no reason a reader could ever discover.
 */
const SCALE = 4

export function roundToScale(value: number): number {
  const factor = 10 ** SCALE
  return Math.round(value * factor) / factor
}

/** One method's answer, or the fact that it did not give one. */
export interface MethodSnapshot {
  method: ReportMethod
  summary: ValuationSnapshotSummary | null
}

/** One method's answer, measured against the basis. */
export interface MethodComparisonRow {
  method: ReportMethod
  label: string
  /** The basis row — "as per item master", the one the books are kept on. */
  baseline: boolean
  /** False when this method could not be valued; every figure below is then null. */
  answered: boolean
  items: number | null
  closingQty: number | null
  stockValue: number | null
  /**
   * `stockValue - basisValue`, null on the basis row itself and null whenever
   * either side is missing. A difference from a figure that never arrived is
   * unknown, not zero.
   */
  difference: number | null
  /** The method as a percentage of the basis: 100 is the basis exactly. */
  relativeValue: number | null
  /** `difference / basisValue * 100`. */
  variancePercent: number | null
}

export interface MethodComparison {
  rows: MethodComparisonRow[]
  /** The basis summary, or null when the basis itself could not be valued. */
  basis: ValuationSnapshotSummary | null
  /** Methods that answered, basis included. */
  answered: number
  /** Item count, closing quantity and value of the basis — the KPI figures. */
  itemsCompared: number | null
  closingQty: number | null
  basisValue: number | null
  /** Largest absolute difference from the basis across the other methods. */
  maxVariance: number | null
  /** The method that produced it. */
  maxVarianceRow: MethodComparisonRow | null
  /** Smallest absolute difference — the method the books sit closest to. */
  closestRow: MethodComparisonRow | null
  /** Highest method value minus lowest, across every method that answered. */
  spread: number | null
  /** True when there is stock to compare: methods answered and found items. */
  hasStock: boolean
}

/**
 * Turn four snapshots into four comparable rows.
 *
 * `order` decides the order on screen, so the caller's REPORT_METHODS ordering
 * (basis first) survives into the table and into the export.
 */
export function buildComparison(
  snapshots: readonly MethodSnapshot[],
  order: readonly ReportMethod[],
): MethodComparison {
  const byMethod = new Map(snapshots.map((s) => [s.method, s.summary]))
  const basis = byMethod.get(BASIS) ?? null
  // Zero is a real total — a company can genuinely hold stock that values at
  // nothing — but it is not something a percentage can be taken against, so the
  // relative figures fall away while the absolute ones stay.
  const basisValue = basis ? basis.total_value : null
  const canRelate = basisValue !== null && basisValue !== 0

  const rows: MethodComparisonRow[] = order.map((method) => {
    const summary = byMethod.get(method) ?? null
    const baseline = method === BASIS
    if (!summary) {
      return {
        method,
        label: METHOD_LABELS[method],
        baseline,
        answered: false,
        items: null,
        closingQty: null,
        stockValue: null,
        difference: null,
        relativeValue: null,
        variancePercent: null,
      }
    }
    const stockValue = summary.total_value
    const difference = baseline || basisValue === null ? null : roundToScale(stockValue - basisValue)
    return {
      method,
      label: METHOD_LABELS[method],
      baseline,
      answered: true,
      items: summary.item_count,
      closingQty: summary.total_qty,
      stockValue,
      difference,
      relativeValue: canRelate ? (stockValue / (basisValue as number)) * 100 : null,
      variancePercent:
        canRelate && difference !== null ? (difference / (basisValue as number)) * 100 : null,
    }
  })

  const comparable = rows.filter((r) => !r.baseline && r.difference !== null)
  // Ranking is on the absolute difference, not the percentage: the basis is the
  // same denominator for every row, so the two orders are identical, and the
  // money is the figure that survives a zero-value basis.
  const closestRow = pickBy(comparable, (a, b) => Math.abs(a.difference!) < Math.abs(b.difference!))
  const maxVarianceRow = pickBy(comparable, (a, b) => Math.abs(a.difference!) > Math.abs(b.difference!))

  const values = rows.filter((r) => r.answered).map((r) => r.stockValue as number)
  const answered = rows.filter((r) => r.answered).length

  return {
    rows,
    basis,
    answered,
    itemsCompared: basis ? basis.item_count : null,
    closingQty: basis ? basis.total_qty : null,
    basisValue,
    maxVariance: maxVarianceRow ? Math.abs(maxVarianceRow.difference as number) : null,
    maxVarianceRow,
    closestRow,
    spread: values.length > 1 ? roundToScale(Math.max(...values) - Math.min(...values)) : null,
    // "No stock" is the basis answering with nothing in it, not the request
    // failing — a screen that cannot reach the service has an error to show,
    // not an empty shelf.
    hasStock: answered > 0 && rows.some((r) => r.answered && (r.items ?? 0) > 0),
  }
}

/** First element under a strict "is better than" comparison; null when empty. */
function pickBy<T>(items: readonly T[], better: (candidate: T, current: T) => boolean): T | null {
  return items.reduce<T | null>(
    (best, item) => (best === null || better(item, best) ? item : best),
    null,
  )
}

// ---- the sentences ------------------------------------------------------------------------------

/**
 * How the numbers are put into words, injected rather than imported.
 *
 * The model must not know that money is written with Indian digit grouping, or
 * that a percentage shows two decimals — those are the caller's formatters, and
 * passing them in is what keeps this file testable with `String(n)`.
 */
export interface ComparisonWords {
  money: (value: number) => string
  percent: (value: number) => string
}

/** "₹5,810 lower" / "₹47,720 higher" / "the same". */
function movement(row: MethodComparisonRow, words: ComparisonWords): string {
  const difference = row.difference ?? 0
  if (difference === 0) return 'exactly the same value'
  return `${words.money(Math.abs(difference))} ${difference > 0 ? 'higher' : 'lower'}`
}

/**
 * The insight strip's sentence — the two facts a reader wants before they read
 * a single row: which method the books sit closest to, and which sits furthest.
 *
 * Derived from the comparison, never from the method names: whichever method
 * happens to be closest today is the one named, and a screen where FIFO is the
 * outlier reads the same as one where it is not.
 *
 * Null when there is nothing to say — no basis, or no other method answered.
 */
export function insightSentence(c: MethodComparison, words: ComparisonWords): string | null {
  const { closestRow, maxVarianceRow } = c
  if (!closestRow || closestRow.variancePercent === null) return null

  const closest = `${closestRow.label} is closest to your item master value (${movement(closestRow, words)}, ${words.percent(Math.abs(closestRow.variancePercent))} variance).`
  if (!maxVarianceRow || maxVarianceRow.method === closestRow.method || maxVarianceRow.variancePercent === null) {
    return closest
  }
  return `${closest} ${maxVarianceRow.label} differs most (${movement(maxVarianceRow, words)}, ${words.percent(Math.abs(maxVarianceRow.variancePercent))}).`
}

export interface Takeaway {
  key: string
  text: string
}

/**
 * The takeaway bullets.
 *
 * Every one of them is a restatement of a figure on the screen. None of them
 * recommends a valuation method: which method a company values its stock on is
 * a policy decision with tax and audit consequences, and a screen that has seen
 * one date's numbers is in no position to make it. The closest the last bullet
 * comes is telling the reader where to look if the gap surprises them.
 */
export function takeaways(c: MethodComparison, words: ComparisonWords): Takeaway[] {
  const out: Takeaway[] = []
  const { closestRow, maxVarianceRow, spread, basisValue } = c

  if (closestRow && closestRow.variancePercent !== null) {
    out.push({
      key: 'closest',
      text: `${closestRow.label} is closest to the item master basis, at ${words.percent(Math.abs(closestRow.variancePercent))} variance.`,
    })
  }
  if (maxVarianceRow && maxVarianceRow.difference !== null && maxVarianceRow.variancePercent !== null) {
    out.push({
      key: 'widest',
      text: `${maxVarianceRow.label} differs most, at ${movement(maxVarianceRow, words)} (${words.percent(Math.abs(maxVarianceRow.variancePercent))}).`,
    })
  }
  if (spread !== null && basisValue) {
    out.push({
      key: 'spread',
      text: `The methods span ${words.money(spread)} between them — ${words.percent(Math.abs((spread / basisValue) * 100))} of the basis value.`,
    })
  }
  out.push({
    key: 'next',
    text:
      maxVarianceRow && maxVarianceRow.variancePercent !== null && Math.abs(maxVarianceRow.variancePercent) >= 1
        ? 'Open a method to see which items account for its difference, if a gap this size is not what you expected.'
        : 'Open a method to see which items account for its difference.',
  })
  return out
}

// ---- the relative-value bar ---------------------------------------------------------------------

export interface RelativeBar {
  /** Percentage points either side of the basis, 0 on the basis row. */
  deviation: number
  /** 0–50: how far the fill runs from the centre, as a percentage of the track. */
  width: number
  direction: 'above' | 'below' | 'level'
}

/**
 * Where a method's bar sits against the basis.
 *
 * Anchored at the centre and scaled to the widest deviation on screen, because
 * these figures cluster: four methods within a percent of each other drawn as
 * bars proportional to their *value* are four identical bars, which is a chart
 * that cannot be read. Normalising against the widest one makes the comparison
 * between the methods legible, which is the only comparison this column is for
 * — the absolute figures are in the three columns to its left.
 *
 * `spread` is the largest absolute deviation across the rows; a floor keeps a
 * table where every method matches the basis from dividing by zero.
 */
export function relativeBar(row: MethodComparisonRow, spread: number): RelativeBar {
  const deviation = row.relativeValue === null ? 0 : row.relativeValue - 100
  const scale = Math.max(spread, 0.01)
  const width = Math.min(50, (Math.abs(deviation) / scale) * 50)
  return {
    deviation,
    width,
    // A hair either side of the basis is "level": a 0.001% rounding tail drawn
    // as a red bar would read as a finding rather than as a rounding tail.
    direction: Math.abs(deviation) < 0.005 ? 'level' : deviation > 0 ? 'above' : 'below',
  }
}

/** The widest deviation from the basis on screen, in percentage points. */
export function deviationSpread(rows: readonly MethodComparisonRow[]): number {
  return rows.reduce(
    (max, r) => (r.relativeValue === null ? max : Math.max(max, Math.abs(r.relativeValue - 100))),
    0,
  )
}

// ---- the comparative period ---------------------------------------------------------------------

/**
 * The date the screen opens on: today, held inside the open financial year.
 *
 * "As at" is a position in a year the reader has already chosen in the top bar,
 * so opening a 2025-26 comparison at today's date would value stock at a date
 * outside the year on screen — a question nobody asked, and one whose answer
 * looks like a bug. Clamped to the year's end (and to its start, for a year
 * that has not opened yet), the first thing the reader sees is the closing
 * position of the year they selected.
 *
 * `today` is passed in rather than read: the app has no server-clock endpoint,
 * so it comes from `todayIso()` at the call site, and this stays testable.
 */
export function defaultAsOfDate(today: string, fy: { from: string; to: string }): string {
  if (fy.to && today > fy.to) return fy.to
  if (fy.from && today < fy.from) return fy.from
  return today
}

/**
 * The same day one month earlier — what the KPI cards compare against.
 *
 * The cards show a change, so something has to be the previous reading, and a
 * month back on the same date is the one period an inventory reader can name
 * without being told. The screen fetches that date from the same endpoint at
 * the same scope, so the comparative is a figure the valuation engine
 * computed, not one this file derived. Every card says the date out loud
 * rather than "vs last period", because a delta whose period the reader has to
 * guess at is a delta they cannot check.
 *
 * Day-clamped: 31 March back a month is the last day of February, not 3 March.
 */
export function previousPeriodDate(asOf: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prevYear}-${pad(prevMonth)}-${pad(Math.min(day, lastDay))}`
}
