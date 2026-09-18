import type { ItemFormOptions } from '../../../services/items'
import type { BomListQuery } from '../../../services/masters'

/**
 * The bill-of-materials filter set: what lives in the URL, what the API is
 * asked for, and how a reader is told what is currently narrowing the list.
 *
 * Every filter is a query parameter, so a narrowed view is a link somebody can
 * send: `?status=active&item_grp_id=4&min_components=5`. Nothing here holds
 * component state.
 */

/** URL / API parameter names, in the order the drawer presents them. */
export const BOM_FILTER_KEYS = [
  'status',
  'item_grp_id',
  'finished_item_id',
  'component_item_id',
  'min_components',
  'max_components',
  'has_scrap',
  'has_by_products',
  'created_from',
  'created_to',
  'updated_from',
  'updated_to',
  'created_by',
  'updated_by',
] as const

export type BomFilterKey = (typeof BOM_FILTER_KEYS)[number]

export type BomFilters = Partial<Record<BomFilterKey, string>>

/** Kept beside the filters in the URL but sent to nobody — they shape the view. */
export const BOM_VIEW_KEYS = ['view'] as const

/**
 * Filters shown in the toolbar itself rather than behind "More filters".
 *
 * The drawer's badge counts everything EXCEPT these, so a reader is never told
 * there are "2 filters" hidden behind a button when both are the dropdowns
 * sitting next to it.
 */
const INLINE_KEYS: readonly BomFilterKey[] = ['status', 'item_grp_id']

export function advancedFilterCount(filters: BomFilters): number {
  return BOM_FILTER_KEYS.filter((k) => !INLINE_KEYS.includes(k) && (filters[k] ?? '') !== '').length
}

export function activeFilterCount(filters: BomFilters): number {
  return BOM_FILTER_KEYS.filter((k) => (filters[k] ?? '') !== '').length
}

/**
 * URL filters → the API query.
 *
 * Numeric parameters are parsed rather than forwarded as strings, so a
 * hand-edited `?min_components=abc` drops out here instead of reaching the
 * database as a nonsense bound.
 */
export function toListQuery(filters: BomFilters): BomListQuery {
  const query: BomListQuery = {}
  const status = filters.status
  if (status === 'active' || status === 'inactive') query.status = status

  for (const key of ['item_grp_id', 'finished_item_id', 'component_item_id', 'min_components', 'max_components'] as const) {
    const n = Number(filters[key])
    if (Number.isFinite(n) && n > 0) query[key] = n
  }
  for (const key of ['has_scrap', 'has_by_products'] as const) {
    if (filters[key] === '1') query[key] = 1
  }
  for (const key of ['created_from', 'created_to', 'updated_from', 'updated_to', 'created_by', 'updated_by'] as const) {
    const v = (filters[key] ?? '').trim()
    if (v) query[key] = v
  }
  return query
}

/**
 * One line per active filter, for the export sheet's header and the print
 * sheet's.
 *
 * A letterheaded PDF of 40 rows out of 400 has to say which 40, or a reader who
 * files it has a document that contradicts the system a week later.
 */
export function filterSummaryLines(
  filters: BomFilters,
  search: string,
  options: ItemFormOptions | null,
): string[] {
  const lines: string[] = []
  if (search.trim()) lines.push(`Search: ${search.trim()}`)
  if (filters.status === 'active') lines.push('Status: Active only')
  if (filters.status === 'inactive') lines.push('Status: Inactive only')

  const groupId = Number(filters.item_grp_id)
  if (Number.isFinite(groupId) && groupId > 0) {
    const name = options?.item_groups.find((g) => g.item_grp_id === groupId)?.grp_name
    lines.push(`Item group: ${name ?? `#${groupId}`}`)
  }
  if (filters.finished_item_id) lines.push(`Finished item: #${filters.finished_item_id}`)
  if (filters.component_item_id) lines.push(`Contains component: #${filters.component_item_id}`)
  if (filters.min_components) lines.push(`Minimum components: ${filters.min_components}`)
  if (filters.max_components) lines.push(`Maximum components: ${filters.max_components}`)
  if (filters.has_scrap === '1') lines.push('Wastage: only bills with wastage')
  if (filters.has_by_products === '1') lines.push('By-products: only bills with by-products')
  if (filters.created_from || filters.created_to) {
    lines.push(`Created: ${filters.created_from || '…'} to ${filters.created_to || '…'}`)
  }
  if (filters.updated_from || filters.updated_to) {
    lines.push(`Updated: ${filters.updated_from || '…'} to ${filters.updated_to || '…'}`)
  }
  if (filters.created_by) lines.push(`Created by: ${filters.created_by}`)
  if (filters.updated_by) lines.push(`Updated by: ${filters.updated_by}`)
  return lines
}

/** Everything the drawer can set, cleared in one navigation. */
export function clearedFilters(): Record<BomFilterKey, string> {
  return Object.fromEntries(BOM_FILTER_KEYS.map((k) => [k, ''])) as Record<BomFilterKey, string>
}
