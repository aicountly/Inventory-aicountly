/**
 * Stock health: one score, the risks behind it, and what to do about them.
 *
 * ## This is arithmetic, and it says so
 *
 * There is no AI service in this product (see pulse.ts for the same decision in
 * the same words). The hero on the Valuation dashboard is therefore labelled
 * "Stock health insight" and never "AI insight": every number below is a rule
 * over a figure the server already computed, and a reader who is told it is a
 * model will act on it as one.
 *
 * ## The score
 *
 *     score = 100 − ageing − slowMoving − nonMoving − expiry − concentration − exceptions
 *
 * Six penalties, each capped, each derived only from a figure that is actually
 * KNOWN. That last part is the rule that matters: a source which has not loaded
 * or has failed contributes no penalty AND is recorded as unassessed, so the
 * hero can say the score is over five of six factors rather than quietly
 * scoring a company well for a report nobody could read. When nothing at all is
 * known the score is `null` and the hero says so — it never opens at 100.
 *
 * Every threshold is a named constant in HEALTH_WEIGHTS below. Nothing in a
 * component is allowed to invent one: someone will eventually write stock off
 * on the strength of a band on this card, and they are entitled to read the
 * rule that put it there.
 */

import type { MovementAnalysisSummary, NearExpirySummary, StockAgeingSummary, StockSummaryRow, WarehouseStockSummary } from '../services/reportsApi'
import type { ValuationBridgeData } from './aggregatesApi'
import { formatCount, formatCurrencyCompact, percentOf, plural } from './formatters'
import { drill } from './kpiNavigation'

// ---------------------------------------------------------------------------
// Configuration — every threshold on this screen, in one place
// ---------------------------------------------------------------------------

export const HEALTH_WEIGHTS = {
  /** Value share of stock 180 days and older, times this, capped. */
  ageing180: { factor: 0.45, cap: 22 },
  /** Value share of stock 91–180 days old — half the weight of the oldest. */
  ageing91: { factor: 0.12, cap: 8 },
  /** Item share classed slow-moving. */
  slowMoving: { factor: 0.18, cap: 12 },
  /** Item share classed non-moving or dead — the expensive one. */
  nonMoving: { factor: 0.42, cap: 25 },
  /** Batches already expired cost more than batches about to. */
  expiry: { expired: 4, expiring: 1, cap: 18 },
  /**
   * Concentration is only a risk past a point: a company with six SKUs is
   * concentrated by arithmetic, not by mismanagement.
   */
  concentration: { freeShare: 55, factor: 0.35, cap: 10 },
  /** Movements with no value against them, and negative ageing buckets. */
  exceptions: { perUnvaluedBatch: 0.25, unvaluedBase: 4, perNegativeBucket: 4, cap: 15 },
} as const

/** Value share of one warehouse above which the page calls it a concentration. */
export const WAREHOUSE_CONCENTRATION_SHARE = 70

/** Item share below which slow-moving stock is noise rather than a finding. */
export const SLOW_MATERIAL_SHARE = 2

/** How many of the dearest items the concentration figure is taken over. */
export const CONCENTRATION_TOP_N = 5

export const HEALTH_BANDS = [
  { min: 85, label: 'Strong stock health', tone: 'success' },
  { min: 70, label: 'Good stock health', tone: 'success' },
  { min: 50, label: 'Stock health needs attention', tone: 'warning' },
  { min: 0, label: 'Stock health is poor', tone: 'danger' },
] as const

export type HealthTone = (typeof HEALTH_BANDS)[number]['tone']
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Everything the health model reads.
 *
 * Every field is nullable and null means "not known", never zero. The four
 * sources load independently, so a partly-loaded page is the normal case rather
 * than an edge one.
 */
export interface ValuationHealthInput {
  stock: { closingValue: number; closingQty: number; items: number; topItems: readonly StockSummaryRow[] } | null
  ageing: StockAgeingSummary | null
  movement: MovementAnalysisSummary | null
  expiry: { summary: NearExpirySummary; expiringSoon: number; expired: number } | null
  warehouses: WarehouseStockSummary | null
  bridge: ValuationBridgeData | null
  /** Ageing buckets whose value is below zero — a composition that cannot compose. */
  negativeAgeingBuckets: number
  asOf: string
  period: { from: string; to: string }
}

