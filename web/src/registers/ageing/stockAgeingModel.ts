/**
 * The ageing arithmetic, in ONE place.
 *
 * Five bands, a health score, a set of thresholds and a handful of derived figures are
 * read by the KPI cards, two charts, an insight strip, a table column and a printed
 * sheet. Spread across those, "older than 90 days" would eventually mean two different
 * things on the same screen — so nothing here touches React, everything is a pure
 * function of the server's own summary, and it is unit tested.
 *
 * What is NOT here: the ageing itself. Which layer is how old, and what it is worth, is
 * decided by InventoryReportService from the open cost layers (FIFO / LIFO) or the last
 * receipt (WAC). This module only reads the buckets that come back and says what they
 * mean for the business. Nothing here may change a valuation.
 */

import type {
  AgeBucketKey,
  AgeBucketTotals,
  AgeingBreakdown,
  StockAgeingSummary,
  StockHealthStatus,
} from '../../services/reportsApi'
import type { IconTone } from '../../ui/IconTile'
import type { Tone } from '../../dashboard/model'

/* ------------------------------------------------------------------ bands */

export const AGE_BUCKET_ORDER: readonly AgeBucketKey[] = [
  '0_30',
  '31_60',
  '61_90',
  '91_180',
  '180_plus',
]

/**
 * How each band is drawn and spoken about.
 *
 * `label` is the short form the axis and the legend use; `srLabel` is what a screen
 * reader and the accessible table get, where "0–30" alone would be a bare pair of
 * numbers. The colour is a `Tone`, resolved through dashboard/visuals like every other
 * chart in the product, so a band means the same thing here as on the dashboard — and so
 * the colour is never the only thing saying which band a figure belongs to.
 */
export interface AgeBucketMeta {
  key: AgeBucketKey
  label: string
  srLabel: string
  tone: Tone
  iconTone: IconTone
  /** The band's own hex, for the donut arcs and the bar fills. */
  color: string
  /**
   * The band's accent as a text class, for the value line inside a table cell.
   *
   * Text rather than a tinted cell background on purpose: five coloured columns across a
   * fifteen-column table is a heat map nobody asked for, and the row underneath stops
   * being readable. The band's own header says which band it is; the colour only ranks
   * the five against each other at a glance.
   */
  textClass: string
}

export const AGE_BUCKET_META: Record<AgeBucketKey, AgeBucketMeta> = {
  '0_30': { key: '0_30', label: '0–30', srLabel: '0–30 days', tone: 'success', iconTone: 'success', color: '#10b981', textClass: 'text-emerald-600' },
  '31_60': { key: '31_60', label: '31–60', srLabel: '31–60 days', tone: 'info', iconTone: 'info', color: '#0ea5e9', textClass: 'text-sky-600' },
  '61_90': { key: '61_90', label: '61–90', srLabel: '61–90 days', tone: 'warning', iconTone: 'warning', color: '#f59e0b', textClass: 'text-amber-600' },
  '91_180': { key: '91_180', label: '91–180', srLabel: '91–180 days', tone: 'danger', iconTone: 'danger', color: '#f97316', textClass: 'text-orange-600' },
  '180_plus': { key: '180_plus', label: '180+', srLabel: '180+ days', tone: 'critical', iconTone: 'rose', color: '#f43f5e', textClass: 'text-rose-600' },
}

/** Bands counted as "capital at risk" and as "obsolete" — used by every caller. */
export const AT_RISK_BUCKETS: readonly AgeBucketKey[] = ['91_180', '180_plus']
export const OBSOLETE_BUCKETS: readonly AgeBucketKey[] = ['180_plus']
export const FRESH_BUCKETS: readonly AgeBucketKey[] = ['0_30', '31_60']

/* ----------------------------------------------------------- health words */

/**
 * The server's per-line verdict, dressed for the screen.
 *
 * The rule itself lives in PHP (InventoryReportService::classifyStockHealth) so the
 * exported spreadsheet cannot disagree with the table. This is only the label, the tone
 * and the sentence that explains it.
 */
export interface HealthStatusMeta {
  label: string
  tone: IconTone
  /** Badge classes. Orange for slow and rose for obsolete, matching their bands. */
  badgeClass: string
  dotClass: string
  /** What the badge means, for the column's own tooltip. */
  hint: string
}

