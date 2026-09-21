/**
 * The presentation model behind the Stock Ageing register.
 *
 * A deliberate split, and the rule the whole screen follows:
 *
 *  - **The server decides what is true.** Which bucket a cost layer falls in, what an
 *    item's health is, and what the stock scores out of 100 are all
 *    `InventoryReportService`'s answers, computed once from the cost layers and sent
 *    down with the rows. Nothing here recomputes them, so the badge on screen, the
 *    word in the CSV and the word on the printed sheet cannot drift apart.
 *  - **This file decides how it reads.** Labels, tones, shares of a total, the bars'
 *    scale, and the sentences under the charts — display arithmetic over figures the
 *    register already holds. It fetches nothing and it invents nothing.
 *
 * `HEALTH_PENALTY` and `HEALTH_BANDS` are the one exception: they are restated here so
 * the "How is this calculated?" panel can show the reader the actual weights rather
 * than a paraphrase. `ageingModel.test.ts` reads them back out of the PHP service and
 * fails if the two ever disagree.
 */

import type { LucideIcon } from 'lucide-react'
import { Boxes, CircleAlert, Clock, Coins, Layers, PackageCheck, TriangleAlert, Warehouse } from 'lucide-react'
import type { Tone } from '../../dashboard/model'
import type { BadgeTone } from '../../ui/Badge'
import type { IconTone } from '../../ui/IconTile'
import { formatCurrencyCompact } from '../../dashboard/formatters'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import { AGE_BUCKET_LABELS, AGE_BUCKET_ORDER } from '../../reports/helpers'
import type {
  AgeBucketKey,
  AgeingExposure,
  StockAgeingSummary,
  StockHealthBand,
  StockHealthStatus,
} from '../../services/reportsApi'

/* ------------------------------------------------------------------ buckets */

/**
 * Bucket → tone. Green for fresh through red for obsolete, taken from the dashboard's
 * tone table so a bar, a dot and a KPI tile mean the same thing by colour across the
 * product — and so dark mode remaps all three together.
 *
 * Colour is never the only signal: every bucket is labelled wherever it is drawn, and
 * the charts ship a text equivalent.
 */
export const AGE_BUCKET_TONES: Record<AgeBucketKey, Tone> = {
  '0_30': 'success',
  '31_60': 'info',
  '61_90': 'warning',
  '91_180': 'danger',
  '180_plus': 'critical',
}

/** The same five, as hex — an SVG `stroke` cannot read a Tailwind class. */
export const AGE_BUCKET_HEX: Record<AgeBucketKey, string> = {
  '0_30': '#10b981',
  '31_60': '#0ea5e9',
  '61_90': '#f59e0b',
  '91_180': '#f97316',
  '180_plus': '#f43f5e',
}

/**
 * Text tint for the bucket's figure in a table cell.
 *
 * A tint on the number, never a wash over the cell: five tinted columns across a row
 * would make the table harder to read, not easier, and the band is named in the header
 * above every one of them.
 */
export const AGE_BUCKET_TEXT: Record<AgeBucketKey, string> = {
  '0_30': 'text-emerald-600',
  '31_60': 'text-sky-600',
  '61_90': 'text-amber-600',
  '91_180': 'text-orange-600',
  '180_plus': 'text-rose-600',
}

/** Short captions for the axis, where "0-30 days" five times over is noise. */
export const AGE_BUCKET_SHORT: Record<AgeBucketKey, string> = {
  '0_30': '0-30',
  '31_60': '31-60',
  '61_90': '61-90',
  '91_180': '91-180',
  '180_plus': '180+',
}

/** What the reader is looking at in the distribution chart. */
export type AgeingMetric = 'value' | 'qty' | 'items'

export const AGEING_METRIC_LABELS: Record<AgeingMetric, string> = {
  value: 'Value',
  qty: 'Quantity',
  items: 'Items',
}

/* ------------------------------------------------------------------- health */

/**
 * The score's weights, mirroring `InventoryReportService::HEALTH_PENALTY`.
 *
 * Shown to the reader verbatim in the explanation panel. 31-60 days is absent on
 * purpose: stock inside two months is not ageing, it is stock.
 */
export const HEALTH_PENALTY: Partial<Record<AgeBucketKey, number>> = {
  '61_90': 8,
  '91_180': 25,
  '180_plus': 60,
}

/** Score floors, mirroring `InventoryReportService::HEALTH_BANDS`. */
export const HEALTH_BANDS: Record<Exclude<StockHealthBand, 'critical'>, number> = {
  excellent: 90,
  healthy: 75,
  watch: 60,
  at_risk: 40,
}

export interface HealthBandMeta {
  label: string
  /** The ring and the eyebrow. */
  tone: IconTone
  badge: BadgeTone
  /** Hex for the SVG ring, which cannot read a class. */
  hex: string
  /** One line saying what the band means, never what to do about it. */
  blurb: string
}

