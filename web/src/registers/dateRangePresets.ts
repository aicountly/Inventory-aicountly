/**
 * Date-range presets for register filters.
 *
 * Ported in spirit from books-react-app/web/src/utils/dateRangePresets.js and
 * reduced to what a register actually needs: a named period the reader picks
 * once, instead of the two bare `<input type="date">` boxes every Inventory
 * screen ships today.
 *
 * Everything here is pure string maths on `YYYY-MM-DD`. No `Date.now()`, no
 * locale, no timezone: the caller passes `today` and the financial-year bounds,
 * so the same inputs always give the same range — which is what makes it
 * testable in the existing node vitest environment.
 *
 * Why a module of its own rather than `src/utils/`: the primitives phase of the
 * plan also lists a `utils/dateRangePresets.ts`. That file does not exist yet
 * and registers cannot wait for it, so this lives in the registers directory
 * (the coordination rule: new work goes in new directories). If the primitives
 * agent lands theirs later, delete one and re-point the import.
 */

export type DateRangePresetGroup = 'quick' | 'month' | 'quarter' | 'half' | 'year' | 'special'

export interface DateRangePreset {
  id: string
  label: string
  group: DateRangePresetGroup
}

export interface DateRange {
  from: string
  to: string
}

/** What a preset is resolved against. */
export interface DateRangeContext {
  /** ISO date treated as "now". */
  today: string
  /** Active financial year, from CompanyContext.fyRange. */
  fyFrom: string
  fyTo: string
}

export const CUSTOM_PRESET_ID = 'custom'
export const ALL_DATES_PRESET_ID = 'all'
export const DEFAULT_DATE_PRESET_ID = 'fy'

/**
 * The same vocabulary, in the same order and the same Title Case, as
 * books-react-app/web/src/utils/dateRangePresets.js — the period dropdown is
 * the most-used control on a register, and a reader moving between the two
 * products must not have to learn a second set of names.
 *
 * The three additions Books does not have (Last 7 / 30 / 90 Days) are kept:
 * they answer "what moved lately", which is a stock question rather than an
 * accounting one.
 */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: 'today', label: 'Today', group: 'quick' },
  { id: 'yesterday', label: 'Yesterday', group: 'quick' },
  { id: 'this_week', label: 'This Week', group: 'quick' },
  { id: 'this_week_to_date', label: 'This Week-to-date', group: 'quick' },
  { id: 'last_week', label: 'Last Week', group: 'quick' },
  { id: 'last_7', label: 'Last 7 Days', group: 'quick' },
  { id: 'last_30', label: 'Last 30 Days', group: 'quick' },
  { id: 'last_90', label: 'Last 90 Days', group: 'quick' },
  { id: 'this_month', label: 'This Month', group: 'month' },
  { id: 'this_month_to_date', label: 'This Month-to-date', group: 'month' },
  { id: 'last_month', label: 'Last Month', group: 'month' },
  { id: 'this_quarter', label: 'This Quarter (FY)', group: 'quarter' },
  { id: 'this_quarter_to_date', label: 'This Quarter-to-date (FY)', group: 'quarter' },
  { id: 'last_quarter', label: 'Last Quarter (FY)', group: 'quarter' },
  { id: 'this_half_year', label: 'This Half Year (FY)', group: 'half' },
  { id: 'this_half_year_to_date', label: 'This Half Year-to-date (FY)', group: 'half' },
  { id: 'last_half_year', label: 'Last Half Year (FY)', group: 'half' },
  { id: DEFAULT_DATE_PRESET_ID, label: 'This FY', group: 'year' },
  { id: 'fy_to_date', label: 'This FY-to-date', group: 'year' },
  { id: 'last_fy', label: 'Last FY', group: 'year' },
  { id: ALL_DATES_PRESET_ID, label: 'All Dates', group: 'special' },
  { id: CUSTOM_PRESET_ID, label: 'Custom…', group: 'special' },
]

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value)
}

/** Days since the epoch — the only arithmetic base used here. */
function toDayNumber(iso: string): number | null {
  if (!isIsoDate(iso)) return null
  const ms = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null
}

function fromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = toDayNumber(iso)
  return d === null ? '' : fromDayNumber(d + days)
}

/** Whole days from `from` to `to`, inclusive of neither end. */
export function daysBetween(from: string, to: string): number | null {
  const a = toDayNumber(from)
  const b = toDayNumber(to)
  return a === null || b === null ? null : b - a
}

function parts(iso: string): { y: number; m: number; d: number } | null {
  if (!isIsoDate(iso)) return null
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) }
}

