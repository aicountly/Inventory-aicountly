/** Pure helpers behind the report screens (unit-tested). */

import type { Tone } from '../components/StatusBadge'
import type { AgeBucketKey, MovementClass } from '../services/reportsApi'
import type { CsvColumn, CsvValue } from '../utils/csv'
import type { FilterContext, ReportColumn, ReportFilter } from './types'

export const AGE_BUCKET_ORDER: AgeBucketKey[] = ['0_30', '31_60', '61_90', '91_180', '180_plus']
export const AGE_BUCKET_LABELS: Record<AgeBucketKey, string> = { '0_30': '0-30 days', '31_60': '31-60 days', '61_90': '61-90 days', '91_180': '91-180 days', '180_plus': '180+ days' }

export const MOVEMENT_CLASS_ORDER: MovementClass[] = ['fast', 'slow', 'non_moving', 'dead']
export const MOVEMENT_CLASS_LABELS: Record<MovementClass, string> = { fast: 'Fast moving', slow: 'Slow moving', non_moving: 'Non-moving', dead: 'Dead stock' }
export const MOVEMENT_CLASS_TONES: Record<MovementClass, Tone> = { fast: 'good', slow: 'info', non_moving: 'warning', dead: 'critical' }

/** Scalars pass through; arrays join; objects become JSON. */
export function rawCsvValue(value: unknown): CsvValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join('; ')
  return JSON.stringify(value)
}

/** CSV columns derived from the table columns, so the export matches the screen. */
export function csvColumnsFromTable<T>(columns: readonly ReportColumn<T>[]): CsvColumn<T>[] {
  return columns.map((c) => ({
    header: c.csvHeader ?? (typeof c.header === 'string' ? c.header : c.key),
    value: c.csv ?? ((row: T) => rawCsvValue((row as Record<string, unknown>)[c.key])),
  }))
}

/**
 * Effective filter values: what the URL says wins; otherwise a toggle falls
 * back to its default state and a date / number / select to its default value.
 */
export function resolveFilterValues(filters: readonly ReportFilter[], urlFilters: Record<string, string>, ctx: FilterContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of filters) {
    const fromUrl = urlFilters[f.key]
    if (fromUrl !== undefined && fromUrl !== '') {
      out[f.key] = fromUrl
      continue
    }
    if (f.kind === 'toggle') {
      out[f.key] = f.defaultOn ? '1' : '0'
      continue
    }
    if (f.defaultValue) {
      const d = f.defaultValue(ctx)
      if (d) out[f.key] = d
    }
  }
  return out
}

/** Default reporting period: the financial year, but never past today. */
export function defaultPeriod(fyRange: { from: string; to: string }, today: string): { from: string; to: string } {
  const to = fyRange.to && fyRange.to < today ? fyRange.to : today
  const from = fyRange.from && fyRange.from <= to ? fyRange.from : ''
  return { from, to }
}

export function expiryTone(daysToExpiry: number | null, expired: boolean): Tone {
  if (expired || (daysToExpiry !== null && daysToExpiry < 0)) return 'critical'
  if (daysToExpiry !== null && daysToExpiry <= 30) return 'warning'
  return 'good'
}

export function sumBy<T>(rows: readonly T[], pick: (row: T) => unknown): number {
  let total = 0
  for (const r of rows) {
    const n = Number(pick(r))
    if (Number.isFinite(n)) total += n
  }
  return Math.round(total * 10000) / 10000
}