export const HEALTH_STATUS_ORDER: readonly StockHealthStatus[] = [
  'fresh',
  'healthy',
  'watch',
  'slow',
  'obsolete',
]

export const HEALTH_STATUS_META: Record<StockHealthStatus, HealthStatusMeta> = {
  fresh: {
    label: 'Fresh',
    tone: 'success',
    badgeClass: 'bg-emerald-500/10 text-emerald-700',
    dotClass: 'bg-emerald-500',
    hint: 'At least 70% of this line’s value is 30 days old or less.',
  },
  healthy: {
    label: 'Healthy',
    tone: 'teal',
    badgeClass: 'bg-teal-500/10 text-teal-700',
    dotClass: 'bg-teal-500',
    hint: 'No band past 60 days holds a material share of this line’s value.',
  },
  watch: {
    label: 'Watch',
    tone: 'warning',
    badgeClass: 'bg-amber-500/10 text-amber-700',
    dotClass: 'bg-amber-500',
    hint: 'At least 30% of this line’s value has been in stock 61–90 days.',
  },
  slow: {
    label: 'Slow moving',
    tone: 'danger',
    badgeClass: 'bg-orange-500/10 text-orange-700',
    dotClass: 'bg-orange-500',
    hint: 'At least 20% of this line’s value has been in stock 91–180 days.',
  },
  obsolete: {
    label: 'Obsolete',
    tone: 'rose',
    badgeClass: 'bg-rose-500/10 text-rose-700',
    dotClass: 'bg-rose-500',
    hint: 'At least 10% of this line’s value has been in stock more than 180 days.',
  },
}

/* ------------------------------------------------------------ health score */

/**
 * The score's weights, in one object rather than scattered as magic numbers.
 *
 * Deliberately a plain, stated rule and NOT a model: it is 100 less a penalty for the
 * share of value sitting in each ageing band, so a controller can reproduce it on the
 * back of an envelope from the figures on the same screen. `stockHealth` returns the
 * per-band terms it used, and the "How is this calculated?" panel prints them — so if the
 * weights change here, the explanation on screen changes with them.
 */
export const HEALTH_SCORE_WEIGHTS: Readonly<Partial<Record<AgeBucketKey, number>>> = {
  '61_90': 10,
  '91_180': 25,
  '180_plus': 60,
}

export interface HealthBand {
  /** Lowest score that reads as this band. */
  min: number
  label: string
  tone: IconTone
  /** One line under the band name, saying what it means for the stock. */
  summary: string
}

/** Highest band first: `bandFor` takes the first whose `min` the score reaches. */
export const HEALTH_BANDS: readonly HealthBand[] = [
  { min: 90, label: 'Excellent', tone: 'success', summary: 'Almost all stock value is inside the freshest ageing bands.' },
  { min: 75, label: 'Healthy', tone: 'success', summary: 'Most stock value sits within acceptable ageing bands.' },
  { min: 60, label: 'Watch', tone: 'warning', summary: 'A meaningful share of stock value is ageing past 60 days.' },
  { min: 40, label: 'At risk', tone: 'danger', summary: 'A large share of capital is locked in stock older than 90 days.' },
  { min: 0, label: 'Critical', tone: 'rose', summary: 'Most of the stock value on hand is old enough to need a decision.' },
]

export function bandFor(score: number): HealthBand {
  return HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1]
}

/* ---------------------------------------------------------------- helpers */

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** `part` as a percentage of `total`; 0 when there is no total to take a share of. */
export function share(part: unknown, total: unknown): number {
  const t = num(total)
  if (t <= 0) return 0
  return (num(part) / t) * 100
}

function bucket(summary: StockAgeingSummary, key: AgeBucketKey): AgeBucketTotals {
  return summary.buckets?.[key] ?? { qty: 0, value: 0, items: 0 }
}

/** Sum of one measure across a set of bands. */
export function sumBuckets(
  summary: StockAgeingSummary,
  keys: readonly AgeBucketKey[],
  measure: 'qty' | 'value' | 'items' = 'value',
): number {
  let total = 0
  for (const key of keys) {
    const b = bucket(summary, key)
    total += num(measure === 'qty' ? b.qty : measure === 'value' ? b.value : b.items)
  }
  return total
}

