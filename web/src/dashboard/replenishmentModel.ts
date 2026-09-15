/**
 * The replenishment arithmetic, as pure functions.
 *
 * ## What the server already does, and what this adds
 *
 * `/v1/reports/replenishment` (InventoryReportService::replenishment) already
 * computes availability, the projected balance and a `suggested_qty` against
 * the item's configured reorder point, and it is the authority: it applies the
 * company's own policy and it is what the register shows. Nothing here
 * recomputes it.
 *
 * What this module adds is the DEMAND-BASED view the dashboard needs — days of
 * cover, and what the suggestion would be if it were driven by observed demand
 * over the replenishment horizon rather than by a static reorder point. The two
 * are shown side by side and labelled, because they answer different questions
 * and an item can be fine on one and short on the other.
 *
 * ## The rules that stop this lying
 *
 *  - **Reservations are deducted once.** The report's `available` is already
 *    `on_hand − reserved − packed − quality_hold − damaged − blocked`; this
 *    module takes that figure and never subtracts any of them again.
 *  - **Inbound is only counted where it exists.** `expected` is the report's
 *    own confirmed-inbound figure. There is no other inbound source in this
 *    product, so when it is absent the answer is "no inbound", not an estimate.
 *  - **Zero demand is not division by zero.** Days of cover is `null` — which
 *    the screen renders as "No recent demand" — and never Infinity, never a
 *    large number, never 0.
 *  - **Negative availability survives.** An item at −40 available needs 40 more
 *    than an item at 0, and clamping it to zero would hide the worst case on
 *    the screen whose job is finding it.
 */

import type { ReplenishmentRow } from '../services/reportsApi'

export interface DemandInputs {
  /** Observed daily demand — the trailing mean the server computed. */
  dailyMean: number
  /** Whether there is enough history for that mean to mean anything. */
  sufficientHistory: boolean
  historyDays: number
  daysWithDemand: number
}

export interface SuggestionInputs {
  /** Usable stock, reservations already deducted by the server. */
  available: number
  /** Confirmed inbound arriving inside the horizon. */
  inbound: number
  dailyDemand: number
  leadTimeDays: number | null
  safetyStock: number
  /** How far ahead to cover, beyond the lead time. */
  horizonDays: number
}

export interface Suggestion {
  /** Demand over lead time + horizon. */
  forecastDemand: number
  /** available + inbound. */
  netSupply: number
  safetyStock: number
  /** max(0, forecastDemand + safetyStock − netSupply). */
  suggestedQty: number
  /** The planning window the forecast covers. */
  coverDays: number
  /** True when no lead time is configured, so the window is the horizon only. */
  leadTimeMissing: boolean
}

/**
 * The deterministic suggestion:
 *
 *     net supply   = available + confirmed inbound
 *     forecast     = daily demand × (lead time + horizon)
 *     suggested    = max(0, forecast + safety stock − net supply)
 *
 * Worked, with the specification's own illustration: 500 available, 100/day,
 * 7-day lead time, 200 safety stock, no inbound, 0-day extra horizon →
 * 100 × 7 = 700; 700 + 200 − 500 = 400.
 *
 * A missing lead time is reported rather than guessed at. Substituting a
 * default would produce a quantity indistinguishable from a configured one,
 * and a purchase order is not a place for an invisible assumption.
 */
export function suggest(inputs: SuggestionInputs): Suggestion {
  const leadTimeMissing = inputs.leadTimeDays === null || !Number.isFinite(inputs.leadTimeDays)
  const leadTime = leadTimeMissing ? 0 : Math.max(0, inputs.leadTimeDays as number)
  const coverDays = leadTime + Math.max(0, inputs.horizonDays)

  const forecastDemand = round4(Math.max(0, inputs.dailyDemand) * coverDays)
  // Availability may be negative and must stay negative: −40 available needs
  // 40 more than 0 available, and clamping would hide the worst case.
  const netSupply = round4(inputs.available + Math.max(0, inputs.inbound))
  const safetyStock = Math.max(0, inputs.safetyStock)
  const suggestedQty = round4(Math.max(0, forecastDemand + safetyStock - netSupply))

  return { forecastDemand, netSupply, safetyStock, suggestedQty, coverDays, leadTimeMissing }
}

/**
 * How many days the stock on hand lasts at the observed rate.
 *
 * `null` when demand is zero or unknown — the caller renders "No recent
 * demand". Returning Infinity, or a big number, or 0, all read as a measurement
 * and all of them are wrong.
 */
export function daysOfCover(available: number, dailyDemand: number): number | null {
  if (!Number.isFinite(dailyDemand) || dailyDemand <= 0) return null
  if (!Number.isFinite(available)) return null
  // Negative availability is nought days of cover, not a negative number of days.
  if (available <= 0) return 0
  return round4(available / dailyDemand)
}

export type CoverUrgency = 'none' | 'critical' | 'low' | 'adequate' | 'excess'

