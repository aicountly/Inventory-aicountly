/**
 * Quick Insights — sentences built from figures the API counted.
 *
 * The rule this file exists to enforce: every line on the Insights rail must be
 * derivable, by hand, from a number the server sent. No estimate, no rounding
 * of a missing value to zero, no sentence that reads like a conclusion the data
 * does not support. If a fact is not in `metrics` or in a live sales response,
 * there is no insight about it — the rail is shorter, which is fine.
 *
 * Pure and total, so the whole rail is unit-testable against a metrics object.
 */

import type { BrandMetrics } from '../../../services/masters'
import type { BrandSales } from '../../../services/brandAnalyticsApi'

export type BrandInsightTone = 'positive' | 'warning' | 'negative' | 'neutral'

export interface BrandInsight {
  id: string
  tone: BrandInsightTone
  title: string
  description: string
  /** Where the reader goes to act on it — always a view of these same rows. */
  to?: string
}

const BRANDS = '/masters/brands'

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** `3` from `1` → `+200%`. Null when the base is zero: nothing divides by it. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** `18` from `1245670` of `6920000`. Null when the whole is zero or unknown. */
export function shareOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
  return (part / whole) * 100
}

function growthInsight(m: BrandMetrics): BrandInsight | null {
  const { new_this_month: now, new_prev_month: before } = m
  if (now === 0 && before === 0) return null
  if (now === 0) {
    return {
      id: 'growth',
      tone: 'neutral',
      title: 'No brands added this month',
      description: `${before} ${plural(before, 'was', 'were')} added last month.`,
    }
  }
  const pct = percentChange(now, before)
  return {
    id: 'growth',
    tone: 'positive',
    title: `${now} ${plural(now, 'brand', 'brands')} added this month`,
    description:
      pct === null
        ? 'None were added last month, so there is nothing to compare against.'
        : pct >= 0
          ? `That is ${Math.round(pct)}% more than last month.`
          : `That is ${Math.round(Math.abs(pct))}% fewer than last month.`,
    to: `${BRANDS}?created=month`,
  }
}

function linkageInsight(m: BrandMetrics): BrandInsight | null {
  if (m.total === 0) return null
  if (m.without_items === 0) {
    return {
      id: 'linkage',
      tone: 'positive',
      title: 'Every brand is in use',
      description: `All ${m.total} ${plural(m.total, 'brand has', 'brands have')} at least one item filed under ${plural(m.total, 'it', 'them')}.`,
    }
  }
  return {
    id: 'linkage',
    tone: 'warning',
    title: `${m.without_items} ${plural(m.without_items, 'brand has', 'brands have')} no items`,
    description: `Nothing is filed under ${plural(m.without_items, 'it', 'them')} yet — link items or deactivate.`,
    to: `${BRANDS}?has_items=0`,
  }
}

function inactiveInsight(m: BrandMetrics): BrandInsight | null {
  if (m.inactive === 0) return null
  return {
    id: 'inactive',
    tone: 'neutral',
    title: `${m.inactive} ${plural(m.inactive, 'brand is', 'brands are')} inactive`,
    description: `${plural(m.inactive, 'It stays', 'They stay')} on existing records but no longer ${plural(m.inactive, 'appears', 'appear')} in pickers.`,
    to: `${BRANDS}?status=inactive`,
  }
}

function topByItemsInsight(m: BrandMetrics): BrandInsight | null {
  const top = m.top_by_items
  if (!top || top.item_count === 0) return null
  return {
    id: 'top-items',
    tone: 'neutral',
    title: `${top.brand_name} carries the most items`,
    description: `${top.item_count} ${plural(top.item_count, 'item is', 'items are')} filed under it.`,
    to: `/items?brand_id=${top.brand_id}`,
  }
}

/**
 * The revenue line — only when Books actually answered.
 *
 * The share is of BRAND-ATTRIBUTED sales, i.e. the rows Books returned, and the
 * sentence says so. Calling it a share of total sales would be a different and
 * unverifiable claim: Inventory never sees the invoices that carry no brand.
 */
function salesInsight(sales: BrandSales | null, nameOf: (id: number) => string | null): BrandInsight | null {
  if (!sales?.available || sales.rows.length === 0) return null
  const total = sales.rows.reduce((sum, row) => sum + row.sales, 0)
  const leader = sales.rows.reduce((best, row) => (row.sales > best.sales ? row : best), sales.rows[0])
  const name = nameOf(leader.brand_id)
  if (!name || leader.sales <= 0) return null
  const pct = shareOf(leader.sales, total)
  return {
    id: 'top-sales',
    tone: 'positive',
    title: `${name} leads on revenue`,
    description:
      pct === null
        ? 'It has the highest turnover of any brand this financial year.'
        : `It is ${Math.round(pct)}% of brand-attributed sales this financial year.`,
    to: `/items?brand_id=${leader.brand_id}`,
  }
}

export interface BrandInsightInput {
  metrics: BrandMetrics | null
  sales: BrandSales | null
  /** Resolves a brand id to its name from the rows on screen; null when unknown. */
  nameOf?: (id: number) => string | null
}

/**
 * The rail, in the order a reader wants it: what changed, what needs doing,
 * what is switched off, who leads.
 *
 * With no metrics there are no insights — not a placeholder sentence, and not a
 * cheerful one. The caller renders its loading or empty state instead.
 */
export function buildBrandInsights({ metrics, sales, nameOf }: BrandInsightInput): BrandInsight[] {
  if (!metrics) return []
  const resolve = nameOf ?? (() => null)
  return [
    growthInsight(metrics),
    linkageInsight(metrics),
    inactiveInsight(metrics),
    salesInsight(sales, resolve),
    topByItemsInsight(metrics),
  ].filter((insight): insight is BrandInsight => insight !== null)
}
