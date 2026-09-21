/**
 * The Brands screen's list state: what the toolbar offers, and what the API is
 * asked for.
 *
 * Every function here is pure and takes its "today" as an argument, so the
 * whole filter model is unit-testable without a clock, a router or a company.
 * The screen keeps the state in the URL (`useListParams`), which is what makes
 * a filtered view refreshable, bookmarkable and sendable to a colleague.
 */

import type { SortOrder } from '../../../services/api'
import type { BrandListQuery } from '../../../services/masters'

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type BrandSortKey = 'name_asc' | 'name_desc' | 'newest' | 'oldest' | 'items_desc' | 'updated_desc'

export interface BrandSortOption {
  key: BrandSortKey
  label: string
  sort: string
  order: SortOrder
}

/**
 * The orders the API can actually honour.
 *
 * "Highest sales" is deliberately absent. A brand's turnover comes from Books
 * over a live API keyed by brand id (see services/brandAnalyticsApi), so the
 * Inventory list endpoint has no column to order by — and a sort control that
 * silently leaves the rows where they were is worse than one that is not
 * offered. It belongs here the day the Books relay can sort, not before.
 */
export const BRAND_SORTS: readonly BrandSortOption[] = [
  { key: 'name_asc', label: 'Name (A–Z)', sort: 'brand_name', order: 'asc' },
  { key: 'name_desc', label: 'Name (Z–A)', sort: 'brand_name', order: 'desc' },
  { key: 'newest', label: 'Newest first', sort: 'created_at', order: 'desc' },
  { key: 'oldest', label: 'Oldest first', sort: 'created_at', order: 'asc' },
  { key: 'items_desc', label: 'Most items', sort: 'item_count', order: 'desc' },
  { key: 'updated_desc', label: 'Recently updated', sort: 'updated_at', order: 'desc' },
]

export const DEFAULT_BRAND_SORT = BRAND_SORTS[0]

/** The menu entry matching the URL's `sort`/`order`, or the default. */
export function sortKeyOf(sort: string, order: SortOrder): BrandSortKey {
  return (BRAND_SORTS.find((s) => s.sort === sort && s.order === order) ?? DEFAULT_BRAND_SORT).key
}

export function sortParamsOf(key: string): { sort: string; order: SortOrder } {
  const option = BRAND_SORTS.find((s) => s.key === key) ?? DEFAULT_BRAND_SORT
  return { sort: option.sort, order: option.order }
}

// ---------------------------------------------------------------------------
// Created period
// ---------------------------------------------------------------------------

export type CreatedPreset = '' | 'today' | 'last7' | 'last30' | 'month' | 'fy' | 'custom'

export interface CreatedPresetOption {
  value: CreatedPreset
  label: string
}

export const CREATED_PRESETS: readonly CreatedPresetOption[] = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'fy', label: 'This financial year' },
  { value: 'custom', label: 'Custom range' },
]

export interface DateRange {
  from: string
  to: string
}

const EMPTY_RANGE: DateRange = { from: '', to: '' }

