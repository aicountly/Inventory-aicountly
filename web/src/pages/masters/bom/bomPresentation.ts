import type { Bom, BomComponentPreview, BomCostLine, BomLine, BomSummary } from '../../../services/masters'
import { formatCompactMoney, formatMoney, formatQty, toNumber } from '../../../utils/format'

/**
 * How a bill of materials reads on screen: its reference, its status, its
 * components, and whether anything about it needs a second look.
 *
 * Pure — no React, no API — so the table, the detail drawer, the compare view,
 * the export sheet and the print sheet all describe a row the same way, and the
 * rules can be tested without rendering anything.
 */

/* -------------------------------------------------------------------------- */
/* Reference and status                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `BOM-007`.
 *
 * The API formats this from the row's own id and sends it as `bom_code`; the
 * fallback repeats that formatting so a cached row, a fixture or an older
 * deployment still shows a reference rather than a blank badge. Both sides use
 * the same rule, so they cannot disagree.
 */
export function bomCode(row: Pick<Bom, 'bom_id' | 'bom_code'>): string {
  const given = row.bom_code?.trim()
  if (given) return given
  return `BOM-${String(row.bom_id).padStart(3, '0')}`
}

/**
 * The statuses a bill of materials can be in.
 *
 * `draft` is declared but never derived: `inv_bom_headers` stores `is_active`
 * and nothing else, so a BOM is Active or it is Inactive. It is kept in the map
 * (rather than invented at the badge) so that the day the API gains a draft
 * state, the badge, the filter and the export already agree on what to call it.
 */
export type BomStatus = 'active' | 'inactive' | 'draft'

export function bomStatus(row: Pick<Bom, 'is_active'>): BomStatus {
  return Number(row.is_active) === 1 ? 'active' : 'inactive'
}

export const BOM_STATUS_LABEL: Record<BomStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  draft: 'Draft',
}

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

export interface ComponentChips {
  visible: BomComponentPreview[]
  hidden: number
  /** Components the row has, whether or not the API sent a preview for them. */
  total: number
  /** True when the API was not asked for a preview — show a count, not chips. */
  previewMissing: boolean
}

/**
 * The chips a row shows and the `+N more` behind them.
 *
 * `component_count` is authoritative for the total: the preview is capped
 * server-side, so a BOM with nine components arrives with four chips and the
 * count says nine. Deriving the total from the preview array would print
 * "4 components" for that BOM on every screen that reads this.
 */
export function componentChips(row: Bom, max = 3): ComponentChips {
  const preview = row.components_preview
  const total = row.component_count ?? preview?.length ?? 0
  if (!preview) {
    return { visible: [], hidden: 0, total, previewMissing: true }
  }
  const visible = preview.slice(0, max)
  return { visible, hidden: Math.max(0, total - visible.length), total, previewMissing: false }
}

/** `Wooden seat · 1 pc` — the chip's tooltip and its accessible name. */
export function componentLabel(component: BomComponentPreview | BomLine): string {
  const name = component.item_name ?? `#${component.item_id}`
  const unit = 'unit_symbol' in component ? component.unit_symbol : null
  return `${name} · ${formatQty(component.qty)}${unit ? ` ${unit}` : ''}`
}

/** `1 pc` — the yield cell. */
export function yieldLabel(row: Pick<Bom, 'yield_qty' | 'yield_unit_symbol'>): string {
  return `${formatQty(row.yield_qty)}${row.yield_unit_symbol ? ` ${row.yield_unit_symbol}` : ''}`
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export type BomHealthLevel = 'ok' | 'review'

export interface BomHealth {
  level: BomHealthLevel
  /** One sentence per problem, in the order a reader would fix them. */
  reasons: string[]
}

/** Scrap above this reads as a data-entry slip rather than a process loss. */
export const HIGH_WASTAGE_PERCENT = 50

/**
 * Deterministic checks over what the row already carries.
 *
 * This is validation, not analysis, and it is never described to the user as
 * anything cleverer than that: every reason below is a rule you could apply by
 * hand, and none of them consults a model. A check whose input is absent (a
 * list row with no preview) is simply not run — a missing field is not a
 * finding.
 */
export function bomHealth(row: Bom): BomHealth {
  const reasons: string[] = []
  const components = row.components_preview
  const count = row.component_count ?? components?.length ?? 0

  if (count === 0 && row.component_count !== undefined) {
    reasons.push('No component lines — this bill cannot be used for production.')
  }
  if (Number(row.finished_item_is_active) === 0) {
    reasons.push('The finished item is inactive.')
  }
  if (components) {
    const inactive = components.filter((c) => c.item_is_active === 0)
    if (inactive.length > 0) {
      reasons.push(
        inactive.length === 1
          ? `Component "${inactive[0].item_name ?? `#${inactive[0].item_id}`}" is inactive.`
          : `${inactive.length} components are inactive.`,
      )
    }
    const zero = components.filter((c) => !(c.qty > 0))
    if (zero.length > 0) {
      reasons.push(zero.length === 1 ? 'A component has no quantity.' : `${zero.length} components have no quantity.`)
    }
    const heavy = components.filter((c) => c.scrap_percent > HIGH_WASTAGE_PERCENT)
    if (heavy.length > 0) {
      reasons.push(`Scrap above ${HIGH_WASTAGE_PERCENT}% on ${heavy.length === 1 ? 'a component' : `${heavy.length} components`}.`)
    }
  }
  if (!(row.yield_qty > 0)) {
    reasons.push('Yield quantity must be greater than zero.')
  }

  return { level: reasons.length > 0 ? 'review' : 'ok', reasons }
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A cost for a KPI caption, or the honest absence of one.
 *
 * `null` means the API could not price anything, and the caller prints the
 * phrase rather than a currency-formatted zero. Every screen that shows a BOM
 * cost goes through here so the phrase is the same everywhere.
 */
export const COST_UNAVAILABLE = 'Cost unavailable'

export function compactCost(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined ? COST_UNAVAILABLE : formatCompactMoney(value, currency)
}

export function exactCost(value: number | null | undefined, currency: string): string {
  const n = toNumber(value)
  return n === null ? COST_UNAVAILABLE : `${currencyPrefix(currency)}${formatMoney(n)}`
}

/** `₹` for INR, the bare code otherwise — matches formatCompactMoney's spacing. */
function currencyPrefix(currency: string): string {
  const code = (currency || 'INR').trim().toUpperCase()
  return code === 'INR' ? '₹' : `${code} `
}

export const COST_SOURCE_LABEL: Record<NonNullable<BomCostLine['cost_source']>, string> = {
  weighted_average: 'Weighted average cost',
  standard_cost: 'Standard cost',
}

/* -------------------------------------------------------------------------- */
/* Summary cards                                                               */
/* -------------------------------------------------------------------------- */

/** `20 of 24` as a whole percentage, or null when there is nothing to divide. */
export function sharePercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null
  return Math.round((part / whole) * 100)
}

/**
 * The caption under "Total BOMs".
 *
 * Says "vs last month" only when there is a previous month to compare with;
 * on a company whose first BOM was created last week, "+3 vs last month" would
 * be a trend read off a single data point.
 */
export function creationTrend(summary: Pick<BomSummary, 'created_last_30_days' | 'created_previous_30_days'>): {
  badge: string | null
  caption: string
} {
  const recent = summary.created_last_30_days
  if (recent <= 0) return { badge: null, caption: 'none added in 30 days' }
  return { badge: `+${recent}`, caption: 'added in the last 30 days' }
}
