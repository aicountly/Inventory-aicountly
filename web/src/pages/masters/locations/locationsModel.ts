/**
 * Everything the Locations screen *computes*, as pure functions over the rows
 * the API already returned. No React, no lucide, no DOM — so the whole of it is
 * unit-testable in the existing node vitest environment and the widgets stay
 * thin.
 *
 * The domain matters here, and it is not the one the name suggests at first
 * glance. `inv_locations` is the **bin** master: the zone / rack / shelf / bin
 * tree *inside* a warehouse (see 001_inventory_masters.sql, and the type
 * whitelist LocationsController::buildRow enforces). It is not a master of
 * business sites — offices and branches are Manage's `bo_id`, read through the
 * relay, and Inventory holding its own copy of them would be exactly the
 * duplicate shadow master the architecture forbids.
 *
 * So every figure below counts bins and the warehouses they sit in. Nothing
 * here derives a street address, a state or a coordinate: the table has no such
 * column, and inventing one for a shelf would put a number on screen that no
 * record backs.
 */

import type { Location } from '../../../services/masters'
import type { SeriesItem, Tone } from '../../../dashboard/model'
import { formatCount, percentOf } from '../../../dashboard/formatters'
import { humanize } from '../../../utils/format'

/* ------------------------------------------------------------------ types -- */

/**
 * The little a warehouse has to offer before this file can count locations
 * against it.
 *
 * Structural rather than `Warehouse` on purpose: the screen's warehouse list
 * comes from `/v1/items/form-options`, whose `FormOptionWarehouse` carries no
 * `is_active` at all — that endpoint only ever serves pickable (active)
 * warehouses. Typing against the full master row would have compiled only
 * after a cast, and the cast would have quietly made every warehouse read as
 * inactive.
 */
export interface WarehouseRef {
  warehouse_id: number
  warehouse_name: string
  /** Absent means active — see above. */
  is_active?: number
}

/** True unless the source explicitly says otherwise. */
function warehouseIsActive(w: WarehouseRef): boolean {
  return w.is_active === undefined || Number(w.is_active) === 1
}

/** The four real `location_type` values, in hierarchy order (outermost first). */
export const LOCATION_TYPE_ORDER = ['zone', 'rack', 'shelf', 'bin'] as const

export interface LocationTypeMeta {
  label: string
  /** IconTile / Badge tone. */
  tone: 'violet' | 'info' | 'warning' | 'success' | 'slate'
  /** Swatch used by the distribution legend and the type chip. */
  color: string
}

const TYPE_META: Record<string, LocationTypeMeta> = {
  zone: { label: 'Zone', tone: 'violet', color: '#a78bfa' },
  rack: { label: 'Rack', tone: 'info', color: '#0ea5e9' },
  shelf: { label: 'Shelf', tone: 'warning', color: '#f59e0b' },
  bin: { label: 'Bin', tone: 'success', color: '#10b981' },
}

const UNKNOWN_TYPE: LocationTypeMeta = { label: 'Other', tone: 'slate', color: '#94a3b8' }

/**
 * Display metadata for a `location_type`.
 *
 * Falls back rather than throwing: the column is a VARCHAR(16) and a row
 * migrated from a legacy table can carry a value outside the whitelist the
 * controller applies on write. Such a row still has to render.
 */
export function locationTypeMeta(type: unknown): LocationTypeMeta {
  const key = String(type ?? '').toLowerCase()
  return TYPE_META[key] ?? { ...UNKNOWN_TYPE, label: key ? humanize(key) : 'Other' }
}

/* ------------------------------------------------------------------ stats -- */

export interface LocationStats {
  total: number
  active: number
  inactive: number
  /** Distinct warehouses these locations sit in. */
  warehousesCovered: number
  activePct: number
  inactivePct: number
}

export function isActive(row: Location): boolean {
  return Number(row.is_active) === 1
}

/**
 * The four KPI figures, counted over every row in scope.
 *
 * The caller passes the *unfiltered-by-status* set for exactly this reason: a
 * screen filtered to "Active only" that then reported "Inactive 0" would be
 * reading its own filter back to the user as a fact about their data.
 */
export function locationStats(rows: readonly Location[]): LocationStats {
  let active = 0
  const warehouses = new Set<number>()
  for (const row of rows) {
    if (isActive(row)) active += 1
    if (row.warehouse_id) warehouses.add(Number(row.warehouse_id))
  }
  const total = rows.length
  return {
    total,
    active,
    inactive: total - active,
    warehousesCovered: warehouses.size,
    activePct: percentOf(active, total),
    inactivePct: percentOf(total - active, total),
  }
}