/** `2026-09-18` → `2026-09-11` for n = 7. Pure, UTC, no Date arithmetic surprises. */
export function shiftIsoDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function startOfIsoMonth(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(0, 7)}-01` : ''
}

export interface CreatedRangeContext {
  /** ISO date for "now" — passed in so this stays pure and testable. */
  today: string
  /** The selected financial year from Manage, when the app knows it. */
  fyFrom?: string
  fyTo?: string
  /** Only read for the `custom` preset. */
  customFrom?: string
  customTo?: string
}

/**
 * The `created_from` / `created_to` a preset means.
 *
 * `fy` reads the financial year the header selector is on — Manage owns that
 * range, so it is passed in rather than guessed from the calendar. With no FY
 * known the preset resolves to no range at all: an unbounded list is a truthful
 * answer, a made-up April-to-March window is not.
 *
 * "Last 7 days" counts back 6 days and includes today, which is what a reader
 * means by it — a window that excluded today would show nothing on the morning
 * a brand was added.
 */
export function createdRange(preset: CreatedPreset, ctx: CreatedRangeContext): DateRange {
  const { today } = ctx
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return EMPTY_RANGE
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: shiftIsoDays(today, -6), to: today }
    case 'last30':
      return { from: shiftIsoDays(today, -29), to: today }
    case 'month':
      return { from: startOfIsoMonth(today), to: today }
    case 'fy':
      return ctx.fyFrom && ctx.fyTo ? { from: ctx.fyFrom, to: ctx.fyTo } : EMPTY_RANGE
    case 'custom':
      return { from: ctx.customFrom ?? '', to: ctx.customTo ?? '' }
    default:
      return EMPTY_RANGE
  }
}

// ---------------------------------------------------------------------------
// The whole filter state
// ---------------------------------------------------------------------------

/** Names of every extra parameter this screen keeps in the URL. */
export const BRAND_FILTER_KEYS = ['status', 'created', 'created_from', 'created_to', 'has_items'] as const

export interface BrandFilterState {
  q: string
  status: string
  created: CreatedPreset
  createdFrom: string
  createdTo: string
  hasItems: string
}

export function readBrandFilters(q: string, filters: Record<string, string>): BrandFilterState {
  const created = (CREATED_PRESETS.find((p) => p.value === filters.created)?.value ?? '') as CreatedPreset
  return {
    q,
    status: filters.status === 'active' || filters.status === 'inactive' ? filters.status : '',
    created,
    createdFrom: filters.created_from ?? '',
    createdTo: filters.created_to ?? '',
    hasItems: filters.has_items === '0' || filters.has_items === '1' ? filters.has_items : '',
  }
}

/**
 * How many filters are narrowing the list right now.
 *
 * Drives the count on the "More filters" button and, more importantly, the
 * difference between the two empty screens: a master with no brands in it needs
 * an invitation to create one, a filter that matched nothing needs a way back
 * out. Search is counted because a search that matches nothing is the same
 * situation.
 */
export function activeBrandFilterCount(state: BrandFilterState): number {
  let n = 0
  if (state.q.trim()) n += 1
  if (state.status) n += 1
  if (state.created) n += 1
  if (state.hasItems) n += 1
  return n
}

/** Filters only — what the advanced drawer's badge counts. */
export function advancedBrandFilterCount(state: BrandFilterState): number {
  let n = 0
  if (state.created) n += 1
  if (state.hasItems) n += 1
  return n
}

/**
 * The query the list endpoint is called with.
 *
 * The date preset is resolved to real bounds here rather than sent as a word:
 * the API understands dates, and resolving in one place means the export, the
 * table and the footer count can never disagree about what "this month" meant.
 */
export function buildBrandListQuery(
  state: BrandFilterState,
  paging: { page: number; limit: number; sort: string; order: SortOrder },
  ctx: CreatedRangeContext,
): BrandListQuery {
  const range = createdRange(state.created, { ...ctx, customFrom: state.createdFrom, customTo: state.createdTo })
  return {
    q: state.q.trim() || undefined,
    status: state.status || undefined,
    created_from: range.from || undefined,
    created_to: range.to || undefined,
    has_items: state.hasItems || undefined,
    page: paging.page,
    limit: paging.limit,
    sort: paging.sort,
    order: paging.order,
  }
}

/**
 * The lines an exported sheet carries so the reader can tell what they are
 * looking at. A file with no statement of its filters is a file nobody can
 * check against the screen it came from.
 */
export function brandExportMetaLines(state: BrandFilterState, range: DateRange): string[] {
  const lines: string[] = []
  if (state.q.trim()) lines.push(`Search: ${state.q.trim()}`)
  if (state.status) lines.push(`Status: ${state.status === 'active' ? 'Active only' : 'Inactive only'}`)
  if (state.created) {
    const label = CREATED_PRESETS.find((p) => p.value === state.created)?.label ?? state.created
    lines.push(range.from || range.to ? `Created: ${label} (${range.from || '…'} to ${range.to || '…'})` : `Created: ${label}`)
  }
  if (state.hasItems === '1') lines.push('Linkage: brands with items only')
  if (state.hasItems === '0') lines.push('Linkage: brands with no items only')
  return lines
}
