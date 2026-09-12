/** Small, pure display formatters shared by lists and forms. */

const QTY_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 })
const MONEY_FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const INT_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

/** Quantities keep up to 4 decimals but drop trailing zeros: 12, 12.5, 0.0001. */
export function formatQty(value: unknown, empty = '—'): string {
  const n = toNumber(value)
  return n === null ? empty : QTY_FORMAT.format(n)
}

/** Money always shows 2 decimals with Indian digit grouping. */
export function formatMoney(value: unknown, empty = '—'): string {
  const n = toNumber(value)
  return n === null ? empty : MONEY_FORMAT.format(n)
}

export function formatInt(value: unknown, empty = '0'): string {
  const n = toNumber(value)
  return n === null ? empty : INT_FORMAT.format(n)
}

/** `2025-04-01` (or a timestamp) → `01 Apr 2025`. Invalid → the empty marker. */
export function formatDate(value: unknown, empty = '—'): string {
  if (value === null || value === undefined || value === '') return empty
  const s = String(value)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return empty
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return empty
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** `2025-04-01 13:45:00` → `01 Apr 2025, 13:45`. */
export function formatDateTime(value: unknown, empty = '—'): string {
  if (value === null || value === undefined || value === '') return empty
  const s = String(value)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return formatDate(value, empty)
  return `${formatDate(value, empty)}, ${m[4]}:${m[5]}`
}

/** `physical_adjustment` → `Physical adjustment`. */
export function humanize(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value).trim()
  if (!s) return ''
  const words = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Truthy for 1 / '1' / true / 'true' / 'yes'. */
export function isOn(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
  return false
}

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