/**
 * Days of cover against the lead time — the only comparison that makes cover
 * actionable. Below lead time means it runs out before a replacement arrives.
 */
export function coverUrgency(cover: number | null, leadTimeDays: number | null): CoverUrgency {
  if (cover === null) return 'none'
  const lead = leadTimeDays === null || !Number.isFinite(leadTimeDays) ? 7 : Math.max(1, leadTimeDays)
  if (cover <= lead) return 'critical'
  if (cover <= lead * 2) return 'low'
  if (cover >= lead * 8) return 'excess'
  return 'adequate'
}

export const COVER_TONE: Record<CoverUrgency, 'danger' | 'warning' | 'success' | 'info' | 'neutral'> = {
  critical: 'danger',
  low: 'warning',
  adequate: 'success',
  excess: 'info',
  none: 'neutral',
}

export const COVER_LABEL: Record<CoverUrgency, string> = {
  critical: 'Runs out before a replacement arrives',
  low: 'Under two lead times of cover',
  adequate: 'Adequate cover',
  excess: 'Well above what demand needs',
  none: 'No recent demand',
}

/** "5 days" / "No recent demand" — never "∞" and never a bare 0. */
export function formatCover(cover: number | null): string {
  if (cover === null) return 'No recent demand'
  if (cover < 1) return 'Under a day'
  return `${Math.floor(cover)} ${Math.floor(cover) === 1 ? 'day' : 'days'}`
}

// ---------------------------------------------------------------------------
// Data readiness
// ---------------------------------------------------------------------------

export interface ReadinessCheck {
  key: string
  label: string
  status: 'ready' | 'partial' | 'missing'
  detail: string
}

/**
 * What the suggestions are standing on.
 *
 * Shown on the dashboard because a recommendation built on three items' worth
 * of lead times is a different thing from one built on all of them, and the
 * reader is the only one who can decide whether that matters.
 */
export function readiness(rows: readonly ReplenishmentRow[], demand: DemandInputs | null): ReadinessCheck[] {
  const total = rows.length
  const missingLead = rows.filter((r) => r.lead_time_days === null || r.lead_time_days === undefined).length
  const missingSafety = rows.filter((r) => r.safety_stock_qty === null || r.safety_stock_qty === undefined).length
  const missingReorder = rows.filter((r) => r.reorder_point_qty === null || r.reorder_point_qty === undefined).length

  return [
    {
      key: 'lead_time',
      label: 'Supplier lead times',
      status: total === 0 ? 'missing' : missingLead === 0 ? 'ready' : missingLead === total ? 'missing' : 'partial',
      detail:
        total === 0
          ? 'No items to check'
          : missingLead === 0
            ? 'Configured on every item shown'
            : `${missingLead} of ${total} items have none — their suggestion covers the horizon only`,
    },
    {
      key: 'safety_stock',
      label: 'Safety stock',
      status: total === 0 ? 'missing' : missingSafety === 0 ? 'ready' : missingSafety === total ? 'missing' : 'partial',
      detail:
        total === 0
          ? 'No items to check'
          : missingSafety === 0
            ? 'Configured on every item shown'
            : `${missingSafety} of ${total} items have none — treated as zero, not guessed`,
    },
    {
      key: 'reorder_point',
      label: 'Reorder points',
      status: total === 0 ? 'missing' : missingReorder === 0 ? 'ready' : missingReorder === total ? 'missing' : 'partial',
      detail:
        total === 0
          ? 'No items to check'
          : missingReorder === 0
            ? 'Configured on every item shown'
            : `${missingReorder} of ${total} items have none and cannot trigger on stock level`,
    },
    {
      key: 'history',
      label: 'Demand history',
      status: demand === null ? 'missing' : demand.sufficientHistory ? 'ready' : 'partial',
      detail:
        demand === null
          ? 'Select an item to measure its demand'
          : demand.sufficientHistory
            ? `${demand.historyDays} days of movement, demand on ${demand.daysWithDemand} of them`
            : `Only ${demand.daysWithDemand} days with demand in the last ${demand.historyDays} — the mean is weak`,
    },
  ]
}

/**
 * Availability that a rebalance could genuinely move.
 *
 * The surplus is what a location has ABOVE its own safety stock and its own
 * lead-time demand — never its whole available balance. Recommending a transfer
 * that empties Delhi to fill Main just moves the shortage, and the screen that
 * suggested it looks like it solved something.
 */
export function transferableSurplus(row: ReplenishmentRow, dailyDemand: number, leadTimeDays: number | null): number {
  const lead = leadTimeDays === null || !Number.isFinite(leadTimeDays) ? 0 : Math.max(0, leadTimeDays)
  const ownNeed = Math.max(0, dailyDemand) * lead + Math.max(0, row.safety_stock_qty ?? 0)
  return round4(Math.max(0, row.available - ownNeed))
}

function round4(n: number): number {
  // Quantities are stored to four decimals; rounding here keeps a suggestion
  // from carrying binary-float noise into an order quantity.
  return Math.round(n * 10000) / 10000
}