export interface HealthFactor {
  key: string
  label: string
  /** Points subtracted. Zero is a real answer; null means it could not be read. */
  penalty: number | null
  /** The measurement behind it, in the user's words. */
  detail: string
}

export interface StockHealth {
  /** 0–100, or null when not one source could be read. */
  score: number | null
  label: string
  tone: HealthTone
  /** One or two sentences under the heading. */
  summary: string
  factors: HealthFactor[]
  /** How many of the six factors had a readable source. */
  assessed: number
  total: number
}

// ---------------------------------------------------------------------------
// Derived measures
// ---------------------------------------------------------------------------

const AGE_180 = '180_plus'
const AGE_91 = '91_180'

/** Value at cost sitting in the oldest age bucket. Null when unknown. */
export function ageingValue(summary: StockAgeingSummary | null, bucket: '180_plus' | '91_180'): number | null {
  if (!summary) return null
  const b = summary.buckets?.[bucket]
  return b && Number.isFinite(b.value) ? b.value : null
}

/**
 * The share of total stock value held by the dearest few items.
 *
 * Taken over the rows the stock-value widget already fetched (the dearest
 * `WIDGET_ROWS`), so it costs no extra request. It is a SHARE OF THE COMPANY
 * TOTAL, not of those rows: the denominator is the report's own closing value.
 * Returns null when either side is unknown or the total is not positive — a
 * share of nothing is not 0%, it is unanswerable.
 */
export function topItemConcentration(
  topItems: readonly StockSummaryRow[] | null | undefined,
  closingValue: number | null | undefined,
  topN: number = CONCENTRATION_TOP_N,
): { share: number; items: number; value: number } | null {
  if (!topItems || topItems.length === 0) return null
  if (typeof closingValue !== 'number' || !Number.isFinite(closingValue) || closingValue <= 0) return null
  const rows = [...topItems]
    .filter((r) => Number.isFinite(r.closing_value) && r.closing_value > 0)
    .sort((a, b) => b.closing_value - a.closing_value)
    .slice(0, topN)
  if (rows.length === 0) return null
  const value = rows.reduce((acc, r) => acc + r.closing_value, 0)
  return { share: percentOf(value, closingValue), items: rows.length, value }
}

/** The single warehouse holding the most value, when there is more than one. */
export function warehouseConcentration(
  summary: WarehouseStockSummary | null,
): { name: string; share: number; value: number; warehouseId: number | null; others: number } | null {
  if (!summary || !Array.isArray(summary.by_warehouse) || summary.by_warehouse.length < 2) return null
  const total = summary.closing_value
  if (!Number.isFinite(total) || total <= 0) return null
  const top = [...summary.by_warehouse].sort((a, b) => b.closing_value - a.closing_value)[0]
  if (!top || top.closing_value <= 0) return null
  return {
    name: top.warehouse_name ?? 'Unnamed warehouse',
    share: percentOf(top.closing_value, total),
    value: top.closing_value,
    warehouseId: top.warehouse_id,
    others: summary.by_warehouse.length - 1,
  }
}

