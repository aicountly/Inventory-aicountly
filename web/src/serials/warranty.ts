/**
 * What a warranty date MEANS, as the serial workspace reads it.
 *
 * A raw expiry date in a column is a fact nobody acts on. The question a stock
 * controller actually asks is "which of these do I have to do something about
 * this month" — so every date is resolved to one of five states and a phrase
 * that answers it without arithmetic.
 *
 * The thresholds are the server's, not this file's: `GET /v1/serials/summary`
 * sends `soon_days` / `upcoming_days` with the counts, so the card that says
 * "14 expiring" and the row that says "Expires in 21 days" cannot be measuring
 * different windows. The constants below are the fallback for the moment before
 * that response lands, and they match the API's own defaults.
 */

export type WarrantyState = 'none' | 'expired' | 'urgent' | 'upcoming' | 'active'

export interface WarrantyThresholds {
  /** Inside this many days: urgent. */
  soonDays: number
  /** Inside this many days (but past `soonDays`): upcoming. */
  upcomingDays: number
}

export const DEFAULT_WARRANTY_THRESHOLDS: WarrantyThresholds = { soonDays: 30, upcomingDays: 90 }

const DAY_MS = 86_400_000

/** `2026-09-18` → a UTC midnight timestamp, or null when it is not a date. */
function utcMidnight(iso: string | null | undefined): number | null {
  if (!iso) return null
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/**
 * Whole days from `today` to `until`; negative once it has passed.
 *
 * Both ends are snapped to UTC midnight before subtracting, so a reader in
 * Mumbai and a reader in London counting the same warranty get the same number
 * of days rather than one of them being a day out for half of every day.
 */
export function daysUntil(until: string | null | undefined, today: string): number | null {
  const end = utcMidnight(until)
  const start = utcMidnight(today)
  if (end === null || start === null) return null
  return Math.round((end - start) / DAY_MS)
}

export function warrantyState(
  until: string | null | undefined,
  today: string,
  thresholds: WarrantyThresholds = DEFAULT_WARRANTY_THRESHOLDS,
): WarrantyState {
  const days = daysUntil(until, today)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= thresholds.soonDays) return 'urgent'
  if (days <= thresholds.upcomingDays) return 'upcoming'
  return 'active'
}

/**
 * The phrase under the date: "2.6 years left", "11 months left",
 * "Expires in 21 days", "Expired".
 *
 * The unit changes with the distance because that is how the answer is used. A
 * warranty running out next week is a task and the reader needs the days; one
 * running out in 2028 is a fact and "952 days left" is a number they would have
 * to divide themselves.
 */
export function warrantyPhrase(until: string | null | undefined, today: string): string | null {
  const days = daysUntil(until, today)
  if (days === null) return null
  if (days < 0) return 'Expired'
  if (days === 0) return 'Expires today'
  if (days === 1) return 'Expires tomorrow'
  if (days <= 45) return `Expires in ${days} days`
  const months = Math.round(days / 30.44)
  if (months < 18) return `${months} months left`
  const years = days / 365.25
  return `${years.toFixed(1)} years left`
}

/** Badge / text tone for a state. `none` is deliberately quiet, not a warning. */
export function warrantyTone(state: WarrantyState): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (state) {
    case 'active':
      return 'success'
    case 'upcoming':
      return 'warning'
    case 'urgent':
    case 'expired':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** The word for a state, for a filter chip or a screen-reader label. */
export const WARRANTY_STATE_LABEL: Record<WarrantyState, string> = {
  none: 'No warranty recorded',
  expired: 'Expired',
  urgent: 'Expiring soon',
  upcoming: 'Expiring',
  active: 'Active',
}
