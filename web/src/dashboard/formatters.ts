/**
 * Dashboard-only formatters. Everything general (formatQty, formatMoney,
 * formatDate, humanize…) stays in src/utils/format.ts — these are the compact
 * forms a dense KPI card needs, ported from
 * books-react-app/web/src/modules/dashboard/formatters.js.
 */

import { toNumber } from '../utils/format'

const CRORE = 1_00_00_000
const LAKH = 1_00_000
const THOUSAND = 1_000

const RUPEE = '₹'

const INR_0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const COUNT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
/* Quantities are not counts: 12.5 kg must not read as 13. Four decimals is the
   precision the API stores and utils/format.formatQty already shows. */
const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 })
const RATIO = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Indian compact currency: ₹1.24 Cr / ₹3.40 L / ₹8.2 K / ₹940.
 *
 * A stock-value card is 150px wide; `₹1,24,35,908.40` does not fit and, read at
 * a glance, the extra digits carry no decision. The full figure is one click
 * away in the register the card links to.
 */
export function formatCurrencyCompact(amount: unknown, empty = '—'): string {
  const n = toNumber(amount)
  if (n === null) return empty
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= CRORE) return `${sign}${RUPEE}${(abs / CRORE).toFixed(2)} Cr`
  if (abs >= LAKH) return `${sign}${RUPEE}${(abs / LAKH).toFixed(2)} L`
  if (abs >= THOUSAND) return `${sign}${RUPEE}${(abs / THOUSAND).toFixed(1)} K`
  return INR_0.format(n)
}

/** Compact quantity: 1.24 Cr / 3.40 L / 8.2 K / 940 — no currency symbol. */
export function formatQtyCompact(qty: unknown, empty = '—'): string {
  const n = toNumber(qty)
  if (n === null) return empty
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= CRORE) return `${sign}${(abs / CRORE).toFixed(2)} Cr`
  if (abs >= LAKH) return `${sign}${(abs / LAKH).toFixed(2)} L`
  if (abs >= THOUSAND) return `${sign}${(abs / THOUSAND).toFixed(1)} K`
  return QTY.format(n)
}

/** Whole-number count with Indian grouping: 12,34,567. */
export function formatCount(value: unknown, empty = '0'): string {
  const n = toNumber(value)
  return n === null ? empty : COUNT.format(n)
}

/** Two-decimal ratio (turnover, days of cover). */
export function formatRatio(value: unknown, empty = '—'): string {
  const n = toNumber(value)
  return n === null ? empty : RATIO.format(n)
}

export function greetingFor(date: Date = new Date()): string {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "just now" / "4m ago" / "3h ago" / "2d ago". */
export function relativeTimeFromNow(date: number | string | Date | null | undefined, now: number = Date.now()): string {
  if (date === null || date === undefined || date === '') return '—'
  const t = typeof date === 'number' ? date : date instanceof Date ? date.getTime() : new Date(date).getTime()
  if (!Number.isFinite(t)) return '—'
  const sec = Math.floor(Math.max(0, now - t) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

/** `part` as a percentage of `total`, clamped to [0, 100]; 0 when total ≤ 0. */
export function percentOf(part: unknown, total: unknown): number {
  const p = toNumber(part) ?? 0
  const t = toNumber(total) ?? 0
  if (t <= 0) return 0
  return Math.min(100, Math.max(0, (p / t) * 100))
}

/** "1 batch" / "4 batches" — dashboards say a lot of these. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${Math.abs(count) === 1 ? one : many}`
}