/* ----------------------------------------------------------- distribution -- */

/**
 * Share of locations by type, ordered zone → rack → shelf → bin so the legend
 * reads down the hierarchy. Types with no rows are dropped rather than drawn as
 * a zero slice.
 */
export function typeDistribution(rows: readonly Location[]): SeriesItem[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = String(row.location_type ?? '').toLowerCase() || 'other'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = rows.length
  const known = LOCATION_TYPE_ORDER.filter((t) => counts.has(t))
  const extra = [...counts.keys()].filter((k) => !LOCATION_TYPE_ORDER.includes(k as never)).sort()

  return [...known, ...extra].map((key) => {
    const value = counts.get(key) ?? 0
    const meta = locationTypeMeta(key)
    return {
      key,
      label: meta.label,
      value,
      display: formatCount(value),
      share: percentOf(value, total),
      scale: percentOf(value, Math.max(...counts.values(), 0)),
      tone: 'primary' as Tone,
    }
  })
}

/**
 * Locations per warehouse, biggest first — the bin-native answer to "where is
 * my estate concentrated".
 *
 * A warehouse the user cannot name is still counted; it is labelled by id
 * rather than dropped, because a row that exists and is invisible is worse than
 * an ugly label.
 */
export function warehouseCoverage(
  rows: readonly Location[],
  warehouses: readonly WarehouseRef[],
): SeriesItem[] {
  const names = new Map<number, string>(warehouses.map((w) => [Number(w.warehouse_id), w.warehouse_name]))
  const counts = new Map<number, number>()
  for (const row of rows) {
    const id = Number(row.warehouse_id)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const total = rows.length
  const max = Math.max(...counts.values(), 0)

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''))
    .map(([id, value]) => ({
      key: String(id),
      label: names.get(id) ?? `Warehouse #${id}`,
      value,
      display: formatCount(value),
      share: percentOf(value, total),
      scale: percentOf(value, max),
      tone: 'primary' as Tone,
      to: `/masters/locations?warehouse_id=${id}`,
    }))
}

/* -------------------------------------------------------------- hierarchy -- */

export interface LocationNode {
  depth: number
  /** Ancestors outermost-first, excluding the row itself. */
  ancestors: Location[]
  hasChildren: boolean
}

/**
 * Depth and ancestor chain for every row, in one pass per row with memoised
 * walks.
 *
 * Cycle-safe by construction: the walk carries the ids it has already stepped
 * through and stops when one repeats. `validateParent` on the server is meant
 * to prevent a loop ever being stored, but a render that hangs the tab is not
 * an acceptable way to discover that it failed.
 */
export function buildHierarchy(rows: readonly Location[]): Map<number, LocationNode> {
  const byId = new Map<number, Location>(rows.map((r) => [Number(r.location_id), r]))
  const withChildren = new Set<number>()
  for (const row of rows) {
    if (row.parent_location_id) withChildren.add(Number(row.parent_location_id))
  }

  const out = new Map<number, LocationNode>()
  for (const row of rows) {
    const id = Number(row.location_id)
    const ancestors: Location[] = []
    const seen = new Set<number>([id])
    let cursor = row.parent_location_id ? byId.get(Number(row.parent_location_id)) : undefined
    while (cursor) {
      const cursorId = Number(cursor.location_id)
      if (seen.has(cursorId)) break
      seen.add(cursorId)
      ancestors.unshift(cursor)
      cursor = cursor.parent_location_id ? byId.get(Number(cursor.parent_location_id)) : undefined
    }
    out.set(id, { depth: ancestors.length, ancestors, hasChildren: withChildren.has(id) })
  }
  return out
}

/** `Zone A › Rack 3` — the ancestor chain, or '' at the top level. */
export function pathLabel(node: LocationNode | undefined): string {
  if (!node || node.ancestors.length === 0) return ''
  return node.ancestors.map((a) => a.location_code).join(' › ')
}

/* --------------------------------------------------------------- insights -- */

export type InsightTone = 'info' | 'warning' | 'success'

export interface LocationInsight {
  id: string
  title: string
  detail: string
  tone: InsightTone
  /** Query string that narrows the list to the rows the insight is about. */
  filter?: Record<string, string>
}

