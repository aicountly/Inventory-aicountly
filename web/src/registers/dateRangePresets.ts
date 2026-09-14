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

export type DateRangePresetGroup = 'quick' | 'month' | 'quarter' | 'year' | 'special'

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

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: 'today', label: 'Today', group: 'quick' },
  { id: 'yesterday', label: 'Yesterday', group: 'quick' },
  { id: 'last_7', label: 'Last 7 days', group: 'quick' },
  { id: 'last_30', label: 'Last 30 days', group: 'quick' },
  { id: 'last_90', label: 'Last 90 days', group: 'quick' },
  { id: 'this_month', label: 'This month', group: 'month' },
  { id: 'last_month', label: 'Last month', group: 'month' },
  { id: 'this_quarter', label: 'This quarter', group: 'quarter' },
  { id: 'last_quarter', label: 'Last quarter', group: 'quarter' },
  { id: DEFAULT_DATE_PRESET_ID, label: 'This FY', group: 'year' },
  { id: 'fy_to_date', label: 'FY to date', group: 'year' },
  { id: ALL_DATES_PRESET_ID, label: 'All dates', group: 'special' },
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

/** Calendar quarters (Jan-Mar, Apr-Jun, …), not financial ones. */
export function startOfQuarter(iso: string): string {
  const p = parts(iso)
  if (!p) return ''
  return build(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1)
}

export function endOfQuarter(iso: string): string {
  const p = parts(iso)
  if (!p) return ''
  const m = Math.floor((p.m - 1) / 3) * 3 + 3
  return build(p.y, m, daysInMonth(p.y, m))
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
    case 'this_month':
      return { from: startOfMonth(today), to: endOfMonth(today) }
    case 'last_month': {
      const prev = shiftMonths(startOfMonth(today), -1)
      return { from: startOfMonth(prev), to: endOfMonth(prev) }
    }
    case 'this_quarter':
      return { from: startOfQuarter(today), to: endOfQuarter(today) }
    case 'last_quarter': {
      const prev = shiftMonths(startOfQuarter(today), -3)
      return { from: startOfQuarter(prev), to: endOfQuarter(prev) }
    }
    case DEFAULT_DATE_PRESET_ID:
      return { from: fyFrom, to: fyTo }
    case 'fy_to_date':
      // Never past today: a register that runs to the end of a future FY reads
      // as though the missing months had no movements, which is a lie.
      return { from: fyFrom, to: min(fyTo, today) || fyTo }
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
