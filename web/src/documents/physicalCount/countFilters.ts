/**
 * Narrowing the count sheet: the search box, the filter popover, and the
 * "show me those rows" link every insight and exception carries.
 *
 * Client-side, deliberately. The sheet is a SNAPSHOT the operator is editing —
 * counted quantities exist only in the browser until the draft is saved — so a
 * server-side filter could not see the very column most of these filters are
 * about. The set it filters is bounded by the loader's own cap, and the work is
 * one pass over an array the page already holds.
 */

import type { CountRow, CountStatus } from './countModel'

export type CountPreset =
  | 'all'
  | 'variance'
  | 'shortage'
  | 'excess'
  | 'match'
  | 'pending'
  | 'counted'
  | 'exceptions'
  | 'serial'

export const PRESET_LABEL: Record<CountPreset, string> = {
  all: 'All lines',
  variance: 'Variance only',
  shortage: 'Shortage',
  excess: 'Excess',
  match: 'Exact match',
  pending: 'Not counted',
  counted: 'Counted',
  exceptions: 'Needs attention',
  serial: 'Serial checks',
}

/** The presets offered as one-click chips above the table. */
export const QUICK_PRESETS: CountPreset[] = ['all', 'variance', 'shortage', 'excess', 'match', 'pending']

export interface CountFilters {
  search: string
  preset: CountPreset
  warehouseId: number | null
  /** Only lines whose item tracks batches / serials. */
  batchTracked: boolean
  serialTracked: boolean
  /** Only lines whose variance value is at least this, in absolute terms. */
  minVarianceValue: number | null
  /**
   * An explicit row set, from clicking an insight or an exception.
   *
   * Kept apart from the other filters so it can be lifted with one "Clear" and
   * so it survives a preset change: a reader who clicked "5 items with high
   * shrinkage" is looking at those five, not at whatever the preset says.
   */
  lineKeys: string[] | null
  /** What the row set is called, for the chip that clears it. */
  lineKeysLabel: string | null
}

export const DEFAULT_FILTERS: CountFilters = {
  search: '',
  preset: 'all',
  warehouseId: null,
  batchTracked: false,
  serialTracked: false,
  minVarianceValue: null,
  lineKeys: null,
  lineKeysLabel: null,
}

/** How many narrowing choices are on — the number on the Filters button. */
export function activeFilterCount(filters: CountFilters): number {
  let n = 0
  if (filters.preset !== 'all') n += 1
  if (filters.warehouseId !== null) n += 1
  if (filters.batchTracked) n += 1
  if (filters.serialTracked) n += 1
  if (filters.minVarianceValue !== null) n += 1
  if (filters.lineKeys !== null) n += 1
  return n
}

export function hasAnyFilter(filters: CountFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.search.trim() !== ''
}

function matchesPreset(row: CountRow, preset: CountPreset): boolean {
  const status: CountStatus = row.status
  switch (preset) {
    case 'all':
      return true
    case 'variance':
      return row.counted && row.difference !== null && row.difference !== 0
    case 'shortage':
      return row.counted && row.difference !== null && row.difference < 0
    case 'excess':
      return row.counted && row.difference !== null && row.difference > 0
    case 'match':
      return row.counted && row.difference === 0
    case 'pending':
      return !row.counted
    case 'counted':
      return row.counted
    case 'exceptions':
      return row.exceptions.length > 0 || status === 'exception'
    case 'serial':
      return row.exceptions.some((e) => e.kind === 'serial_missing' || e.kind === 'serial_count_mismatch' || e.kind === 'serial_duplicate')
  }
}

/**
 * What the search box looks at: item code, item name, warehouse, batch and the
 * serial numbers already named on the line. A warehouse operator searching for
 * a serial they are holding has to find the row it belongs to.
 */
function haystack(row: CountRow, warehouseName: (id: number | null | undefined) => string): string {
  return [
    row.line.item_sku,
    row.line.item_name,
    row.line.batch_no,
    row.snapshot.warehouseName ?? warehouseName(row.line.warehouse_id),
    ...row.line.serials.map((s) => s.serial_no ?? ''),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function filterRows(
  rows: readonly CountRow[],
  filters: CountFilters,
  warehouseName: (id: number | null | undefined) => string,
): CountRow[] {
  const query = filters.search.trim().toLowerCase()
  const keys = filters.lineKeys ? new Set(filters.lineKeys) : null

  return rows.filter((row) => {
    if (keys && !keys.has(row.line.key)) return false
    if (!matchesPreset(row, filters.preset)) return false
    if (filters.warehouseId !== null && row.line.warehouse_id !== filters.warehouseId) return false
    if (filters.batchTracked && !row.line.track_batch) return false
    if (filters.serialTracked && !row.line.track_serial) return false
    if (filters.minVarianceValue !== null) {
      if (row.varianceValue === null || Math.abs(row.varianceValue) < filters.minVarianceValue) return false
    }
    if (query && !haystack(row, warehouseName).includes(query)) return false
    return true
  })
}
