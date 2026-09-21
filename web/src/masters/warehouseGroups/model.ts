/**
 * Everything the Warehouse groups screen decides, as pure functions.
 *
 * The screen holds one set of rows and answers four questions from it — which
 * rows to show, in what order, what the figures above them are, and what is
 * worth pointing out. None of that needs React, a network or a clock, so none
 * of it lives in a component: it is asserted in model.test.ts instead, where a
 * wrong count is a failing test rather than a number nobody checked.
 */

import type { Warehouse, WarehouseGroup } from '../../services/masters'

export type StatusFilter = 'all' | 'active' | 'inactive'
export type ContentsFilter = 'all' | 'with' | 'empty'
export type LevelFilter = 'all' | 'root' | 'child'
export type ViewMode = 'list' | 'tree' | 'cards'

export type SortKey =
  | 'name_asc'
  | 'name_desc'
  | 'newest'
  | 'oldest'
  | 'updated'
  | 'warehouses_desc'
  | 'warehouses_asc'

export const SORT_LABELS: Record<SortKey, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  newest: 'Newest first',
  oldest: 'Oldest first',
  updated: 'Recently updated',
  warehouses_desc: 'Warehouses (high–low)',
  warehouses_asc: 'Warehouses (low–high)',
}

export const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[]

export interface FilterState {
  q: string
  status: StatusFilter
  createdBy: string
  contents: ContentsFilter
  level: LevelFilter
  /** ISO date; keeps groups updated on or after it. */
  updatedFrom: string
  sort: SortKey
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  status: 'all',
  createdBy: '',
  contents: 'all',
  level: 'all',
  updatedFrom: '',
  sort: 'name_asc',
}

/** Filters beyond the search box that are actually narrowing the list. */
export function activeFilterCount(f: FilterState): number {
  let n = 0
  if (f.status !== 'all') n += 1
  if (f.createdBy !== '') n += 1
  if (f.contents !== 'all') n += 1
  if (f.level !== 'all') n += 1
  if (f.updatedFrom !== '') n += 1
  return n
}

export function isActive(row: WarehouseGroup): boolean {
  return Number(row.is_active) === 1
}

