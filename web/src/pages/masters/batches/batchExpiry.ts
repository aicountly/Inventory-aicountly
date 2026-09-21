/**
 * How a batch is graded on the Batches screen, and the date arithmetic behind
 * it.
 *
 * PRESENTATION ONLY. Nothing here is persisted, and nothing here overrides the
 * domain: `inv_batches.status` is the stored, authoritative state and it wins
 * whenever it is anything other than `active`. An active batch is then graded
 * by its expiry date, because "this lot runs out in nine days" is the one thing
 * a stock controller needs to see without opening the row — and the server does
 * not store it, since it would be wrong by tomorrow.
 *
 * The same rule is computed server-side for the summary figures
 * (server-php/app/Controllers/Api/V1/BatchesController::summary). The two must
 * agree: a card that counts twelve expiring batches over a table that badges
 * eleven is a screen the reader stops believing. Change one, change both.
 */

import type { BadgeTone } from '../../../ui/Badge'

export type BatchState = 'active' | 'expiring_soon' | 'expired' | 'inactive'

/** The amber band's width, in days. Mirrors `BatchesController::EXPIRY_WINDOW_DAYS`. */
export const EXPIRY_WINDOW_DAYS = 30

const MS_PER_DAY = 86_400_000

/** A `YYYY-MM-DD` (or ISO timestamp) as a UTC midnight, or null if unusable. */
export function parseIsoDate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  // Rejects 2025-02-31 and friends: legacy rows carry dates the database
  // accepted as text and JavaScript would silently roll into March.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null
  return Number.isNaN(ms) ? null : ms
}

/**
 * Whole days from `today` to `date`. Negative once the date has passed, null
 * when either date is missing or malformed.
 */
export function daysUntil(date: unknown, today: string): number | null {
  const target = parseIsoDate(date)
  const from = parseIsoDate(today)
  if (target === null || from === null) return null
  return Math.round((target - from) / MS_PER_DAY)
}

export interface GradableBatch {
  status?: string | null
  expiry_date?: string | null
}

/**
 * The four states the screen shows. `windowDays` is the server's own window,
 * echoed in the summary response, so narrowing it there narrows it here too.
 */
export function batchState(row: GradableBatch, today: string, windowDays = EXPIRY_WINDOW_DAYS): BatchState {
  const status = String(row.status ?? 'active').toLowerCase()
  if (status === 'expired') return 'expired'
  if (status !== 'active') return 'inactive'
  const days = daysUntil(row.expiry_date, today)
  if (days === null) return 'active'
  if (days < 0) return 'expired'
  if (days <= windowDays) return 'expiring_soon'
  return 'active'
}

export const BATCH_STATE_LABEL: Record<BatchState, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  inactive: 'Inactive',
}

export const BATCH_STATE_TONE: Record<BatchState, BadgeTone> = {
  active: 'success',
  expiring_soon: 'warning',
  expired: 'danger',
  inactive: 'neutral',
}

/**
 * The words under the expiry date: "in 9 days", "12 days ago", "Today".
 *
 * Text, not only colour — an expiry that is only ever red is invisible to a
 * reader who cannot see red, and unreadable in a printed sheet.
 */
export function expiryCaption(date: unknown, today: string): string | null {
  const days = daysUntil(date, today)
  if (days === null) return null
  if (days === 0) return 'Expires today'
  if (days < 0) {
    const ago = Math.abs(days)
    return ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago`
  }
  if (days === 1) return 'Expires tomorrow'
  if (days <= 60) return `In ${days} days`
  const months = Math.round(days / 30)
  return months < 24 ? `In ~${months} months` : `In ~${Math.round(days / 365)} years`
}

export type ExpiryBand = 'expired' | 'within_30' | 'days_31_90' | 'days_91_180' | 'beyond_180' | 'no_expiry'

/** Which timeline bucket an expiry date falls in. Mirrors the summary's buckets. */
export function expiryBand(date: unknown, today: string): ExpiryBand {
  const days = daysUntil(date, today)
  if (days === null) return 'no_expiry'
  if (days < 0) return 'expired'
  if (days <= 30) return 'within_30'
  if (days <= 90) return 'days_31_90'
  if (days <= 180) return 'days_91_180'
  return 'beyond_180'
}

export type ExpiryPreset = '' | 'expired' | 'd7' | 'd30' | 'd60' | 'd90' | 'none' | 'custom'

export const EXPIRY_PRESETS: { value: ExpiryPreset; label: string }[] = [
  { value: '', label: 'All expiry dates' },
  { value: 'expired', label: 'Already expired' },
  { value: 'd7', label: 'Next 7 days' },
  { value: 'd30', label: 'Next 30 days' },
  { value: 'd60', label: 'Next 60 days' },
  { value: 'd90', label: 'Next 90 days' },
  { value: 'none', label: 'No expiry date' },
  { value: 'custom', label: 'Custom range…' },
]

export interface ExpiryRange {
  expiry_from: string
  expiry_to: string
  /** `'0'` asks the API for rows with no expiry date at all. */
  has_expiry: string
}

const EMPTY_RANGE: ExpiryRange = { expiry_from: '', expiry_to: '', has_expiry: '' }

/** Shift an ISO date by whole days, staying in UTC so no timezone can roll it. */
export function addDays(today: string, days: number): string {
  const base = parseIsoDate(today)
  if (base === null) return ''
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * A preset as the date range the API is actually sent.
 *
 * "Next 30 days" deliberately starts today rather than yesterday: a batch that
 * expired last week belongs under "Already expired", and showing it under both
 * would double-count it against the card above.
 */
export function expiryPresetRange(preset: ExpiryPreset, today: string): ExpiryRange {
  switch (preset) {
    case 'expired':
      return { ...EMPTY_RANGE, expiry_to: addDays(today, -1) }
    case 'd7':
      return { ...EMPTY_RANGE, expiry_from: today, expiry_to: addDays(today, 7) }
    case 'd30':
      return { ...EMPTY_RANGE, expiry_from: today, expiry_to: addDays(today, 30) }
    case 'd60':
      return { ...EMPTY_RANGE, expiry_from: today, expiry_to: addDays(today, 60) }
    case 'd90':
      return { ...EMPTY_RANGE, expiry_from: today, expiry_to: addDays(today, 90) }
    case 'none':
      return { ...EMPTY_RANGE, has_expiry: '0' }
    default:
      return EMPTY_RANGE
  }
}

/** Which preset a stored range came back as, so a shared URL restores the control. */
export function expiryPresetFromRange(range: Partial<ExpiryRange>, today: string): ExpiryPreset {
  const from = range.expiry_from ?? ''
  const to = range.expiry_to ?? ''
  if (range.has_expiry === '0') return 'none'
  if (!from && !to) return ''
  for (const preset of ['expired', 'd7', 'd30', 'd60', 'd90'] as const) {
    const candidate = expiryPresetRange(preset, today)
    if (candidate.expiry_from === from && candidate.expiry_to === to) return preset
  }
  return 'custom'
}