/* ------------------------------------------------------------- the figures */

export type AgeingMeasure = 'value' | 'qty' | 'items'

export interface BucketSlice extends AgeBucketMeta {
  qty: number
  value: number
  items: number
  /** Share of the filtered set's total, by measure, 0–100. */
  valuePercent: number
  qtyPercent: number
  itemsPercent: number
}

/** The five bands as the charts want them, in age order and never short of a band. */
export function bucketSlices(summary: StockAgeingSummary): BucketSlice[] {
  const totalItems = sumBuckets(summary, AGE_BUCKET_ORDER, 'items')
  return AGE_BUCKET_ORDER.map((key) => {
    const b = bucket(summary, key)
    return {
      ...AGE_BUCKET_META[key],
      qty: num(b.qty),
      value: num(b.value),
      items: num(b.items),
      valuePercent: share(b.value, summary.total_value),
      qtyPercent: share(b.qty, summary.total_qty),
      itemsPercent: share(b.items, totalItems),
    }
  })
}

export function measureOf(slice: BucketSlice, measure: AgeingMeasure): number {
  return measure === 'value' ? slice.value : measure === 'qty' ? slice.qty : slice.items
}

export function percentOf(slice: BucketSlice, measure: AgeingMeasure): number {
  return measure === 'value'
    ? slice.valuePercent
    : measure === 'qty'
      ? slice.qtyPercent
      : slice.itemsPercent
}

/** One line of the score's arithmetic, for the explanation panel. */
export interface HealthScoreTerm {
  key: AgeBucketKey
  label: string
  /** Share of total stock value in this band, 0–100. */
  percent: number
  /** The weight applied to it. */
  weight: number
  /** Points this band took off. */
  penalty: number
}

export interface StockHealth {
  /** 0–100, clamped. Null when there is no stock value to judge. */
  score: number | null
  band: HealthBand
  terms: HealthScoreTerm[]
  freshPercent: number
  watchPercent: number
  slowPercent: number
  obsoletePercent: number
  valueOver90: number
  valueOver180: number
  percentOver90: number
  percentOver180: number
  /** Item counts the server classified, for the strip. */
  atRiskItems: number
  obsoleteItems: number
}

/**
 * The stock health read, derived from the server's own summary and nothing else.
 *
 * Returns `score: null` rather than 100 when there is no stock value at all: an empty
 * register has no health to report, and a green "100 — Excellent" over a company that
 * holds nothing is the most confidently wrong thing this page could say.
 */
export function stockHealth(summary: StockAgeingSummary): StockHealth {
  const totalValue = num(summary.total_value)
  const valueOver180 = sumBuckets(summary, OBSOLETE_BUCKETS)
  const valueOver90 = sumBuckets(summary, AT_RISK_BUCKETS)

  const terms: HealthScoreTerm[] = AGE_BUCKET_ORDER.filter(
    (key) => HEALTH_SCORE_WEIGHTS[key] !== undefined,
  ).map((key) => {
    const weight = HEALTH_SCORE_WEIGHTS[key] ?? 0
    const percent = share(bucket(summary, key).value, totalValue)
    return {
      key,
      label: AGE_BUCKET_META[key].srLabel,
      percent,
      weight,
      penalty: (percent / 100) * weight,
    }
  })

  const penalty = terms.reduce((sum, t) => sum + t.penalty, 0)
  const score = totalValue > 0 ? Math.max(0, Math.min(100, Math.round(100 - penalty))) : null

  const byHealth = summary.by_health
  const count = (status: StockHealthStatus): number => num(byHealth?.[status]?.items)

  return {
    score,
    band: bandFor(score ?? 100),
    terms,
    freshPercent: share(sumBuckets(summary, FRESH_BUCKETS), totalValue),
    watchPercent: share(bucket(summary, '61_90').value, totalValue),
    slowPercent: share(bucket(summary, '91_180').value, totalValue),
    obsoletePercent: share(valueOver180, totalValue),
    valueOver90,
    valueOver180,
    percentOver90: share(valueOver90, totalValue),
    percentOver180: share(valueOver180, totalValue),
    atRiskItems: count('slow') + count('obsolete'),
    obsoleteItems: count('obsolete'),
  }
}

