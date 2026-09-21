/**
 * Everything the Batches workspace decides about a batch before drawing it.
 *
 * Pure functions only, so the arithmetic that positions a donut arc, classifies
 * an expiry date or turns a preset into a date range can be unit tested rather
 * than eyeballed on screen. Nothing here fetches, and nothing here stores: a
 * derived state is computed for the render that needs it and thrown away.
 *
 * The rule the whole file follows: **the API's stored status wins.** Expiry
 * health is presentation — it moves with the calendar, so persisting it would
 * make it wrong overnight — but where the server has said `quarantine`,
 * `recalled` or `closed`, the chip says that word and not a euphemism.
 */

import type { BadgeTone } from '../../../ui/Badge'
import type { BatchExpiryBuckets, BatchHealth, BatchSummary } from '../../../services/batchesApi'
import type { Batch } from '../../../services/masters'
import { humanize } from '../../../utils/format'

/** Statuses that take a batch out of circulation without the calendar's help. */
export const DORMANT_STATUSES = ['quarantine', 'recalled', 'closed'] as const

/** The window the screen calls "expiring soon" until the API says otherwise. */
export const DEFAULT_NEAR_EXPIRY_DAYS = 30

const MS_PER_DAY = 86_400_000

/** `2026-09-18` → a UTC timestamp, or null for anything that is not a date. */
function parseIsoDate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/**
 * Whole days from `today` to `date`. Negative once the date has passed, null
 * when either side is missing or unparseable (legacy rows carry both).
 */
export function daysUntil(date: unknown, today: string): number | null {
  const target = parseIsoDate(date)
  const from = parseIsoDate(today)
  if (target === null || from === null) return null
  return Math.round((target - from) / MS_PER_DAY)
}

/**
 * The batch's health, derived exactly as the API derives it so a filtered list
 * and the badge on its rows can never disagree.
 *
 * The order is the point: expired beats everything, then a dormant status, then
 * the warning window. The four are mutually exclusive and exhaust the set.
 */
export function batchHealth(
  row: Pick<Batch, 'status' | 'expiry_date'>,
  today: string,
  nearExpiryDays = DEFAULT_NEAR_EXPIRY_DAYS,
): BatchHealth {
  const status = String(row.status ?? '').toLowerCase()
  const days = daysUntil(row.expiry_date, today)
  if (status === 'expired' || (days !== null && days < 0)) return 'expired'
  if ((DORMANT_STATUSES as readonly string[]).includes(status)) return 'inactive'
  if (days !== null && days <= nearExpiryDays) return 'expiring'
  return 'active'
}

export interface BatchStatusChip {
  health: BatchHealth
  /** The word on the chip. Never a euphemism for a status the API sent. */
  label: string
  tone: BadgeTone
  /** Read out instead of the chip, so expiry is never colour alone. */
  srText: string
}

/**
 * One chip per row, and the sentence a screen reader hears instead.
 *
 * A dormant batch keeps its own word — "Quarantine", not "Inactive" — because
 * the three mean different things to whoever has to act on the row.
 */
export function batchStatusChip(
  row: Pick<Batch, 'status' | 'expiry_date'>,
  today: string,
  nearExpiryDays = DEFAULT_NEAR_EXPIRY_DAYS,
): BatchStatusChip {
  const health = batchHealth(row, today, nearExpiryDays)
  const days = daysUntil(row.expiry_date, today)
  const stored = humanize(row.status) || 'Unknown'

  if (health === 'expired') {
    const ago = days !== null && days < 0 ? ` ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` : ''
    return {
      health,
      label: 'Expired',
      tone: 'danger',
      srText: days !== null && days < 0 ? `Expired${ago}` : `Status ${stored}`,
    }
  }
  if (health === 'inactive') {
    return { health, label: stored, tone: 'neutral', srText: `Status ${stored}` }
  }
  if (health === 'expiring') {
    return {
      health,
      label: 'Expiring soon',
      tone: 'warning',
      srText: days === null ? 'Expiring soon' : `Expires in ${days} day${days === 1 ? '' : 's'}`,
    }
  }
  return { health, label: 'Active', tone: 'success', srText: 'Active' }
}