function build(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function startOfMonth(iso: string): string {
  const p = parts(iso)
  return p ? build(p.y, p.m, 1) : ''
}

export function endOfMonth(iso: string): string {
  const p = parts(iso)
  return p ? build(p.y, p.m, daysInMonth(p.y, p.m)) : ''
}

/** Whole months from `from` to `iso`, signed. */
function monthsBetween(from: string, iso: string): number | null {
  const a = parts(from)
  const b = parts(iso)
  if (!a || !b) return null
  return (b.y - a.y) * 12 + (b.m - a.m)
}

/**
 * The start of the financial period of `size` months that `iso` falls in,
 * counted from the financial year's own first month.
 *
 * Anchored to `fyFrom` and never to January: Manage owns the financial year, and
 * for a company whose year starts in July "this quarter" is Jul-Sep, not the
 * calendar Jul-Sep that only coincides by accident. Books labels these "(FY)"
 * for the same reason; it can hardcode April because it is India-only, this
 * cannot because Manage says what the year is.
 */
function startOfFyPeriod(iso: string, fyFrom: string, size: number): string {
  const k = monthsBetween(fyFrom, startOfMonth(iso))
  if (k === null) return ''
  return startOfMonth(shiftMonths(fyFrom, Math.floor(k / size) * size))
}

function endOfFyPeriod(iso: string, fyFrom: string, size: number): string {
  const start = startOfFyPeriod(iso, fyFrom, size)
  return start ? endOfMonth(shiftMonths(start, size - 1)) : ''
}

/** Monday-start weeks, as Books uses. */
export function startOfWeek(iso: string): string {
  const day = toDayNumber(iso)
  if (day === null) return ''
  // Day 0 of the epoch was a Thursday, so +4 puts Sunday at 0.
  const dow = (((day + 4) % 7) + 7) % 7
  return fromDayNumber(day + (dow === 0 ? -6 : 1 - dow))
}

export function endOfWeek(iso: string): string {
  const start = startOfWeek(iso)
  return start ? addDays(start, 6) : ''
}

function shiftMonths(iso: string, months: number): string {
  const p = parts(iso)
  if (!p) return ''
  const zero = p.y * 12 + (p.m - 1) + months
  const y = Math.floor(zero / 12)
  const m = (zero % 12) + 1
  return build(y, m, Math.min(p.d, daysInMonth(y, m)))
}

/** The earlier of `a` and `b`, ignoring empties. */
function min(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

/**
 * The range a preset resolves to.
 *
 * `custom` returns null — the caller keeps whatever the reader typed.
 * `all` returns empty bounds, which every Inventory endpoint reads as "no date
 * filter" (the query builder drops empty values).
 */
export function getDateRangeForPreset(
  presetId: string,
  ctx: DateRangeContext,
): DateRange | null {
  const today = isIsoDate(ctx.today) ? ctx.today : ''
  const fyFrom = isIsoDate(ctx.fyFrom) ? ctx.fyFrom : ''
  const fyTo = isIsoDate(ctx.fyTo) ? ctx.fyTo : ''

  switch (presetId) {
    case CUSTOM_PRESET_ID:
      return null
    case ALL_DATES_PRESET_ID:
      return { from: '', to: '' }
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const d = addDays(today, -1)
      return { from: d, to: d }
    }
    case 'last_7':
      return { from: addDays(today, -6), to: today }
    case 'last_30':
      return { from: addDays(today, -29), to: today }
    case 'last_90':
      return { from: addDays(today, -89), to: today }
    case 'this_week':
      return { from: startOfWeek(today), to: endOfWeek(today) }
    case 'this_week_to_date':
      return { from: startOfWeek(today), to: today }
    case 'last_week': {
      const prev = addDays(startOfWeek(today), -1)
      return { from: startOfWeek(prev), to: endOfWeek(prev) }
    }
    case 'this_month':
      return { from: startOfMonth(today), to: endOfMonth(today) }
    case 'this_month_to_date':
      return { from: startOfMonth(today), to: today }
    case 'last_month': {
      const prev = shiftMonths(startOfMonth(today), -1)
      return { from: startOfMonth(prev), to: endOfMonth(prev) }
    }
    case 'this_quarter':
      return { from: startOfFyPeriod(today, fyFrom, 3), to: endOfFyPeriod(today, fyFrom, 3) }
    case 'this_quarter_to_date':
      return { from: startOfFyPeriod(today, fyFrom, 3), to: today }
    case 'last_quarter': {
      const prev = addDays(startOfFyPeriod(today, fyFrom, 3), -1)
      return { from: startOfFyPeriod(prev, fyFrom, 3), to: endOfFyPeriod(prev, fyFrom, 3) }
    }
    case 'this_half_year':
      return { from: startOfFyPeriod(today, fyFrom, 6), to: endOfFyPeriod(today, fyFrom, 6) }
    case 'this_half_year_to_date':
      return { from: startOfFyPeriod(today, fyFrom, 6), to: today }
    case 'last_half_year': {
      const prev = addDays(startOfFyPeriod(today, fyFrom, 6), -1)
      return { from: startOfFyPeriod(prev, fyFrom, 6), to: endOfFyPeriod(prev, fyFrom, 6) }
    }
    case DEFAULT_DATE_PRESET_ID:
      return { from: fyFrom, to: fyTo }
    case 'fy_to_date':
      // Never past today: a register that runs to the end of a future FY reads
      // as though the missing months had no movements, which is a lie.
      return { from: fyFrom, to: min(fyTo, today) || fyTo }
    case 'last_fy':
      // The year-on-year comparison, off the real year Manage gave us rather
      // than a guess at where April falls.
      return { from: shiftMonths(fyFrom, -12), to: shiftMonths(fyTo, -12) }
    default:
      return null
  }
}

/**
 * Which preset a concrete range corresponds to, or `custom`.
 *
 * Order matters only for presets that can coincide (FY and FY-to-date on the
 * last day of the year); the list is walked in declaration order so the more
 * specific "This FY" wins, which is what the reader picked to get there.
 */
export function matchDateRangePreset(
  from: string,
  to: string,
  ctx: DateRangeContext,
): string {
  if (!from && !to) return ALL_DATES_PRESET_ID
  for (const preset of DATE_RANGE_PRESETS) {
    if (preset.id === CUSTOM_PRESET_ID || preset.id === ALL_DATES_PRESET_ID) continue
    const range = getDateRangeForPreset(preset.id, ctx)
    if (range && range.from === from && range.to === to) return preset.id
  }
  return CUSTOM_PRESET_ID
}

/** Human label for a resolved range, for the print / export header. */
export function describeDateRange(from: string, to: string): string {
  if (!from && !to) return 'All dates'
  if (from && !to) return `From ${from}`
  if (!from && to) return `Up to ${to}`
  if (from === to) return from
  return `${from} to ${to}`
}