/** Items counted across every movement class — the denominator for the shares. */
function movementItemTotal(summary: MovementAnalysisSummary | null): number {
  if (!summary) return 0
  return (['fast', 'slow', 'non_moving', 'dead'] as const).reduce(
    (acc, k) => acc + (summary.by_class[k]?.items ?? 0),
    0,
  )
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function capped(value: number, cap: number): number {
  return Math.round(clamp(value, 0, cap) * 10) / 10
}

export function stockHealth(input: ValuationHealthInput): StockHealth {
  const factors: HealthFactor[] = []

  // --- ageing -------------------------------------------------------------
  const ageTotal = input.ageing?.total_value ?? null
  const old180 = ageingValue(input.ageing, AGE_180)
  const old91 = ageingValue(input.ageing, AGE_91)
  if (ageTotal !== null && ageTotal > 0 && old180 !== null && old91 !== null) {
    const share180 = percentOf(Math.max(0, old180), ageTotal)
    const share91 = percentOf(Math.max(0, old91), ageTotal)
    const penalty =
      capped(share180 * HEALTH_WEIGHTS.ageing180.factor, HEALTH_WEIGHTS.ageing180.cap) +
      capped(share91 * HEALTH_WEIGHTS.ageing91.factor, HEALTH_WEIGHTS.ageing91.cap)
    factors.push({
      key: 'ageing',
      label: 'Ageing',
      penalty: Math.round(penalty * 10) / 10,
      detail: `${share180.toFixed(0)}% of value is 180 days or older, ${share91.toFixed(0)}% is 91–180 days.`,
    })
  } else {
    factors.push({
      key: 'ageing',
      label: 'Ageing',
      penalty: ageTotal === 0 ? 0 : null,
      detail: ageTotal === 0 ? 'No stock to age.' : 'Stock ageing could not be read.',
    })
  }

  // --- movement -----------------------------------------------------------
  const items = movementItemTotal(input.movement)
  if (input.movement && items > 0) {
    const slow = input.movement.by_class.slow?.items ?? 0
    const nonMoving = (input.movement.by_class.non_moving?.items ?? 0) + (input.movement.by_class.dead?.items ?? 0)
    const slowShare = percentOf(slow, items)
    const nonShare = percentOf(nonMoving, items)
    factors.push({
      key: 'slow_moving',
      label: 'Slow-moving',
      penalty: capped(slowShare * HEALTH_WEIGHTS.slowMoving.factor, HEALTH_WEIGHTS.slowMoving.cap),
      detail: `${slowShare.toFixed(0)}% of items (${formatCount(slow)}) are slow-moving.`,
    })
    factors.push({
      key: 'non_moving',
      label: 'Non-moving',
      penalty: capped(nonShare * HEALTH_WEIGHTS.nonMoving.factor, HEALTH_WEIGHTS.nonMoving.cap),
      detail: `${nonShare.toFixed(0)}% of items (${formatCount(nonMoving)}) have not moved inside the non-moving window.`,
    })
  } else {
    const noItems = input.movement !== null && items === 0
    factors.push({
      key: 'slow_moving',
      label: 'Slow-moving',
      penalty: noItems ? 0 : null,
      detail: noItems ? 'No items to classify.' : 'Movement classification could not be read.',
    })
    factors.push({
      key: 'non_moving',
      label: 'Non-moving',
      penalty: noItems ? 0 : null,
      detail: noItems ? 'No items to classify.' : 'Movement classification could not be read.',
    })
  }

  // --- expiry -------------------------------------------------------------
  if (input.expiry) {
    const { expired, expiringSoon } = input.expiry
    const penalty = capped(
      expired * HEALTH_WEIGHTS.expiry.expired + expiringSoon * HEALTH_WEIGHTS.expiry.expiring,
      HEALTH_WEIGHTS.expiry.cap,
    )
    factors.push({
      key: 'expiry',
      label: 'Expiry',
      penalty,
      detail:
        expired === 0 && expiringSoon === 0
          ? 'Nothing on hand is expired or expiring in the window.'
          : `${formatCount(expired)} expired and ${formatCount(expiringSoon)} expiring within ${formatCount(input.expiry.summary.days)} days.`,
    })
  } else {
    factors.push({ key: 'expiry', label: 'Expiry', penalty: null, detail: 'Expiry exposure could not be read.' })
  }

  // --- concentration ------------------------------------------------------
  const concentration = topItemConcentration(input.stock?.topItems, input.stock?.closingValue)
  if (concentration) {
    const excess = Math.max(0, concentration.share - HEALTH_WEIGHTS.concentration.freeShare)
    factors.push({
      key: 'concentration',
      label: 'Concentration',
      penalty: capped(excess * HEALTH_WEIGHTS.concentration.factor, HEALTH_WEIGHTS.concentration.cap),
      detail: `The dearest ${formatCount(concentration.items)} items hold ${concentration.share.toFixed(0)}% of stock value.`,
    })
  } else {
    factors.push({
      key: 'concentration',
      label: 'Concentration',
      penalty: input.stock && input.stock.closingValue === 0 ? 0 : null,
      detail:
        input.stock && input.stock.closingValue === 0
          ? 'No stock value to concentrate.'
          : 'Value concentration could not be read.',
    })
  }

  // --- exceptions ---------------------------------------------------------
  //
  // Two independent signals, from two reports that fail independently. The
  // factor reports only the ones that ANSWERED: a bridge that 403'd must not
  // contribute "0 movements carry no value", which reads as a clean bill of
  // health for a question nobody asked. `negativeAgeingBuckets` is only
  // meaningful when the ageing report itself came back, because 0 is what it
  // says both for "none" and for "not read".
  const unvalued = input.bridge ? input.bridge.unvalued_movements : null
  const negatives = input.ageing ? input.negativeAgeingBuckets : null
  if (unvalued !== null || negatives !== null) {
    const fromUnvalued =
      unvalued !== null && unvalued > 0
        ? HEALTH_WEIGHTS.exceptions.unvaluedBase + unvalued * HEALTH_WEIGHTS.exceptions.perUnvaluedBatch
        : 0
    const fromNegatives = (negatives ?? 0) * HEALTH_WEIGHTS.exceptions.perNegativeBucket
    const said: string[] = []
    if (unvalued !== null) said.push(`${formatCount(unvalued)} movements carry no value`)
    if (negatives !== null) said.push(`${formatCount(negatives)} age buckets are below zero`)
    factors.push({
      key: 'exceptions',
      label: 'Exceptions',
      penalty: capped(fromUnvalued + fromNegatives, HEALTH_WEIGHTS.exceptions.cap),
      detail: `${said.join('; ')}.`,
    })
  } else {
    factors.push({ key: 'exceptions', label: 'Exceptions', penalty: null, detail: 'Inventory exceptions could not be read.' })
  }

  const assessed = factors.filter((f) => f.penalty !== null).length
  if (assessed === 0) {
    return {
      score: null,
      label: 'Stock health is still being calculated',
      tone: 'success',
      summary: 'None of the figures behind the score have loaded yet.',
      factors,
      assessed: 0,
      total: factors.length,
    }
  }

  const penalty = factors.reduce((acc, f) => acc + (f.penalty ?? 0), 0)
  const score = Math.round(clamp(100 - penalty, 0, 100))
  const band = HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS[HEALTH_BANDS.length - 1]

  // The worst two factors, named — a score with no reason attached is a number
  // nobody can act on.
  const worst = factors
    .filter((f) => (f.penalty ?? 0) > 0)
    .sort((a, b) => (b.penalty ?? 0) - (a.penalty ?? 0))
    .slice(0, 2)

  const summary =
    worst.length === 0
      ? assessed === factors.length
        ? 'Nothing in ageing, movement, expiry, concentration or inventory exceptions is pulling this position down.'
        : 'Nothing is pulling this position down in the figures that could be read.'
      : `Mostly ${worst.map((f) => f.label.toLowerCase()).join(' and ')}. ${worst[0].detail}`

  return { score, label: band.label, tone: band.tone, summary, factors, assessed, total: factors.length }
}

// ---------------------------------------------------------------------------
// At-risk inventory
// ---------------------------------------------------------------------------

export interface RiskRow {
  key: string
  title: string
  detail: string
  level: RiskLevel
  /** The screen that shows the rows behind it. Absent rather than a dead link. */
  to?: string
}

const LEVEL_RANK: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * The at-risk panel.
 *
 * A row appears for every risk whose source could be READ, including the ones
 * that came back clean — "no items expiring in 30 days, low" is a useful thing
 * for a reader to see, and a panel that only ever lists problems cannot be
 * distinguished from one whose requests all failed. A risk whose source failed
 * is omitted entirely rather than shown as low.
 */
export function atRiskRows(input: ValuationHealthInput): RiskRow[] {
  const rows: RiskRow[] = []

  if (input.expiry) {
    const { expired, expiringSoon, summary } = input.expiry
    const level: RiskLevel = expired > 0 ? 'critical' : expiringSoon > 0 ? 'medium' : 'low'
    rows.push({
      key: 'expiry',
      title: 'Expiry risk',
      detail:
        expired > 0
          ? `${plural(expired, 'batch', 'batches')} already expired, ${formatCount(expiringSoon)} expiring within ${formatCount(summary.days)} days`
          : expiringSoon > 0
            ? `${plural(expiringSoon, 'batch', 'batches')} expiring within ${formatCount(summary.days)} days`
            : `No batches expiring in ${formatCount(summary.days)} days`,
      level,
      to: expired > 0 ? drill.expiredBatches() : drill.nearExpiry({ days: summary.days, includeExpired: false }),
    })
  }

  if (input.movement) {
    const items = movementItemTotal(input.movement)
    const slow = input.movement.by_class.slow?.items ?? 0
    const slowShare = percentOf(slow, items)
    rows.push({
      key: 'slow_moving',
      title: 'Slow-moving stock',
      detail:
        slow === 0
          ? 'No items in the slow-moving window'
          : `${plural(slow, 'item')} (${slowShare.toFixed(0)}% of items), ${formatCount(input.movement.by_class.slow?.on_hand ?? 0)} units on hand`,
      // A handful of slow SKUs in a large catalogue is arithmetic, not a
      // finding; the share has to be material before the panel raises it.
      level: slow === 0 || slowShare < SLOW_MATERIAL_SHARE ? 'low' : slowShare >= 25 ? 'high' : 'medium',
      to: drill.movementAnalysis({ from: input.period.from, to: input.period.to, cls: 'slow' }),
    })

    const nonMoving = input.movement.by_class.non_moving?.items ?? 0
    const dead = input.movement.by_class.dead?.items ?? 0
    const stalled = nonMoving + dead
    const stalledShare = percentOf(stalled, items)
    rows.push({
      key: 'non_moving',
      title: 'Non-moving stock',
      detail:
        stalled === 0
          ? 'Every item has moved inside the window'
          : `${plural(nonMoving, 'item')} non-moving${dead > 0 ? `, ${plural(dead, 'item')} dead` : ''} (${stalledShare.toFixed(0)}% of items)`,
      level: stalled === 0 ? 'low' : dead > 0 ? 'high' : stalledShare >= 20 ? 'high' : 'medium',
      to: drill.movementAnalysis({ from: input.period.from, to: input.period.to, cls: nonMoving > 0 ? 'non_moving' : 'dead' }),
    })
  }

  const concentration = topItemConcentration(input.stock?.topItems, input.stock?.closingValue)
  if (concentration) {
    rows.push({
      key: 'concentration',
      title: 'High value concentration',
      detail: `Top ${formatCount(concentration.items)} items = ${concentration.share.toFixed(0)}% of total value`,
      level: concentration.share >= 80 ? 'high' : concentration.share >= HEALTH_WEIGHTS.concentration.freeShare ? 'medium' : 'low',
      to: drill.stockValue({ asOf: input.asOf }),
    })
  }

  const warehouse = warehouseConcentration(input.warehouses)
  if (warehouse && warehouse.share >= WAREHOUSE_CONCENTRATION_SHARE) {
    rows.push({
      key: 'warehouse_concentration',
      title: 'Warehouse concentration',
      detail: `${warehouse.name} holds ${warehouse.share.toFixed(0)}% of stock value across ${formatCount(warehouse.others + 1)} warehouses`,
      level: warehouse.share >= 90 ? 'high' : 'medium',
      to: drill.warehouseStock({ asOf: input.asOf }),
    })
  }

  const ageTotal = input.ageing?.total_value ?? null
  const old180 = ageingValue(input.ageing, AGE_180)
  if (old180 !== null && ageTotal !== null && ageTotal > 0) {
    const share = percentOf(Math.max(0, old180), ageTotal)
    rows.push({
      key: 'ageing',
      title: 'Ageing stock',
      detail:
        old180 <= 0
          ? 'No stock is 180 days or older'
          : `${formatCurrencyCompact(old180)} held 180 days or more (${share.toFixed(0)}% of value)`,
      level: old180 <= 0 ? 'low' : share >= 30 ? 'high' : share >= 10 ? 'medium' : 'low',
      to: drill.stockAgeing({ asOf: input.asOf }),
    })
  }

  const unvalued = input.bridge?.unvalued_movements ?? null
  if (unvalued !== null && unvalued > 0) {
    rows.push({
      key: 'unvalued',
      title: 'Movements with no value',
      detail: `${plural(unvalued, 'movement')} in this period carry no cost, so the value bridge is short`,
      level: 'high',
      to: drill.stockMovements(),
    })
  }

  if (input.negativeAgeingBuckets > 0) {
    rows.push({
      key: 'negative_ageing',
      title: 'Negative age buckets',
      detail: `${plural(input.negativeAgeingBuckets, 'age bucket')} below zero — cost layers consumed past their quantity`,
      level: 'high',
      to: drill.negativeStock(),
    })
  }

  return rows.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
}

/** Risks that are actually risks — what "N need attention" counts. */
export function riskAttentionCount(rows: readonly RiskRow[]): number {
  return rows.filter((r) => r.level !== 'low').length
}

// ---------------------------------------------------------------------------
// Suggested actions and the insight strip
// ---------------------------------------------------------------------------

export interface SuggestedAction {
  key: string
  label: string
  to: string
}

/**
 * The pills beside the score. At most three, each one a real finding with a
 * real screen behind it — never a decorative chip.
 */
export function suggestedActions(input: ValuationHealthInput, max = 3): SuggestedAction[] {
  const out: SuggestedAction[] = []
  const rows = atRiskRows(input).filter((r) => r.level !== 'low' && r.to)

  for (const row of rows) {
    if (out.length >= max) break
    out.push({ key: row.key, label: actionLabel(row, input), to: row.to as string })
  }
  return out
}

function actionLabel(row: RiskRow, input: ValuationHealthInput): string {
  switch (row.key) {
    case 'slow_moving': {
      const n = input.movement?.by_class.slow?.items ?? 0
      return `Review ${formatCount(n)} slow-moving ${n === 1 ? 'SKU' : 'SKUs'}`
    }
    case 'non_moving': {
      const n = (input.movement?.by_class.non_moving?.items ?? 0) + (input.movement?.by_class.dead?.items ?? 0)
      return `Review ${formatCount(n)} non-moving ${n === 1 ? 'item' : 'items'}`
    }
    case 'expiry':
      return 'Check expiry exposure'
    case 'warehouse_concentration':
      return 'Move stock between warehouses'
    case 'concentration':
      return 'Review top items by value'
    case 'ageing':
      return 'Review ageing stock'
    case 'unvalued':
      return 'Fix unvalued movements'
    case 'negative_ageing':
      return 'Investigate negative stock'
    default:
      return row.title
  }
}

export interface InsightChip {
  key: string
  label: string
  tone: 'success' | 'warning' | 'danger' | 'info'
  to?: string
}

/**
 * The strip at the foot of the dashboard.
 *
 * Same discipline as pulse.ts: a chip is emitted only when its figure is known
 * AND says something. Nothing here compares against a previous period, because
 * no source on this page returns one — a chip reading "dead stock down 8%"
 * would be a number this product cannot compute.
 */
export function insightChips(input: ValuationHealthInput, max = 4): InsightChip[] {
  const chips: InsightChip[] = []

  const concentration = topItemConcentration(input.stock?.topItems, input.stock?.closingValue)
  if (concentration && concentration.share >= HEALTH_WEIGHTS.concentration.freeShare) {
    chips.push({
      key: 'concentration',
      label: `${concentration.share.toFixed(0)}% of value in top ${formatCount(concentration.items)} items`,
      tone: 'warning',
      to: drill.stockValue({ asOf: input.asOf }),
    })
  }

  const warehouse = warehouseConcentration(input.warehouses)
  if (warehouse && warehouse.share >= WAREHOUSE_CONCENTRATION_SHARE) {
    chips.push({
      key: 'warehouse',
      label: `${warehouse.name} holds ${warehouse.share.toFixed(0)}% of value`,
      tone: 'warning',
      to: drill.warehouseStock({ asOf: input.asOf }),
    })
  }

  if (input.expiry) {
    const { expired, expiringSoon, summary } = input.expiry
    if (expired > 0) {
      chips.push({
        key: 'expired',
        label: `${plural(expired, 'batch', 'batches')} already expired`,
        tone: 'danger',
        to: drill.expiredBatches(),
      })
    } else if (expiringSoon > 0) {
      chips.push({
        key: 'expiring',
        label: `${plural(expiringSoon, 'batch', 'batches')} expiring in ${formatCount(summary.days)} days`,
        tone: 'warning',
        to: drill.nearExpiry({ days: summary.days, includeExpired: false }),
      })
    } else {
      chips.push({ key: 'expiry_clear', label: 'No expiry exposure', tone: 'success' })
    }
  }

  const items = movementItemTotal(input.movement)
  if (input.movement && items > 0) {
    const dead = input.movement.by_class.dead?.items ?? 0
    const fast = input.movement.by_class.fast?.items ?? 0
    if (dead > 0) {
      chips.push({
        key: 'dead',
        label: `${plural(dead, 'item')} dead for over ${formatCount(input.movement.thresholds.dead_days)} days`,
        tone: 'danger',
        to: drill.movementAnalysis({ from: input.period.from, to: input.period.to, cls: 'dead' }),
      })
    } else {
      chips.push({
        key: 'fast',
        label: `${percentOf(fast, items).toFixed(0)}% of items moved inside ${formatCount(input.movement.thresholds.fast_days)} days`,
        tone: 'success',
        to: drill.movementAnalysis({ from: input.period.from, to: input.period.to, cls: 'fast' }),
      })
    }
  }

  const old180 = ageingValue(input.ageing, AGE_180)
  const ageTotal = input.ageing?.total_value ?? null
  if (old180 !== null && old180 > 0 && ageTotal !== null && ageTotal > 0) {
    chips.push({
      key: 'ageing',
      label: `${formatCurrencyCompact(old180)} held 180+ days`,
      tone: percentOf(old180, ageTotal) >= 25 ? 'warning' : 'info',
      to: drill.stockAgeing({ asOf: input.asOf }),
    })
  }

  return chips.slice(0, max)
}

// ---------------------------------------------------------------------------
// Prior-period comparison
// ---------------------------------------------------------------------------

/**
 * The date one month before `asOf`, or null when that falls outside the year.
 *
 * A comparison is only offered where the SAME report can answer it under the
 * SAME scope: the stock summary takes a `to` date, so "closing value a month
 * ago" is one more call to the report already on screen. Nothing else on this
 * dashboard has a prior-period form — the ageing, movement and expiry reports
 * describe a position now, not a movement between two positions — and those
 * cards carry no delta rather than a computed-looking one.
 *
 * Returns null before the financial year starts: comparing this year's stock
 * against a date the year does not contain would compare against nothing and
 * render as a fall to zero.
 */
export function previousPeriodEnd(asOf: string, fyStart: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null
  const d = new Date(`${asOf}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null

  const day = d.getUTCDate()
  const previous = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  // Clamp into the shorter month: 31 March back one month is 28 February, not
  // 3 March, which is what setMonth would have produced.
  const lastOfPrevious = new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 0)).getUTCDate()
  previous.setUTCDate(Math.min(day, lastOfPrevious))

  const iso = previous.toISOString().slice(0, 10)
  if (fyStart && iso < fyStart) return null
  return iso
}

export interface Delta {
  /** Signed percentage change. Null when it cannot be measured. */
  percent: number | null
  direction: 'up' | 'down' | 'flat'
}

/**
 * `current` against `previous`, as a percentage.
 *
 * A previous figure of zero has no percentage change — every increase from
 * nothing is infinite — so the direction is reported without one rather than
 * as `Infinity%`. A current figure equal to the previous one is flat, which is
 * a real answer and renders as an arrow that points sideways.
 */
export function deltaPercent(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return null
  const diff = current - previous
  const direction: Delta['direction'] = Math.abs(diff) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down'
  if (Math.abs(previous) < 0.005) return { percent: null, direction }
  return { percent: (diff / Math.abs(previous)) * 100, direction }
}