export type ExpiryBand = 'expired' | 'critical' | 'warning' | 'caution' | 'healthy' | 'none'

/** Which band an expiry date falls in — the colour behind the "in 42 d" note. */
export function expiryBand(days: number | null, nearExpiryDays = DEFAULT_NEAR_EXPIRY_DAYS): ExpiryBand {
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= nearExpiryDays) return 'critical'
  if (days <= 90) return 'warning'
  if (days <= 180) return 'caution'
  return 'healthy'
}

/** `in 42 d` / `12 d ago` / `today`. Empty when there is no expiry date. */
export function expiryNote(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'today'
  if (days < 0) return `${Math.abs(days)} d ago`
  return `in ${days} d`
}

// ---------------------------------------------------------------------------
// Expiry presets — one URL value, resolved into API parameters
// ---------------------------------------------------------------------------

export type ExpiryPreset = '' | 'expired' | 'd7' | 'd30' | 'd60' | 'd90' | 'none' | 'custom'

export const EXPIRY_PRESETS: readonly { value: ExpiryPreset; label: string }[] = [
  { value: '', label: 'All expiry dates' },
  { value: 'expired', label: 'Already expired' },
  { value: 'd7', label: 'Next 7 days' },
  { value: 'd30', label: 'Next 30 days' },
  { value: 'd60', label: 'Next 60 days' },
  { value: 'd90', label: 'Next 90 days' },
  { value: 'none', label: 'No expiry date' },
  { value: 'custom', label: 'Custom range…' },
]

/** `2026-09-18` + 30 → `2026-10-18`. UTC throughout; no local-midnight drift. */
export function shiftIso(today: string, days: number): string {
  const from = parseIsoDate(today)
  if (from === null) return today
  return new Date(from + days * MS_PER_DAY).toISOString().slice(0, 10)
}

export interface ExpiryQuery {
  expiry_from?: string
  expiry_to?: string
  has_expiry?: string
}

/**
 * A preset as API parameters.
 *
 * `custom` resolves to nothing — the two date inputs carry it, so the preset is
 * only the label on the control. `expired` stops at yesterday so a batch
 * expiring today is "expiring", not already gone, which is what the row badge
 * says too.
 */