export const HEALTH_BAND_META: Record<StockHealthBand, HealthBandMeta> = {
  excellent: {
    label: 'Excellent',
    tone: 'success',
    badge: 'success',
    hex: '#10b981',
    blurb: 'Almost all stock value sits inside 60 days.',
  },
  healthy: {
    label: 'Healthy',
    tone: 'success',
    badge: 'success',
    hex: '#10b981',
    blurb: 'Most stock value remains within acceptable ageing bands.',
  },
  watch: {
    label: 'Watch',
    tone: 'warning',
    badge: 'warning',
    hex: '#f59e0b',
    blurb: 'A meaningful share of value has moved past 90 days.',
  },
  at_risk: {
    label: 'At risk',
    tone: 'danger',
    badge: 'danger',
    hex: '#f97316',
    blurb: 'Capital is building up in slow-moving and obsolete stock.',
  },
  critical: {
    label: 'Critical',
    tone: 'rose',
    badge: 'danger',
    hex: '#f43f5e',
    blurb: 'Most of the stock value is older than 90 days.',
  },
}

export interface HealthStatusMeta {
  label: string
  badge: BadgeTone
  /** The rule, in the words the column tooltip uses. */
  rule: string
}

/** Worst-first, the order `InventoryReportService::HEALTH_STATUSES` declares. */
export const HEALTH_STATUS_ORDER: StockHealthStatus[] = ['obsolete', 'slow', 'watch', 'healthy', 'fresh']

export const HEALTH_STATUS_META: Record<StockHealthStatus, HealthStatusMeta> = {
  fresh: { label: 'Fresh', badge: 'success', rule: 'At least 60% of the value is 30 days old or less.' },
  healthy: { label: 'Healthy', badge: 'teal', rule: 'At least 60% of the value is 60 days old or less.' },
  watch: { label: 'Watch', badge: 'warning', rule: 'A fifth or more of the value sits in 61-90 days.' },
  slow: { label: 'Slow moving', badge: 'danger', rule: 'A fifth or more of the value sits in 91-180 days.' },
  obsolete: { label: 'Obsolete', badge: 'danger', rule: 'A fifth or more of the value is older than 180 days.' },
}

/* ---------------------------------------------------------------- breakdown */

export interface AgeingBucketView {
  key: AgeBucketKey
  label: string
  short: string
  tone: Tone
  hex: string
  qty: number
  value: number
  items: number
  /** The figure the chosen metric is drawing. */
  metric: number
  /** Share of the metric's total, 0-100. */
  share: number
  /** Share of the largest bucket, 0-100 — the bar's height. */
  scale: number
  /** Everything the tooltip says, on one line. */
  tooltip: string
}

function pickMetric(bucket: { qty: number; value: number; items: number }, metric: AgeingMetric): number {
  if (metric === 'qty') return bucket.qty
  if (metric === 'items') return bucket.items
  return bucket.value
}

/** Safe percentage: no total means no share, never NaN or Infinity in the DOM. */
export function share(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return 0
  return (part / total) * 100
}

/** `14.9%` — one decimal, which is as precise as a share of stock value ever is. */
export function formatShare(value: number, empty = '—'): string {
  if (!Number.isFinite(value)) return empty
  return `${value.toFixed(1)}%`
}

/** `67 days`, `1 day`, `—`. */
export function formatAgeDays(days: number | null | undefined, empty = '—'): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return empty
  const n = Math.round(days)
  return `${formatInt(n)} ${n === 1 ? 'day' : 'days'}`
}

/**
 * The five buckets, in ageing order, ready to draw.
 *
 * Order is fixed on purpose: a donut that sorted its slices by size would put a
 * different colour against "180+ days" from one filter to the next, and the whole
 * point of the palette is that red always means old.
 */
export function ageingBreakdown(summary: StockAgeingSummary, metric: AgeingMetric = 'value'): AgeingBucketView[] {
  const buckets = AGE_BUCKET_ORDER.map((key) => {
    const b = summary.buckets?.[key]
    return {
      key,
      qty: Number(b?.qty ?? 0),
      value: Number(b?.value ?? 0),
      items: Number(b?.items ?? 0),
    }
  })

  const total = buckets.reduce((acc, b) => acc + Math.abs(pickMetric(b, metric)), 0)
  const max = buckets.reduce((acc, b) => Math.max(acc, Math.abs(pickMetric(b, metric))), 0)

  return buckets.map((b) => {
    const value = pickMetric(b, metric)
    const label = summary.bucket_labels?.[b.key] ?? AGE_BUCKET_LABELS[b.key]
    const pct = share(Math.abs(value), total)
    return {
      key: b.key,
      label,
      short: AGE_BUCKET_SHORT[b.key],
      tone: AGE_BUCKET_TONES[b.key],
      hex: AGE_BUCKET_HEX[b.key],
      qty: b.qty,
      value: b.value,
      items: b.items,
      metric: value,
      share: pct,
      scale: max > 0 ? (Math.abs(value) / max) * 100 : 0,
      tooltip: `${label} · ${formatMoney(b.value)} · ${formatQty(b.qty)} qty · ${formatInt(b.items)} ${
        b.items === 1 ? 'item' : 'items'
      } · ${formatShare(pct)} of ${AGEING_METRIC_LABELS[metric].toLowerCase()}`,
    }
  })
}

