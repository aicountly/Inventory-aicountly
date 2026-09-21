/**
 * The date windows the Live Stock Insight card reads over, and the change
 * between two of them. Pure so the arithmetic is unit-tested rather than
 * eyeballed against whatever month it happens to be.
 */

export interface DateWindow {
  from: string
  to: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** Parsed `YYYY-MM-DD`, or null when it is not one. */
function parseIso(iso: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

/**
 * The calendar month `iso` falls in, whole.
 *
 * Whole, not to-date: the card says "this month", and a figure that silently
 * stops at today cannot be reconciled against the month's own register.
 */
export function monthWindow(iso: string): DateWindow | null {
  const parsed = parseIso(iso)
  if (!parsed) return null
  const { year, month } = parsed
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` }
}

/** The calendar month before the one `iso` falls in — the comparison baseline. */
export function previousMonthWindow(iso: string): DateWindow | null {
  const parsed = parseIso(iso)
  if (!parsed) return null
  const year = parsed.month === 1 ? parsed.year - 1 : parsed.year
  const month = parsed.month === 1 ? 12 : parsed.month - 1
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` }
}

/**
 * Percentage change from `previous` to `current`, rounded to whole points.
 *
 * Null when there is no honest answer: a month with nothing in it is not a
 * 100% rise from zero, and "+∞%" beside a KPI is worse than no chip at all.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}
