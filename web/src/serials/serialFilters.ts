/**
 * The serial workspace's filter state: what lives in the URL, what the API is
 * asked for, and what the chips above the table say.
 *
 * All of it is pure. The page owns the URL through `useListParams` and the
 * lookups through `useFormOptions`; this file turns those two into a query and
 * into a row of removable chips, so "which filters are on" has exactly one
 * answer and the chip that says `Warehouse: Main Warehouse` removes the same
 * parameter the request sent.
 */

import type { SerialQuery } from '../services/masters'

/**
 * Filters kept in the query string.
 *
 * `view` is in the list because `useListParams` only preserves keys it is told
 * about, and the table / card toggle has to survive a reload like everything
 * else. It is stripped again before the request: the server has no opinion
 * about how its rows are drawn.
 */
export const SERIAL_FILTER_KEYS = [
  'status',
  'item_id',
  'warehouse_id',
  'location_id',
  'batch_id',
  'item_grp_id',
  'brand_id',
  'stock_cat_id',
  'warranty_status',
  'warranty_days',
  'warranty_from',
  'warranty_to',
  'created_from',
  'created_to',
  'updated_from',
  'updated_to',
  'cost_min',
  'cost_max',
  'has_batch',
  'placed',
  'view',
] as const

export type SerialFilterKey = (typeof SERIAL_FILTER_KEYS)[number]

/** UI-only keys: they shape the screen, never the request. */
const VIEW_ONLY_KEYS: readonly string[] = ['view']

/**
 * The four filters that sit on the toolbar itself. Everything else is behind
 * "More filters", and the chip row is what makes those visible once set — a
 * filter a reader cannot see is a filter they will blame the data for.
 */
export const PRIMARY_FILTER_KEYS: readonly SerialFilterKey[] = [
  'status',
  'item_id',
  'warehouse_id',
  'location_id',
]

export const SERIAL_FILTER_LABEL: Record<SerialFilterKey, string> = {
  status: 'Status',
  item_id: 'Item',
  warehouse_id: 'Warehouse',
  location_id: 'Location',
  batch_id: 'Batch',
  item_grp_id: 'Item group',
  brand_id: 'Brand',
  stock_cat_id: 'Stock category',
  warranty_status: 'Warranty',
  warranty_days: 'Warranty window',
  warranty_from: 'Warranty from',
  warranty_to: 'Warranty until',
  created_from: 'Created from',
  created_to: 'Created to',
  updated_from: 'Updated from',
  updated_to: 'Updated to',
  cost_min: 'Unit cost from',
  cost_max: 'Unit cost to',
  has_batch: 'Batch tracking',
  placed: 'Placement',
  view: 'View',
}

const FIXED_VALUE_LABELS: Partial<Record<SerialFilterKey, Record<string, string>>> = {
  warranty_status: {
    active: 'Active',
    expiring: 'Expiring soon',
    expired: 'Expired',
    none: 'Not recorded',
  },
  has_batch: { '1': 'Has a batch', '0': 'No batch' },
  placed: { '1': 'In a warehouse', '0': 'Not placed' },
}

export interface SerialFilterChip {
  /** The parameter to delete when the chip's × is pressed. */
  key: SerialFilterKey
  /** "Warehouse" */
  label: string
  /** "Main Warehouse" */
  value: string
}

/** Lookups the page already holds: `{warehouse_id: {'12': 'Main Warehouse'}}`. */
export type SerialFilterNames = Partial<Record<SerialFilterKey, Record<string, string>>>

/**
 * One chip per filter that is actually on.
 *
 * A filter whose display name is not known yet (the warehouse list is still in
 * flight) still gets a chip, carrying its raw value. The alternative is a chip
 * that appears a second after the rows change, which reads as the table having
 * filtered itself.
 */
export function serialFilterChips(
  filters: Record<string, string>,
  names: SerialFilterNames = {},
): SerialFilterChip[] {
  const chips: SerialFilterChip[] = []
  for (const key of SERIAL_FILTER_KEYS) {
    if (VIEW_ONLY_KEYS.includes(key)) continue
    // The warranty window is a parameter OF the warranty filter, not a filter
    // of its own: a chip saying "Warranty window: 90" beside "Warranty:
    // Expiring soon" would offer to remove half of one idea.
    if (key === 'warranty_days') continue
    const raw = filters[key]
    if (raw === undefined || raw === '') continue
    const fixed = FIXED_VALUE_LABELS[key]?.[raw]
    const named = names[key]?.[raw]
    chips.push({ key, label: SERIAL_FILTER_LABEL[key], value: fixed ?? named ?? raw })
  }
  return chips
}

/** How many filters are on — the count on the "More filters" button. */
export function activeFilterCount(filters: Record<string, string>): number {
  return serialFilterChips(filters).length
}

/** True when anything at all narrows the list (a search counts). */
export function hasAnyFilter(filters: Record<string, string>, q: string): boolean {
  return q.trim() !== '' || activeFilterCount(filters) > 0
}

/**
 * The request the table makes: the shared list parameters plus the filters,
 * with the UI-only ones dropped and the empties removed.
 *
 * Empties are removed rather than sent blank because the summary endpoint reads
 * the same parameters: `warehouse_id=` counted as a filter on one side and
 * ignored on the other is exactly how a card comes to disagree with its table.
 */
export function serialListQuery(
  base: SerialQuery,
  filters: Record<string, string>,
): SerialQuery {
  const query: SerialQuery = { ...base }
  for (const [key, value] of Object.entries(filters)) {
    if (VIEW_ONLY_KEYS.includes(key)) continue
    if (value === undefined || value === '') continue
    ;(query as Record<string, string>)[key] = value
  }
  return query
}

/**
 * The same filters with paging and ordering removed — what the counters ask
 * for. `sort` and `page` cannot change a count, and sending them would make
 * every page turn look like a new question to the browser's cache.
 */
export function serialSummaryQuery(query: SerialQuery): SerialQuery {
  const { page, limit, offset, sort, order, ...rest } = query
  void page
  void limit
  void offset
  void sort
  void order
  return rest
}