/* -------------------------------------------------------------- breakdowns */

export interface RankedBreakdown extends AgeingBreakdown {
  label: string
  /** This line's share of the whole set's over-90 value, 0–100. */
  percentOfAtRisk: number
}

/**
 * The warehouse or item group carrying the most stock older than 90 days.
 *
 * Ranked by the aged value itself, not by the holding: the biggest warehouse is usually
 * the one with the most of everything, and naming it as the ageing problem would be true
 * and useless. Returns null when nothing in the set is older than 90 days, so the caller
 * can say nothing rather than name a leader of an empty field.
 *
 * `total` is the figure the share is taken against, and callers pass the SUMMARY's own
 * over-90 (or over-180) value. The server bounds these lists — a company can have
 * thousands of item groups — so summing the rows would divide by a truncated total and
 * overstate the leader's share by however much was left off the end. Omit it and the rows
 * are summed, which is right only when the list is known to be whole.
 */
export function worstForAgeing(
  rows: readonly AgeingBreakdown[] | undefined,
  nameOf: (row: AgeingBreakdown) => string,
  measure: 'value_over_90' | 'value_over_180' = 'value_over_90',
  total?: number,
): RankedBreakdown | null {
  if (!rows?.length) return null
  const against = total === undefined ? rows.reduce((sum, r) => sum + num(r[measure]), 0) : num(total)
  if (against <= 0) return null
  let best: AgeingBreakdown | null = null
  for (const row of rows) {
    if (best === null || num(row[measure]) > num(best[measure])) best = row
  }
  if (best === null || num(best[measure]) <= 0) return null
  return {
    ...best,
    label: nameOf(best),
    // A truncated list cannot make a line more than the whole it came from.
    percentOfAtRisk: Math.min(100, share(best[measure], against)),
  }
}

export function warehouseName(row: AgeingBreakdown): string {
  return row.warehouse_name ?? (row.warehouse_id ? `Warehouse #${row.warehouse_id}` : 'Unassigned')
}

export function itemGroupName(row: AgeingBreakdown): string {
  return row.grp_name ?? 'Ungrouped items'
}

/* ------------------------------------------------------------ the sentence */

/**
 * What the register can say about this set in words, from the figures it already has.
 *
 * Every sentence is arithmetic over the server's summary — no trend, no comparison and
 * no inference, because the ageing endpoint answers for one date and a "down 4% on last
 * month" it never computed would be invented. Sentences that would not be true are not
 * returned at all rather than returned hedged.
 */
export function ageingObservations(summary: StockAgeingSummary): string[] {
  const health = stockHealth(summary)
  const out: string[] = []

  if (summary.total_value > 0 && health.percentOver90 >= 1) {
    out.push(
      `${health.percentOver90.toFixed(1)}% of stock value has been on hand for more than 90 days.`,
    )
  }

  const worstWarehouse = worstForAgeing(
    summary.by_warehouse,
    warehouseName,
    'value_over_90',
    health.valueOver90,
  )
  if (worstWarehouse && worstWarehouse.percentOfAtRisk >= 25) {
    out.push(
      `${worstWarehouse.label} holds ${worstWarehouse.percentOfAtRisk.toFixed(0)}% of the stock value older than 90 days.`,
    )
  }

  const worstGroup = worstForAgeing(
    summary.by_item_group,
    itemGroupName,
    'value_over_180',
    health.valueOver180,
  )
  if (worstGroup && worstGroup.percentOfAtRisk >= 25) {
    out.push(
      `${worstGroup.label} carries the largest exposure past 180 days, at ${worstGroup.percentOfAtRisk.toFixed(0)}% of it.`,
    )
  }

  if (health.obsoleteItems > 0) {
    out.push(
      `${health.obsoleteItems} ${health.obsoleteItems === 1 ? 'line has' : 'lines have'} at least a tenth of their value sitting past 180 days.`,
    )
  }

  if (summary.weighted_age_days !== null && summary.total_qty > 0) {
    out.push(
      `Stock on hand is ${summary.weighted_age_days} days old on average, weighted by quantity.`,
    )
  }

  return out
}
