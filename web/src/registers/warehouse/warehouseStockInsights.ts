import { formatQty } from '../../utils/format'
import type { WarehouseStockSummary } from '../../services/reportsApi'

/**
 * The warehouse-stock register's written observation.
 *
 * DETERMINISTIC, and deliberately so. Nothing here is generated, inferred or fetched
 * from a model: these are ordered rules over figures the server already computed for the
 * whole filtered set, and the same summary always produces the same sentence. The card
 * that renders it is styled as the product's AI surface because that is where an actual
 * inventory-intelligence service will land; until one exists, a rule that can be read in
 * this file is the only honest thing to put behind that badge.
 *
 * Two constraints hold every rule:
 *
 *  - every figure comes from `summary`, which covers the whole filtered result. Nothing
 *    is counted from the rows on the page, because "12 items need replenishment" over
 *    page 1 of 40 is the most confidently wrong sentence this screen could print.
 *  - a rule that cannot be stated truthfully is not stated. The mock's "12 items need
 *    replenishment in North warehouse" names a warehouse the summary cannot attribute a
 *    reorder to — a reorder point is a property of the item — so the rule says how many
 *    and leaves the where to the table.
 *
 * When a real insight service arrives it replaces `warehouseStockInsight` wholesale; the
 * card, its props and the register are already in the right shape for it.
 */

export type InsightTone = 'danger' | 'warning' | 'info' | 'success'

export interface WarehouseStockInsight {
  /** Which rule fired — stable, so a test can name one without matching prose. */
  rule: string
  tone: InsightTone
  /** The observation, one sentence. */
  headline: string
  /** What it was worked out from, or what to do about it. */
  detail: string
  /** `?health=` value that shows the rows behind the observation, when there is one. */
  health?: string
}

/** The share at which one warehouse holding the stock is worth remarking on. */
const CONCENTRATION_PCT = 60

/** Share of the whole, as a whole number. Guards the zero-total case. */
function share(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole === 0) return 0
  return Math.round((part / whole) * 100)
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Verb / pronoun agreement, so "1 item has" and "4 items have" both read. */
function agree(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_
}

/**
 * The first rule that fires, worst first.
 *
 * Returns null when the register is empty — an observation about no rows is not an
 * observation, and the empty state already says what to do.
 */
export function warehouseStockInsight(
  summary: WarehouseStockSummary | undefined,
): WarehouseStockInsight | null {
  if (!summary || summary.rows === 0) return null
  const health = summary.health ?? {}
  const items = summary.health_items ?? {}
  const negative = health.negative ?? 0
  const reorder = health.reorder ?? 0
  const low = health.low ?? 0
  const overstocked = health.overstocked ?? 0

  if (negative > 0) {
    return {
      rule: 'negative',
      tone: 'danger',
      headline: `${plural(negative, 'line')} ${agree(negative, 'shows', 'show')} stock below zero.`,
      detail: 'Correct the postings behind them before this valuation is relied on.',
      health: 'negative',
    }
  }

  if (reorder > 0) {
    const n = items.reorder ?? reorder
    return {
      rule: 'reorder',
      tone: 'danger',
      headline: `${plural(n, 'item')} ${agree(n, 'has', 'have')} reached ${agree(n, 'its', 'their')} reorder point.`,
      detail: 'Measured against the reorder point on each item, across the warehouses in view.',
      health: 'reorder',
    }
  }

  if (low > 0) {
    const n = items.low ?? low
    return {
      rule: 'low',
      tone: 'warning',
      headline: `${plural(n, 'item')} ${agree(n, 'is', 'are')} under ${agree(n, 'its', 'their')} safety stock.`,
      detail: 'No reorder point is set on these, so the safety stock is what triggered it.',
      health: 'low',
    }
  }

  // Where the value sits. Only worth saying when there is more than one warehouse to
  // compare and one of them genuinely dominates. 60% and not 50%: across two warehouses
  // one of them is over half by arithmetic, and "Main holds 51% of stock value" is a
  // sentence about the number two, not about the stock.
  const byWarehouse = summary.by_warehouse ?? []
  if (byWarehouse.length > 1 && summary.closing_value > 0) {
    const top = [...byWarehouse].sort((a, b) => b.closing_value - a.closing_value)[0]
    const pct = share(top.closing_value, summary.closing_value)
    if (pct >= CONCENTRATION_PCT) {
      return {
        rule: 'concentration',
        tone: 'info',
        headline: `${top.warehouse_name ?? 'One warehouse'} holds ${pct}% of stock value.`,
        detail: `Across ${plural(byWarehouse.length, 'warehouse')} carrying stock on this date.`,
      }
    }
  }

  // Reserved stock is a live figure, so it is only offered on a live read.
  if (summary.live_buckets && (summary.reserved_qty ?? 0) > 0 && summary.closing_qty > 0) {
    const pct = share(summary.reserved_qty ?? 0, summary.closing_qty)
    return {
      rule: 'reserved',
      tone: 'info',
      headline: `${formatQty(summary.reserved_qty)} units are reserved — ${pct}% of what is on hand.`,
      detail: 'Committed to open documents and not free to promise.',
    }
  }

  if (overstocked > 0) {
    const n = items.overstocked ?? overstocked
    return {
      rule: 'overstocked',
      tone: 'info',
      headline: `${plural(n, 'item')} ${agree(n, 'is', 'are')} above ${agree(n, 'its', 'their')} maximum.`,
      detail: 'Capital tied up beyond the level set on the item.',
      health: 'overstocked',
    }
  }

  return {
    rule: 'healthy',
    tone: 'success',
    headline: 'Every line is within the levels set on its item.',
    detail: `${plural(summary.items, 'item')} across ${plural(summary.warehouses, 'warehouse')}.`,
  }
}

/**
 * The current-state alerts beside the table.
 *
 * Deliberately NOT an event feed: Inventory records no "stock went negative at 14:05"
 * event, so a card that printed "2 hours ago" would be inventing the one part of an
 * alert that makes it an alert. These are states, counted now, each linking to the rows
 * behind it.
 */
export interface StockAlert {
  key: string
  tone: InsightTone
  label: string
  hint: string
  health?: string
}

export function warehouseStockAlerts(summary: WarehouseStockSummary | undefined): StockAlert[] {
  if (!summary) return []
  const health = summary.health ?? {}
  const items = summary.health_items ?? {}
  const out: StockAlert[] = []
  const add = (
    key: string,
    tone: InsightTone,
    count: number,
    noun: 'line' | 'item',
    tail: string,
    hint: string,
  ) => {
    if (count > 0) out.push({ key, tone, label: `${plural(count, noun)} ${tail}`, hint, health: key })
  }

  add('negative', 'danger', health.negative ?? 0, 'line', 'below zero', 'Posting correction needed')
  add('reorder', 'danger', items.reorder ?? 0, 'item', 'at the reorder point', 'Replenishment due')
  add('low', 'warning', items.low ?? 0, 'item', 'under safety stock', 'Replenishment recommended')
  add('out', 'info', health.out ?? 0, 'line', 'out of stock', 'Nothing on hand on this date')
  add('overstocked', 'info', items.overstocked ?? 0, 'item', 'above the maximum', 'Capital tied up')

  return out
}
