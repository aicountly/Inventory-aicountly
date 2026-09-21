/**
 * The Items screen's pure logic: stock health, the insight strip, and the small
 * derivations the table, the cards and the drawer all share.
 *
 * Pure and unit-tested on purpose. Every one of these answers is stated in more
 * than one place — the amber dot in a table row, the "Low stock" chip on a
 * card, the badge in the drawer header, the KPI card above them all — and three
 * copies of "is this item low" is three chances for the screen to contradict
 * itself in front of someone deciding whether to reorder.
 *
 * It computes NO valuation. FIFO / LIFO / weighted-average costing is the
 * posting engine's and stays there; the browser renders what the API costed.
 */

import type { ItemListRow, ItemsSummary } from '../../services/items'
import { toNumber } from '../../utils/format'

// ---------------------------------------------------------------------------
// Stock health
// ---------------------------------------------------------------------------

/**
 * `untracked` is not a health state, it is the absence of one: a service or a
 * non-stock item holds no quantity, so it is neither in stock nor out of it.
 * Without it every service item in the catalogue would sit under a red "Out of
 * stock" badge, and the KPI card counting them would be raising an alarm about
 * nothing. The API draws the same line (ItemsController::TRACKED).
 */
export type StockHealthKey = 'negative' | 'out' | 'low' | 'healthy' | 'untracked'

export interface StockHealth {
  key: StockHealthKey
  label: string
  /** Maps to the Badge / dot tones the design system already defines. */
  tone: 'danger' | 'warning' | 'success' | 'neutral'
  /** Why the item is in this state, in the words a tooltip can show. */
  hint: string
  /** The threshold the quantity was measured against, when there was one. */
  threshold: number | null
  onHand: number | null
}

/** Whether the item's type holds stock at all. */
export function isStockTracked(item: Pick<ItemListRow, 'item_type'>): boolean {
  return item.item_type === 'stock'
}

/**
 * The reorder threshold: the reorder point, falling back to the minimum stock
 * level, and null when the item declares neither.
 *
 * Zero is not a threshold. Treating it as one makes every item "low" the moment
 * it reaches nothing, which is what `out` already says, and the amber badge
 * would then mean "empty" on most of the catalogue. Mirrors
 * ItemsController::THRESHOLD_EXPR so the server-side `stock_status` filter and
 * this badge cannot disagree.
 */
export function reorderThreshold(item: Pick<ItemListRow, 'reorder_point_qty' | 'min_stock_qty'>): number | null {
  const reorder = toNumber(item.reorder_point_qty)
  if (reorder !== null && reorder > 0) return reorder
  const min = toNumber(item.min_stock_qty)
  if (min !== null && min > 0) return min
  return null
}

const UNTRACKED: StockHealth = {
  key: 'untracked',
  label: 'Not stocked',
  tone: 'neutral',
  hint: 'This item type does not hold stock, so it has no on-hand quantity.',
  threshold: null,
  onHand: null,
}

const UNKNOWN: StockHealth = {
  key: 'untracked',
  label: '—',
  tone: 'neutral',
  hint: 'Stock for this item has not been loaded.',
  threshold: null,
  onHand: null,
}

/**
 * ONE definition of stock health, read by the table, the cards, the drawer and
 * the insight strip.
 *
 * `stock` absent means the list was fetched without `with_stock=1` — not that
 * the item has none. Those are different facts and the screen must not turn the
 * first into a red "out of stock".
 */
export function getStockHealth(item: ItemListRow): StockHealth {
  if (!isStockTracked(item)) return UNTRACKED

  const onHand = item.stock ? toNumber(item.stock.on_hand) : null
  if (onHand === null) return UNKNOWN

  const threshold = reorderThreshold(item)

  if (onHand < 0) {
    return {
      key: 'negative',
      label: 'Negative stock',
      tone: 'danger',
      hint: 'On-hand is below zero. This item needs a stock correction.',
      threshold,
      onHand,
    }
  }
  if (onHand === 0) {
    return {
      key: 'out',
      label: 'Out of stock',
      tone: 'danger',
      hint: 'Nothing on hand.',
      threshold,
      onHand,
    }
  }
  if (threshold !== null && onHand <= threshold) {
    return {
      key: 'low',
      label: 'Low stock',
      tone: 'warning',
      hint: `On hand ${onHand} is at or below the reorder level of ${threshold}.`,
      threshold,
      onHand,
    }
  }
  return {
    key: 'healthy',
    label: 'In stock',
    tone: 'success',
    hint: threshold !== null ? `On hand ${onHand} is above the reorder level of ${threshold}.` : 'In stock.',
    threshold,
    onHand,
  }
}

// ---------------------------------------------------------------------------
// Item identity
// ---------------------------------------------------------------------------

