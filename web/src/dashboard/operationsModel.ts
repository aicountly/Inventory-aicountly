/**
 * Pure transforms behind the Operations dashboard.
 *
 * No React here, so every rule below is unit-testable: which document types a
 * count covers, how a count's completion is expressed, and when a document is
 * genuinely late rather than merely old.
 */

import { drill } from './kpiNavigation'
import { formatCount, percentOf, plural } from './formatters'
import type { CountProgressRow, HourlyBucket, InFlightRow } from './aggregatesApi'

// ---------------------------------------------------------------------------
// Hourly movement
// ---------------------------------------------------------------------------

export interface HourlySeries {
  categories: string[]
  receipts: number[]
  issues: number[]
  transfers: number[]
  adjustments: number[]
  total: number
  busiestHour: number | null
}

/**
 * Turn the server's hourly buckets into four parallel arrays.
 *
 * The server has already dropped hours that have not happened yet, so this does
 * no truncation of its own — it must not, or a dashboard viewed for a past date
 * would lose its evening.
 */
export function hourlySeries(buckets: readonly HourlyBucket[]): HourlySeries {
  const categories = buckets.map((b) => String(b.hour).padStart(2, '0'))
  const receipts = buckets.map((b) => b.receipt)
  const issues = buckets.map((b) => b.issue)
  const transfers = buckets.map((b) => b.transfer)
  const adjustments = buckets.map((b) => b.adjustment)

  let busiestHour: number | null = null
  let busiest = 0
  for (const b of buckets) {
    const n = b.receipt + b.issue + b.transfer + b.adjustment
    if (n > busiest) {
      busiest = n
      busiestHour = b.hour
    }
  }

  return {
    categories,
    receipts,
    issues,
    transfers,
    adjustments,
    total: buckets.reduce((acc, b) => acc + b.receipt + b.issue + b.transfer + b.adjustment, 0),
    busiestHour,
  }
}

/** `14` → `2 PM`, for a sentence rather than an axis. */
export function hourLabel(hour: number): string {
  const h = ((hour + 11) % 12) + 1
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`
}

// ---------------------------------------------------------------------------
// Count progress
// ---------------------------------------------------------------------------

export interface CountProgress {
  key: string
  label: string
  counted: number
  total: number
  /** 0–100. Only ever shown WITH its numerator and denominator beside it. */
  percent: number
  documents: number
  /** True when there is nothing to count — a bar at 0% would be a lie about work. */
  empty: boolean
  to: string
}

/**
 * Completion per warehouse, as a real fraction.
 *
 * A count with no lines on it is `empty`, not `0%`: zero of zero is not "none
 * of the work done", and a progress bar sitting at zero tells a supervisor to
 * go and chase someone who has nothing to do.
 */
export function countProgress(rows: readonly CountProgressRow[]): CountProgress[] {
  return rows
    .map((r) => ({
      key: String(r.warehouse_id ?? 'none'),
      label: r.warehouse_name ?? (r.warehouse_id ? `Warehouse ${r.warehouse_id}` : 'No warehouse'),
      counted: r.counted_lines,
      total: r.total_lines,
      percent: percentOf(r.counted_lines, r.total_lines),
      documents: r.documents,
      empty: r.total_lines === 0,
      to: drill.documents({ documentType: 'PHYSICAL_ADJUSTMENT' }),
    }))
    .sort((a, b) => a.percent - b.percent)
}

/** "412 of 500 lines · 82%" — never a bare percentage. */
export function progressLabel(counted: number, total: number): string {
  if (total === 0) return 'No lines to count'
  return `${formatCount(counted)} of ${formatCount(total)} lines · ${percentOf(counted, total).toFixed(0)}%`
}

// ---------------------------------------------------------------------------
// In-flight documents
// ---------------------------------------------------------------------------

export type Timeliness = InFlightRow['timeliness']

export const TIMELINESS_LABEL: Record<Timeliness, string> = {
  overdue: 'Overdue',
  on_time: 'On time',
  // Not "OK" and not "Overdue": a document with no agreed return date cannot be
  // either, and calling it late because it is old invents an agreement.
  undated: 'No return date',
}

export const TIMELINESS_TONE: Record<Timeliness, 'danger' | 'success' | 'neutral'> = {
  overdue: 'danger',
  on_time: 'success',
  undated: 'neutral',
}

export const PENDING_KIND_LABEL: Record<string, string> = {
  challan: 'Challan',
  deferred_purchase: 'Deferred purchase',
  job_work: 'Job work',
}

export function pendingKindLabel(kind: string): string {
  return PENDING_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')
}

/** "3 challans and 1 job work outstanding" — the in-flight panel's one-liner. */
export function inFlightSummary(byKind: readonly { kind: string; documents: number }[]): string {
  const parts = byKind
    .filter((k) => k.documents > 0)
    .map((k) => plural(k.documents, pendingKindLabel(k.kind).toLowerCase()))
  if (parts.length === 0) return 'Nothing is outstanding'
  if (parts.length === 1) return `${parts[0]} outstanding`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} outstanding`
}
