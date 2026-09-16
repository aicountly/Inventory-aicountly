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

/**
 * The symbol a currency code is written with, or the code itself.
 *
 * Aicountly is multi-currency: a company's base currency is a setting, not an
 * assumption, so nothing here may hardcode a rupee sign. Intl knows the symbol
 * for every code it recognises; an unrecognised one throws, and falling back to
 * the code prints `XYZ 2.48 Cr`, which is at least true.
 */
const CURRENCY_SYMBOLS = new Map<string, string>()

export function currencySymbol(code: string | null | undefined): string {
  const key = (code || 'INR').trim().toUpperCase()
  const cached = CURRENCY_SYMBOLS.get(key)
  if (cached !== undefined) return cached
  let symbol = key
  try {
    const parts = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: key,
      maximumFractionDigits: 0,
    }).formatToParts(0)
    symbol = parts.find((part) => part.type === 'currency')?.value || key
  } catch {
    symbol = key
  }
  CURRENCY_SYMBOLS.set(key, symbol)
  return symbol
}

/** `2.4800` → `2.48`, `3.00` → `3`. Keeps a short figure short. */
function trimTrailingZeros(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

const CRORE = 1e7
const LAKH = 1e5

/**
 * A large amount shortened to fit a KPI caption: `₹ 2.48 Cr`, `$ 2.48M`.
 *
 * The Indian scale (lakh / crore) travels with the Indian currency rather than
 * with the reader's locale — `₹ 24.8M` would be as wrong for a Mumbai ledger as
 * `$ 2.48 Cr` would be for a New York one. Below the first step the figure is
 * printed in full: rounding ₹84,300 to "0.84 L" loses more than it saves.
 *
 * Only for captions. Anything a reader will add up, reconcile or export goes
 * through formatMoney, which rounds nothing away.
 */
export function formatCompactMoney(value: unknown, currencyCode = 'INR', empty = '—'): string {
  const n = toNumber(value)
  if (n === null) return empty
  const symbol = currencySymbol(currencyCode)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const indian = (currencyCode || 'INR').trim().toUpperCase() === 'INR'
  const steps: { limit: number; suffix: string }[] = indian
    ? [
        { limit: CRORE, suffix: ' Cr' },
        { limit: LAKH, suffix: ' L' },
      ]
    : [
        { limit: 1e9, suffix: 'B' },
        { limit: 1e6, suffix: 'M' },
        { limit: 1e3, suffix: 'K' },
      ]
  for (const step of steps) {
    if (abs >= step.limit) {
      return `${sign}${symbol} ${trimTrailingZeros((abs / step.limit).toFixed(2))}${step.suffix}`
    }
  }
  return `${sign}${symbol} ${INT_FORMAT.format(Math.round(abs))}`
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

/**
 * `15 Sep 2026, 09:00` — *now*, on the reader's own clock.
 *
 * Everything else here formats a timestamp the server already sent in company
 * time. This one stamps the moment a document is printed, signed and handed
 * over, so it has to read as the clock on the wall: taken from the UTC instant
 * it is 5h30m out in India, and anything printed after 18:30 IST carries
 * yesterday's date on paper.
 */
export function formatGeneratedStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return formatDateTime(
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
  )
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
