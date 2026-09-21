/**
 * Server timestamps, read as the clock they were written on.
 *
 * `inv_serials.updated_at` is a bare `YYYY-MM-DD HH:MM:SS` with no zone: the
 * API writes company time. Every engine parses the ISO `T` form as local time
 * and the space-separated form by its own rules, so the space is normalised
 * before parsing rather than left to the browser to guess.
 */

import { formatRelativeTime } from '../utils/relativeTime'

/** Milliseconds for a server timestamp, or null when it is not one. */
export function serverTimeMs(value: string | null | undefined): number | null {
  if (!value) return null
  const normalised = String(value).trim().replace(' ', 'T')
  const t = Date.parse(normalised)
  return Number.isFinite(t) ? t : null
}

/** "2 hours ago" under the absolute date, or null when there is no timestamp. */
export function relativeUpdated(value: string | null | undefined, now: number = Date.now()): string | null {
  return formatRelativeTime(serverTimeMs(value), now)
}