export function resolveExpiryPreset(preset: string, today: string): ExpiryQuery {
  switch (preset) {
    case 'expired':
      return { expiry_to: shiftIso(today, -1), has_expiry: '1' }
    case 'd7':
      return { expiry_from: today, expiry_to: shiftIso(today, 7) }
    case 'd30':
      return { expiry_from: today, expiry_to: shiftIso(today, 30) }
    case 'd60':
      return { expiry_from: today, expiry_to: shiftIso(today, 60) }
    case 'd90':
      return { expiry_from: today, expiry_to: shiftIso(today, 90) }
    case 'none':
      return { has_expiry: '0' }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Analytics geometry
// ---------------------------------------------------------------------------

export interface HealthSegment {
  key: BatchHealth
  label: string
  value: number
  /** Share of the circle, 0-100. */
  percent: number
  /** Where the arc starts, 0-100 clockwise from 12 o'clock. */
  offset: number
  /** Tailwind text colour; the arc strokes `currentColor`. */
  arcClass: string
  dotClass: string
}

const HEALTH_ORDER: readonly { key: BatchHealth; label: string; arcClass: string; dotClass: string }[] = [
  { key: 'active', label: 'Active', arcClass: 'text-primary', dotClass: 'bg-primary' },
  { key: 'expiring', label: 'Expiring soon', arcClass: 'text-amber-500', dotClass: 'bg-amber-500' },
  { key: 'expired', label: 'Expired', arcClass: 'text-red-500', dotClass: 'bg-red-500' },
  { key: 'inactive', label: 'Inactive', arcClass: 'text-slate-400', dotClass: 'bg-slate-400' },
]

/**
 * The ring, in a FIXED order with fixed colours.
 *
 * Deliberately not the dashboard's `donutArcs`, which sorts slices by size and
 * indexes into a categorical palette: here the colour carries the meaning —
 * green is healthy, red is expired — and a legend that reorders itself between
 * two companies is a legend nobody can learn. Zero-value states keep their
 * legend row (the reader needs to see the zero) but draw no arc.
 */
export function healthSegments(summary: BatchSummary | null): HealthSegment[] {
  const counts: Record<BatchHealth, number> = {
    active: summary?.active ?? 0,
    expiring: summary?.expiring_soon ?? 0,
    expired: summary?.expired ?? 0,
    inactive: summary?.inactive ?? 0,
  }
  const sum = HEALTH_ORDER.reduce((acc, s) => acc + Math.max(0, counts[s.key]), 0)
  let offset = 0
  return HEALTH_ORDER.map((s) => {
    const value = Math.max(0, counts[s.key])
    const percent = sum > 0 ? (value / sum) * 100 : 0
    const segment: HealthSegment = { ...s, value, percent, offset }
    offset += percent
    return segment
  })
}

export interface ExpiryTimelineRow {
  key: keyof BatchExpiryBuckets
  label: string
  count: number
  /** Share of the LARGEST bucket, 0-100 — the bar's width, not a percentage. */
  scale: number
  barClass: string
}

const TIMELINE_ORDER: readonly { key: keyof BatchExpiryBuckets; label: string; barClass: string; onlyWhenSet?: boolean }[] = [
  { key: 'expired', label: 'Already expired', barClass: 'bg-red-600', onlyWhenSet: true },
  { key: 'within_30', label: 'Within 30 days', barClass: 'bg-red-500' },
  { key: 'days_31_90', label: '31 – 90 days', barClass: 'bg-orange-500' },
  { key: 'days_91_180', label: '91 – 180 days', barClass: 'bg-amber-500' },
  { key: 'beyond_180', label: 'Over 180 days', barClass: 'bg-primary' },
  { key: 'no_expiry', label: 'No expiry date', barClass: 'bg-slate-300', onlyWhenSet: true },
]

/**
 * The timeline rows. The bar is scaled against the biggest bucket so the small
 * urgent ones stay visible beside a bucket holding most of the master — it is a
 * visual classification, not a percentage, and the card says so.
 */
export function expiryTimelineRows(buckets: BatchExpiryBuckets | null): ExpiryTimelineRow[] {
  if (!buckets) return []
  const rows = TIMELINE_ORDER.filter((r) => !r.onlyWhenSet || (buckets[r.key] ?? 0) > 0)
  const max = rows.reduce((acc, r) => Math.max(acc, buckets[r.key] ?? 0), 0)
  return rows.map((r) => {
    const count = buckets[r.key] ?? 0
    return {
      key: r.key,
      label: r.label,
      count,
      scale: max > 0 && count > 0 ? Math.max(4, (count / max) * 100) : 0,
      barClass: r.barClass,
    }
  })
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** "Main Warehouse" / "Main Warehouse +2", or null when nothing is recorded. */
export function warehouseLabel(row: Batch): { name: string; extra: number } | null {
  const list = row.warehouses ?? []
  const first = list[0]
  if (!first) return null
  const name = first.warehouse_name || (first.warehouse_id ? `#${first.warehouse_id}` : 'Unassigned')
  return { name, extra: Math.max(0, (row.warehouse_count ?? list.length) - 1) }
}

/** The item's secondary line: stock category, then item group, then the SKU. */
export function itemSubtitle(row: Batch): string {
  return row.stock_category_name || row.item_group_name || row.item_sku || ''
}

/** Initials for the thumbnail tile. Items carry no image, so none is invented. */
export function itemInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
