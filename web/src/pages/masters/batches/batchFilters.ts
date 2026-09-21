/**
 * What the Batches screen can be narrowed by, and how a narrowing is described
 * in words.
 *
 * Pure, because two things depend on getting it exactly right: the count on the
 * "More filters" button (a reader who cannot see why a list is short will not
 * think to look inside a collapsed panel) and the header of an exported sheet,
 * which has to say which filters produced the rows in it. A sheet that claims
 * 4,182 batches when it holds the twelve expiring ones is a document that
 * misleads whoever it is handed to.
 */

import { BATCH_STATE_LABEL } from './batchExpiry'
import type { BatchState } from './batchExpiry'
import { EXPIRY_PRESETS } from './batchExpiry'
import { formatDate, humanize } from '../../../utils/format'

/**
 * Every filter kept in the query string. `useListParams` reads exactly these
 * out of the URL, so a key missing here is a filter that silently vanishes on
 * reload.
 */
export const BATCH_FILTER_KEYS = [
  'state',
  'status',
  'item_id',
  'warehouse_id',
  'warehouse_group_id',
  'item_grp_id',
  'stock_cat_id',
  'brand_id',
  'lot_no',
  'stock',
  'expiry',
  'expiry_from',
  'expiry_to',
  'has_expiry',
  'mfg_from',
  'mfg_to',
] as const

/**
 * The ones the toolbar shows a control for. Anything else is behind "More
 * filters", and it is that panel's badge that counts them.
 */
const PRIMARY_KEYS = new Set(['state', 'item_id', 'warehouse_id', 'expiry'])

/** `expiry` drives `expiry_from`/`expiry_to`; counting all three would treble it. */
const DERIVED_KEYS = new Set(['expiry_from', 'expiry_to', 'has_expiry'])

export type BatchFilterValues = Partial<Record<(typeof BATCH_FILTER_KEYS)[number], string>>

export function activeAdvancedCount(filters: BatchFilterValues): number {
  return Object.entries(filters).filter(
    ([key, value]) => Boolean(value) && !PRIMARY_KEYS.has(key) && !DERIVED_KEYS.has(key),
  ).length
}

export function hasAnyFilter(filters: BatchFilterValues, q: string): boolean {
  return Boolean(q) || Object.values(filters).some(Boolean)
}

/** Names for the ids held in the URL, so a line reads "Warehouse: Main", not "#3". */
export interface BatchFilterLabels {
  item?: string
  warehouse?: string
  warehouseGroup?: string
  itemGroup?: string
  stockCategory?: string
  brand?: string
}

/**
 * One line per active filter, in the order the toolbar presents them.
 *
 * An id with no name resolved yet prints as `#3` rather than being dropped: a
 * sheet that omits a filter it was actually narrowed by is worse than one that
 * names it awkwardly.
 */
export function describeFilters(
  filters: BatchFilterValues,
  q: string,
  labels: BatchFilterLabels = {},
): string[] {
  const lines: string[] = []
  const push = (label: string, value: string | undefined | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  const named = (id: string | undefined, name: string | undefined) =>
    id ? (name ?? `#${id}`) : undefined

  push('Search', q)
  push('Status', filters.state ? BATCH_STATE_LABEL[filters.state as BatchState] : undefined)
  push('Batch status', filters.status ? humanize(filters.status) : undefined)
  push('Item', named(filters.item_id, labels.item))
  push('Warehouse', named(filters.warehouse_id, labels.warehouse))
  push('Warehouse group', named(filters.warehouse_group_id, labels.warehouseGroup))
  push('Item group', named(filters.item_grp_id, labels.itemGroup))
  push('Stock category', named(filters.stock_cat_id, labels.stockCategory))
  push('Brand', named(filters.brand_id, labels.brand))
  push('Lot number', filters.lot_no)

  if (filters.expiry && filters.expiry !== 'custom') {
    push('Expiry', EXPIRY_PRESETS.find((p) => p.value === filters.expiry)?.label)
  } else if (filters.has_expiry === '0') {
    lines.push('Expiry: No expiry date')
  } else if (filters.expiry_from || filters.expiry_to) {
    lines.push(
      `Expiry: ${filters.expiry_from ? formatDate(filters.expiry_from) : 'any'} to ${filters.expiry_to ? formatDate(filters.expiry_to) : 'any'}`,
    )
  }
  if (filters.mfg_from || filters.mfg_to) {
    lines.push(
      `Manufactured: ${filters.mfg_from ? formatDate(filters.mfg_from) : 'any'} to ${filters.mfg_to ? formatDate(filters.mfg_to) : 'any'}`,
    )
  }
  if (filters.stock === 'positive') lines.push('Stock: On hand above zero')
  if (filters.stock === 'zero') lines.push('Stock: Zero on hand')

  return lines
}

/**
 * The filter values as the API is actually sent them.
 *
 * `expiry` is the toolbar's own preset control and means nothing to the server
 * — it is already resolved into `expiry_from` / `expiry_to` / `has_expiry`
 * before it lands in the URL — so it is dropped here rather than sent as an
 * unknown parameter the API would ignore.
 */
export function toApiFilters(filters: BatchFilterValues): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (!value || key === 'expiry') continue
    out[key] = value
  }
  return out
}