/* ------------------------------------------------------------ capital at risk */

export interface CapitalAtRisk {
  over90: number
  over180: number
  over90Share: number
  over180Share: number
  freshShare: number
  watchShare: number
  slowShare: number
  obsoleteShare: number
  totalValue: number
}

/**
 * What the health score is made of, as shares of total stock value.
 *
 * "Fresh" is everything inside 60 days — the two bands the score does not penalise —
 * so the three figures the health panel prints are the score's own working, not a
 * second definition of freshness.
 */
export function capitalAtRisk(summary: StockAgeingSummary): CapitalAtRisk {
  const total = Number(summary.total_value ?? 0)
  const bucket = (key: AgeBucketKey) => Number(summary.buckets?.[key]?.value ?? 0)
  const over90 = Number(summary.value_over_90 ?? bucket('91_180') + bucket('180_plus'))
  const over180 = Number(summary.value_over_180 ?? bucket('180_plus'))
  return {
    over90,
    over180,
    over90Share: share(over90, total),
    over180Share: share(over180, total),
    freshShare: share(bucket('0_30') + bucket('31_60'), total),
    watchShare: share(bucket('61_90'), total),
    slowShare: share(bucket('91_180'), total),
    obsoleteShare: share(bucket('180_plus'), total),
    totalValue: total,
  }
}

/* ------------------------------------------------------------------ insights */

export interface AgeingInsight {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  tone: IconTone
}

/** The label an exposure row carries, whichever dimension it came from. */
export function exposureLabel(row: AgeingExposure): string {
  return row.warehouse_name ?? row.grp_name ?? 'Unassigned'
}

/**
 * Deterministic observations — every one of them arithmetic over the summary the
 * register already has.
 *
 * Nothing is fetched, nothing is predicted and nothing is phrased as an opinion. A
 * sentence is omitted rather than hedged when the data behind it is missing: the
 * warehouse and item-group lines disappear entirely while a bucket or health filter
 * narrows the rows, because the server withholds those breakdowns rather than
 * describe a wider set than the one on screen.
 */
export function ageingInsights(summary: StockAgeingSummary): AgeingInsight[] {
  const risk = capitalAtRisk(summary)
  const out: AgeingInsight[] = []

  out.push({
    key: 'over90',
    label: `${formatCurrencyCompact(risk.over90)} older than 90 days`,
    hint: `${formatShare(risk.over90Share)} of ${formatCurrencyCompact(risk.totalValue)} stock value`,
    icon: Coins,
    tone: risk.over90Share >= 25 ? 'danger' : risk.over90Share >= 10 ? 'warning' : 'success',
  })

  out.push({
    key: 'age',
    label: `${formatAgeDays(summary.weighted_age_days)} weighted average age`,
    hint:
      summary.oldest_days === null
        ? 'Across the stock on hand'
        : `Oldest layer ${formatAgeDays(summary.oldest_days)}`,
    icon: Clock,
    tone: 'info',
  })

  const worstWarehouse = summary.warehouses?.[0]
  if (worstWarehouse && worstWarehouse.value_over_90 > 0) {
    out.push({
      key: 'warehouse',
      label: `${exposureLabel(worstWarehouse)} holds the most ageing stock`,
      hint: `${formatCurrencyCompact(worstWarehouse.value_over_90)} past 90 days · ${formatShare(
        share(worstWarehouse.value_over_90, risk.over90),
      )} of it`,
      icon: Warehouse,
      tone: 'warning',
    })
  }

  const worstGroup = summary.item_groups?.[0]
  if (worstGroup && worstGroup.value_over_180 > 0) {
    out.push({
      key: 'group',
      label: `${exposureLabel(worstGroup)} carries the largest 180+ exposure`,
      hint: `${formatCurrencyCompact(worstGroup.value_over_180)} obsolete · ${formatShare(
        share(worstGroup.value_over_180, risk.over180),
      )} of it`,
      icon: Layers,
      tone: 'rose',
    })
  }

  const obsoleteItems = summary.by_health?.obsolete ?? 0
  if (obsoleteItems > 0) {
    out.push({
      key: 'obsolete-items',
      label: `${formatInt(obsoleteItems)} ${obsoleteItems === 1 ? 'item is' : 'items are'} classed obsolete`,
      hint: 'A fifth or more of their value is past 180 days',
      icon: TriangleAlert,
      tone: 'danger',
    })
  }

  return out
}

/** The closing remark on the insight strip — omitted unless it is true. */
export function ageingNote(summary: StockAgeingSummary): string | undefined {
  if (!summary.items) return undefined
  const risk = capitalAtRisk(summary)
  if (risk.over90 === 0) return 'No capital stranded past 90 days.'
  return undefined
}

/* --------------------------------------------------------------- KPI helpers */

/** Icons the KPI cards use, kept beside the tones they belong with. */
export const AGEING_KPI_ICONS = {
  items: PackageCheck,
  qty: Boxes,
  value: Coins,
  slow: TriangleAlert,
  obsolete: CircleAlert,
} satisfies Record<string, LucideIcon>