/**
 * Rule-based observations about the location set.
 *
 * Deliberately NOT called AI, and deliberately not routed through a model: the
 * product has no insight service for masters yet, and a card that says "AI
 * suggestion" over a `filter(...).length` is a claim about how the number was
 * produced, not a style of wording. When a real service arrives it replaces the
 * body of this function and the card above it does not change.
 *
 * Every rule states a count the reader can go and check, and each carries the
 * filter that shows those exact rows.
 */
export function locationInsights(
  rows: readonly Location[],
  warehouses: readonly WarehouseRef[],
): LocationInsight[] {
  const out: LocationInsight[] = []
  if (rows.length === 0) return out

  const hierarchy = buildHierarchy(rows)

  // 1. Warehouses with no bins at all — stock there cannot be addressed.
  const used = new Set(rows.map((r) => Number(r.warehouse_id)))
  const bare = warehouses.filter((w) => warehouseIsActive(w) && !used.has(Number(w.warehouse_id)))
  if (bare.length > 0) {
    out.push({
      id: 'warehouses-without-locations',
      title: `${bare.length} active ${bare.length === 1 ? 'warehouse has' : 'warehouses have'} no locations`,
      detail:
        bare.length <= 3
          ? `${bare.map((w) => w.warehouse_name).join(', ')} cannot address stock to a bin yet.`
          : 'Stock in those warehouses cannot be addressed to a bin yet.',
      tone: 'warning',
    })
  }

  // 2. A flat estate: everything at the root, no zone/rack structure.
  const roots = rows.filter((r) => !r.parent_location_id)
  if (rows.length >= 8 && roots.length === rows.length) {
    out.push({
      id: 'flat-hierarchy',
      title: 'Every location sits at the top level',
      detail: `All ${rows.length} locations are roots. Grouping them under zones or racks makes picking routes and counts easier to plan.`,
      tone: 'info',
    })
  }

  // 3. Inactive rows still on the books.
  const inactive = rows.filter((r) => !isActive(r))
  if (inactive.length > 0) {
    out.push({
      id: 'inactive-locations',
      title: `${inactive.length} inactive ${inactive.length === 1 ? 'location' : 'locations'}`,
      detail: 'They stay out of dropdowns but still hold their history. Review them if they are no longer part of the layout.',
      tone: 'info',
      filter: { status: 'inactive' },
    })
  }

  // 4. Code-only rows: a picker showing bare codes is hard to read on a floor.
  const unnamed = rows.filter((r) => !String(r.location_name ?? '').trim())
  if (unnamed.length > 0 && unnamed.length >= rows.length * 0.25) {
    out.push({
      id: 'unnamed-locations',
      title: `${unnamed.length} ${unnamed.length === 1 ? 'location has' : 'locations have'} no name`,
      detail: 'Only the code shows in pickers and on printed count sheets. A short name makes them readable on the floor.',
      tone: 'info',
    })
  }

  // 5. Duplicate names inside one warehouse — two "Shelf 1"s in a pick list.
  const nameKey = new Map<string, number>()
  for (const row of rows) {
    const name = String(row.location_name ?? '').trim().toLowerCase()
    if (!name) continue
    const key = `${row.warehouse_id}::${name}`
    nameKey.set(key, (nameKey.get(key) ?? 0) + 1)
  }
  const duplicates = [...nameKey.values()].filter((n) => n > 1).length
  if (duplicates > 0) {
    out.push({
      id: 'duplicate-names',
      title: `${duplicates} duplicate ${duplicates === 1 ? 'name' : 'names'} within a warehouse`,
      detail: 'Codes stay unique, but two locations reading the same on a pick list invite mis-picks.',
      tone: 'warning',
    })
  }

  // 6. Deep chains are usually a modelling slip rather than a real layout.
  const tooDeep = rows.filter((r) => (hierarchy.get(Number(r.location_id))?.depth ?? 0) > 3)
  if (tooDeep.length > 0) {
    out.push({
      id: 'deep-nesting',
      title: `${tooDeep.length} ${tooDeep.length === 1 ? 'location sits' : 'locations sit'} more than four levels deep`,
      detail: 'Zone › rack › shelf › bin covers most layouts. Deeper chains are slower to pick from and harder to count.',
      tone: 'info',
    })
  }

  if (out.length === 0) {
    out.push({
      id: 'healthy',
      title: 'Your location setup looks tidy',
      detail: `${rows.length} ${rows.length === 1 ? 'location' : 'locations'} across ${used.size} ${used.size === 1 ? 'warehouse' : 'warehouses'}, all named and structured.`,
      tone: 'success',
    })
  }

  return out
}
