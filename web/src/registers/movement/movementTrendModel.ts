/**
 * The movement trend's arithmetic, kept out of the chart that draws it.
 *
 * The endpoint buckets the series by day, week or month according to the span asked for,
 * so a financial year arrives as ~52 columns rather than 365 two pixels wide. The reader
 * can widen those buckets further, and widening is exact: a week is the sum of its days
 * and a month the sum of its weeks, so rolling up adds figures the server computed rather
 * than estimating anything. Narrowing is not offered at all — the finer numbers were never
 * sent, and a chart cannot invent them.
 */

import type { MovementTrendBucket, MovementTrendPoint, MovementTrendSeries } from '../../services/stockViewsApi'

// Re-exported so the chart takes its whole vocabulary from the model it renders, rather
// than reaching past it into the API module for one type.
export type { MovementTrendBucket, MovementTrendPoint }

export const BUCKET_ORDER: readonly MovementTrendBucket[] = ['day', 'week', 'month']

export const BUCKET_LABELS: Record<MovementTrendBucket, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

/** What one column covers, for the caption under the chart. */
export const BUCKET_NOUN: Record<MovementTrendBucket, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
}

/** The measure the columns are drawn from. */
export type TrendMeasure = 'qty' | 'value'

export const MEASURE_LABELS: Record<TrendMeasure, string> = {
  qty: 'Quantity',
  value: 'Value',
}

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The first day of the bucket a date falls in.
 *
 * Weeks start on Monday, which is what PostgreSQL's `date_trunc('week', …)` does — a
 * client-side roll-up that started them on Sunday would shift every column by a day
 * against the server's own week buckets.
 */
export function startOfBucket(iso: string, bucket: MovementTrendBucket): string {
  const d = parseIso(iso)
  if (!d) return iso
  if (bucket === 'day') return isoOf(d)
  if (bucket === 'month') return isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
  const weekday = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - weekday)
  return isoOf(d)
}

/** Granularities a series can be widened to, coarsest first excluded. */
export function availableBuckets(from: MovementTrendBucket): MovementTrendBucket[] {
  return BUCKET_ORDER.slice(BUCKET_ORDER.indexOf(from))
}

/**
 * The series re-bucketed to `to`, which must be the same width or coarser.
 *
 * Asking for something finer returns the series unchanged: the data to draw it does not
 * exist on the client, and stretching what does exist would put numbers on the screen
 * nobody computed.
 */
export function rollUp(
  points: readonly MovementTrendPoint[],
  from: MovementTrendBucket,
  to: MovementTrendBucket,
): MovementTrendPoint[] {
  if (to === from || BUCKET_ORDER.indexOf(to) < BUCKET_ORDER.indexOf(from)) return [...points]
  const merged = new Map<string, MovementTrendPoint>()
  for (const point of points) {
    const key = startOfBucket(point.bucket, to)
    const at = merged.get(key)
    if (at) {
      at.movements += point.movements
      at.in_qty += point.in_qty
      at.out_qty += point.out_qty
      at.in_value += point.in_value
      at.out_value += point.out_value
    } else {
      merged.set(key, { ...point, bucket: key })
    }
  }
  return [...merged.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The axis label for one column.
 *
 * Deliberately short — an axis of twelve `01 Apr 2026`s is unreadable at any width — and
 * deliberately unambiguous about what it covers: a week column reads `14 Sep+`, not a bare
 * date that a reader would take for a single day.
 */
export function bucketLabel(iso: string, bucket: MovementTrendBucket): string {
  const d = parseIso(iso)
  if (!d) return iso
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = MONTHS[d.getUTCMonth()]
  if (bucket === 'month') return `${month} ${String(d.getUTCFullYear()).slice(2)}`
  if (bucket === 'week') return `${day} ${month}+`
  return `${day} ${month}`
}

/** The whole column, spelled out — the tooltip and the accessible table use it. */
export function bucketTitle(iso: string, bucket: MovementTrendBucket): string {
  const d = parseIso(iso)
  if (!d) return iso
  const day = String(d.getUTCDate()).padStart(2, '0')
  const label = `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  if (bucket === 'day') return label
  if (bucket === 'week') return `Week of ${label}`
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export interface TrendView {
  bucket: MovementTrendBucket
  points: MovementTrendPoint[]
  categories: string[]
  titles: string[]
  inward: number[]
  outward: number[]
  /** True when every column is zero — a period with movements but none of this measure. */
  empty: boolean
}

/** The series a chart draws, for one granularity and one measure. */
export function trendView(
  series: MovementTrendSeries | null,
  bucket: MovementTrendBucket,
  measure: TrendMeasure,
): TrendView {
  const source = series?.points ?? []
  const points = series ? rollUp(source, series.bucket, bucket) : []
  const inward = points.map((p) => (measure === 'qty' ? p.in_qty : p.in_value))
  const outward = points.map((p) => (measure === 'qty' ? p.out_qty : p.out_value))
  return {
    bucket,
    points,
    categories: points.map((p) => bucketLabel(p.bucket, bucket)),
    titles: points.map((p) => bucketTitle(p.bucket, bucket)),
    inward,
    outward,
    empty: points.length === 0 || [...inward, ...outward].every((v) => v === 0),
  }
}