/**
 * Up to two letters for the avatar when an item has no image.
 *
 * Deterministic, so the same item wears the same tile on every screen and the
 * eye can use it as a landmark down a column. Intl-safe: it takes whole code
 * points, so an item named in Devanagari or emoji does not come back as half a
 * surrogate pair.
 */
export function itemInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '')
  const joined = letters.join('')
  return (joined || '—').toUpperCase()
}

/** "Pen · Raw Material" — the secondary line under an item's name. */
export function itemSubtitle(item: ItemListRow): string {
  return [item.item_alias, item.cat_name].filter((v): v is string => Boolean(v && String(v).trim())).join(' · ')
}

/** Batch / Serial / Expiry, in the order the screen shows them. */
export function trackingFlags(item: Pick<ItemListRow, 'track_batch' | 'track_serial' | 'track_expiry'>): string[] {
  return [
    Number(item.track_batch) === 1 ? 'Batch' : null,
    Number(item.track_serial) === 1 ? 'Serial' : null,
    Number(item.track_expiry) === 1 ? 'Expiry' : null,
  ].filter((f): f is string => f !== null)
}

// ---------------------------------------------------------------------------
// Inventory intelligence
// ---------------------------------------------------------------------------

export type InsightSeverity = 'critical' | 'warning' | 'info'

export interface InventoryInsight {
  id: string
  severity: InsightSeverity
  title: string
  description: string
  /** The filter that shows exactly the items this insight counts. */
  filter: Record<string, string>
  actionLabel: string
  count: number
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * The insight strip, derived from the summary counters the database returned.
 *
 * DETERMINISTIC, and described as such wherever it is shown. Each line is a
 * count the API produced and a filter that lands on exactly those rows, so a
 * reader can always check the claim by clicking it. Nothing here is inferred,
 * predicted or scored: when an anomaly-detection endpoint exists, it adds
 * insights to this list rather than changing what these ones mean.
 *
 * An empty result means the catalogue is healthy — never a reason to invent a
 * line so the strip has something to say.
 */
export function deriveInsights(summary: ItemsSummary | null): InventoryInsight[] {
  if (!summary) return []
  const out: InventoryInsight[] = []
  const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

  if (summary.negative_stock > 0) {
    out.push({
      id: 'negative-stock',
      severity: 'critical',
      title: `${items(summary.negative_stock)} ${summary.negative_stock === 1 ? 'needs' : 'need'} stock correction`,
      description: 'On-hand has gone below zero, so more has been issued than was ever received.',
      filter: { stock_status: 'negative' },
      actionLabel: 'Review',
      count: summary.negative_stock,
    })
  }
  if (summary.inactive_with_stock > 0) {
    out.push({
      id: 'inactive-with-stock',
      severity: 'critical',
      title: `${items(summary.inactive_with_stock)} deactivated while still holding stock`,
      description: 'The quantity is real but the item no longer appears on any active list.',
      filter: { status: 'inactive' },
      actionLabel: 'Review',
      count: summary.inactive_with_stock,
    })
  }
  if (summary.out_of_stock > 0) {
    out.push({
      id: 'out-of-stock',
      severity: 'warning',
      title: `${items(summary.out_of_stock)} out of stock`,
      description: 'Nothing on hand against these stock items.',
      filter: { stock_status: 'out' },
      actionLabel: 'View',
      count: summary.out_of_stock,
    })
  }
  if (summary.low_stock > 0) {
    out.push({
      id: 'low-stock',
      severity: 'warning',
      title: `${items(summary.low_stock)} at or below the reorder level`,
      description: 'On-hand has reached the reorder point set on the item.',
      filter: { stock_status: 'low' },
      actionLabel: 'View',
      count: summary.low_stock,
    })
  }
  if (summary.missing_hsn > 0) {
    out.push({
      id: 'missing-hsn',
      severity: 'info',
      title: `${items(summary.missing_hsn)} without an HSN / SAC code`,
      description: 'HSN is needed on GST documents raised for these items.',
      filter: { has_hsn: '0' },
      actionLabel: 'Complete',
      count: summary.missing_hsn,
    })
  }
  if (summary.missing_barcode > 0) {
    out.push({
      id: 'missing-barcode',
      severity: 'info',
      title: `${items(summary.missing_barcode)} without a barcode`,
      description: 'These items cannot be found by scanning.',
      filter: { has_barcode: '0' },
      actionLabel: 'Complete',
      count: summary.missing_barcode,
    })
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count)
}

/** The strip shows one line at a time; the rest live behind "View all". */
export function primaryInsight(insights: readonly InventoryInsight[]): InventoryInsight | null {
  return insights[0] ?? null
}