export function warehouseCount(row: WarehouseGroup): number {
  const n = Number(row.warehouse_count ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function childCount(row: WarehouseGroup): number {
  const n = Number(row.child_count ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The uuid in created_by / updated_by, or '' when the row carries none. */
export function creatorKey(row: WarehouseGroup): string {
  return (row.created_by ?? '').trim()
}

/**
 * Who to show for an actor.
 *
 * The API resolves a company member's display name; a service key or a CLI job
 * is not a member and resolves to nothing. Rather than print a bare uuid at a
 * reader, an unresolved actor is shortened and labelled — it is still the
 * identifier, just one that fits a table cell.
 */
export function actorLabel(uuid: string | null | undefined, name: string | null | undefined): string | null {
  const resolved = (name ?? '').trim()
  if (resolved !== '') return resolved
  const raw = (uuid ?? '').trim()
  if (raw === '') return null
  if (raw.toLowerCase().startsWith('cli:')) return raw
  if (/^\d+$/.test(raw)) return `User #${raw}`
  return raw.length > 12 ? `${raw.slice(0, 8)}…` : raw
}

function norm(v: string | null | undefined): string {
  return (v ?? '').toLowerCase()
}

/** Name, code and description — the three fields the search box promises. */
export function matchesQuery(row: WarehouseGroup, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (needle === '') return true
  return (
    norm(row.grp_name).includes(needle) ||
    norm(row.grp_code).includes(needle) ||
    norm(row.description).includes(needle)
  )
}

export function filterGroups(rows: readonly WarehouseGroup[], f: FilterState): WarehouseGroup[] {
  return rows.filter((row) => {
    if (!matchesQuery(row, f.q)) return false
    if (f.status === 'active' && !isActive(row)) return false
    if (f.status === 'inactive' && isActive(row)) return false
    if (f.createdBy !== '' && creatorKey(row) !== f.createdBy) return false
    if (f.contents === 'with' && warehouseCount(row) === 0) return false
    if (f.contents === 'empty' && warehouseCount(row) > 0) return false
    if (f.level === 'root' && row.parent_grp_id) return false
    if (f.level === 'child' && !row.parent_grp_id) return false
    if (f.updatedFrom !== '') {
      const stamp = (row.updated_at ?? row.created_at ?? '').slice(0, 10)
      if (stamp === '' || stamp < f.updatedFrom) return false
    }
    return true
  })
}

function byName(a: WarehouseGroup, b: WarehouseGroup): number {
  return a.grp_name.localeCompare(b.grp_name, undefined, { sensitivity: 'base' })
}

/** Missing stamps sort last in both directions — an unknown date is not "oldest". */
function byStamp(a: string | null | undefined, b: string | null | undefined, order: 'asc' | 'desc'): number {
  const left = (a ?? '').trim()
  const right = (b ?? '').trim()
  if (left === '' && right === '') return 0
  if (left === '') return 1
  if (right === '') return -1
  return order === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
}

/** A stable order: the sort key first, the name as the tie-break, always. */
export function sortGroups(rows: readonly WarehouseGroup[], sort: SortKey): WarehouseGroup[] {
  const out = [...rows]
  out.sort((a, b) => {
    switch (sort) {
      case 'name_desc':
        return -byName(a, b)
      case 'newest':
        return byStamp(a.created_at, b.created_at, 'desc') || byName(a, b)
      case 'oldest':
        return byStamp(a.created_at, b.created_at, 'asc') || byName(a, b)
      case 'updated':
        return byStamp(a.updated_at ?? a.created_at, b.updated_at ?? b.created_at, 'desc') || byName(a, b)
      case 'warehouses_desc':
        return warehouseCount(b) - warehouseCount(a) || byName(a, b)
      case 'warehouses_asc':
        return warehouseCount(a) - warehouseCount(b) || byName(a, b)
      case 'name_asc':
      default:
        return byName(a, b)
    }
  })
  return out
}

export interface GroupStats {
  total: number
  active: number
  inactive: number
  activePct: number
  inactivePct: number
  /** Warehouses held across every group on record. */
  warehousesInGroups: number
  /** The whole company's warehouses, when the reader may see them. Else null. */
  warehousesTotal: number | null
  ungrouped: number | null
  emptyGroups: number
}

/**
 * The four figures over the table.
 *
 * Counted over every group the screen holds, never over the page on screen: a
 * card that said "4 active" because four of the twenty-five rows in view were
 * active would be a figure that changes when the reader turns a page.
 *
 * `warehousesTotal` and `ungrouped` are null when the profile cannot read
 * warehouses. The card then reports what it does know — the warehouses these
 * groups hold — instead of guessing at a company total it was not shown.
 */
export function groupStats(
  rows: readonly WarehouseGroup[],
  warehouses: readonly Warehouse[] | null,
): GroupStats {
  const total = rows.length
  const active = rows.filter(isActive).length
  const inactive = total - active
  const warehousesInGroups = rows.reduce((sum, r) => sum + warehouseCount(r), 0)
  return {
    total,
    active,
    inactive,
    activePct: total === 0 ? 0 : Math.round((active / total) * 100),
    inactivePct: total === 0 ? 0 : Math.round((inactive / total) * 100),
    warehousesInGroups,
    warehousesTotal: warehouses ? warehouses.length : null,
    ungrouped: warehouses ? warehouses.filter((w) => !w.warehouse_group_id).length : null,
    emptyGroups: rows.filter((r) => warehouseCount(r) === 0).length,
  }
}

export interface CreatorOption {
  value: string
  label: string
  count: number
}

/**
 * The people who created the groups on record — read off the rows, not from a
 * user directory. The filter can therefore only offer someone who actually
 * created one of these groups, which is the only name it could usefully offer.
 */
export function creatorOptions(rows: readonly WarehouseGroup[]): CreatorOption[] {
  const byKey = new Map<string, CreatorOption>()
  for (const row of rows) {
    const key = creatorKey(row)
    if (key === '') continue
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    byKey.set(key, { value: key, label: actorLabel(key, row.created_by_name) ?? key, count: 1 })
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/**
 * A code suggested from a name — never imposed.
 *
 * Three words or more and it takes their initials (`Scrap / Rejected Stock` →
 * `SRS`); otherwise the first three letters of the first word (`Retail Stores`
 * → `RET`). If that is taken it lengthens, then numbers itself, because the
 * point of a suggestion is to be accepted without a second thought.
 *
 * The server remains the authority on uniqueness: this only avoids proposing a
 * code the screen can already see is in use, so the common case does not have
 * to be corrected by a 409.
 */
export function suggestCode(name: string, taken: readonly string[] = []): string {
  const used = new Set(taken.map((c) => c.trim().toUpperCase()).filter(Boolean))
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return ''

  const candidates: string[] = []
  if (words.length >= 3) candidates.push(words.slice(0, 3).map((w) => w[0]).join(''))
  if (words.length === 2) candidates.push(words[0].slice(0, 3), words[0][0] + words[1].slice(0, 2))
  candidates.push(words[0].slice(0, 3), words[0].slice(0, 4), words.map((w) => w[0]).join('').slice(0, 4))

  for (const candidate of candidates) {
    if (candidate.length >= 2 && !used.has(candidate)) return candidate
  }
  const stem = (candidates[0] || words[0].slice(0, 3)).slice(0, 3)
  for (let n = 2; n < 100; n += 1) {
    const numbered = `${stem}${n}`
    if (!used.has(numbered)) return numbered
  }
  return stem
}

export type InsightTone = 'info' | 'warning' | 'danger'

export interface Insight {
  id: string
  tone: InsightTone
  title: string
  detail: string
  /** Filters that isolate exactly the rows the insight counted, when they can. */
  filters?: Partial<FilterState>
}

function normaliseName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * What the data itself says — counted, never modelled.
 *
 * Every finding below is arithmetic over the rows already on the page: a count,
 * a duplicate key, a share of a total. Nothing is forecast, nothing is scored
 * and no company data leaves the browser to produce any of it. That is why the
 * panel calls them Insights and not AI — a rule that counts empty groups is a
 * rule, and labelling it generative would be a claim about how it works that is
 * simply untrue.
 */
export function insights(
  rows: readonly WarehouseGroup[],
  warehouses: readonly Warehouse[] | null,
): Insight[] {
  const out: Insight[] = []
  if (rows.length === 0) return out

  const empty = rows.filter((r) => warehouseCount(r) === 0 && childCount(r) === 0)
  if (empty.length > 0) {
    out.push({
      id: 'empty-groups',
      tone: 'info',
      title: `${empty.length} ${empty.length === 1 ? 'group holds' : 'groups hold'} no warehouses`,
      detail:
        empty.length === 1
          ? `“${empty[0].grp_name}” has no warehouses and no sub-groups. Assign one, or deactivate the group so it stops appearing in pickers.`
          : 'They have no warehouses and no sub-groups, so they add a choice to every warehouse picker without narrowing anything.',
      filters: { contents: 'empty' },
    })
  }

  const strandedInactive = rows.filter((r) => !isActive(r) && warehouseCount(r) > 0)
  if (strandedInactive.length > 0) {
    const held = strandedInactive.reduce((sum, r) => sum + warehouseCount(r), 0)
    out.push({
      id: 'inactive-holding',
      tone: 'warning',
      title: `${strandedInactive.length} inactive ${strandedInactive.length === 1 ? 'group' : 'groups'} still ${strandedInactive.length === 1 ? 'holds' : 'hold'} ${held} ${held === 1 ? 'warehouse' : 'warehouses'}`,
      detail:
        'The group is out of use but the warehouses still point at it, so reports grouped by warehouse group will keep showing it. Reassign the warehouses, or make the group active again.',
      filters: { status: 'inactive', contents: 'with' },
    })
  }

  const nameBuckets = new Map<string, WarehouseGroup[]>()
  for (const row of rows) {
    const key = normaliseName(row.grp_name)
    if (key === '') continue
    nameBuckets.set(key, [...(nameBuckets.get(key) ?? []), row])
  }
  const duplicateNames = [...nameBuckets.values()].filter((list) => list.length > 1)
  if (duplicateNames.length > 0) {
    const sample = duplicateNames[0].map((r) => `“${r.grp_name}”`).join(' and ')
    out.push({
      id: 'duplicate-names',
      tone: 'warning',
      title: `${duplicateNames.length} ${duplicateNames.length === 1 ? 'name looks' : 'names look'} duplicated`,
      detail: `${sample} differ only in spacing, punctuation or case. Two groups that read the same are two groups people file into at random.`,
    })
  }

  const uncoded = rows.filter((r) => !(r.grp_code ?? '').trim())
  if (uncoded.length > 0 && uncoded.length !== rows.length) {
    out.push({
      id: 'missing-codes',
      tone: 'info',
      title: `${uncoded.length} ${uncoded.length === 1 ? 'group has' : 'groups have'} no code`,
      detail: 'Codes are what exports, imports and printed registers key on. A part-coded master is one nobody can key on reliably.',
    })
  }

  const withWarehouses = rows.filter((r) => warehouseCount(r) > 0)
  const totalHeld = withWarehouses.reduce((sum, r) => sum + warehouseCount(r), 0)
  if (totalHeld >= 4 && withWarehouses.length > 1) {
    const largest = [...withWarehouses].sort((a, b) => warehouseCount(b) - warehouseCount(a))[0]
    const share = Math.round((warehouseCount(largest) / totalHeld) * 100)
    if (share >= 60) {
      out.push({
        id: 'lopsided',
        tone: 'info',
        title: `“${largest.grp_name}” holds ${share}% of grouped warehouses`,
        detail: `${warehouseCount(largest)} of ${totalHeld} warehouses sit in one group, so grouping them buys almost no reporting detail. Splitting by region or by business unit usually does.`,
      })
    }
  }

  if (warehouses) {
    const ungrouped = warehouses.filter((w) => !w.warehouse_group_id)
    if (ungrouped.length > 0) {
      out.push({
        id: 'ungrouped-warehouses',
        tone: 'warning',
        title: `${ungrouped.length} ${ungrouped.length === 1 ? 'warehouse is' : 'warehouses are'} in no group`,
        detail:
          ungrouped.length <= 3
            ? `${ungrouped.map((w) => `“${w.warehouse_name}”`).join(', ')} will be missing from every report grouped by warehouse group.`
            : 'They will be missing from every report grouped by warehouse group, and from any access rule written against one.',
      })
    }
  }

  return out
}

/** `Showing 1–25 of 128` — the sentence, built once. */
export function rangeLabel(from: number, to: number, total: number, noun = 'warehouse group'): string {
  if (total === 0) return `No ${noun}s`
  if (total === 1) return `1 ${noun}`
  return `Showing ${from}–${to} of ${total} ${noun}s`
}
