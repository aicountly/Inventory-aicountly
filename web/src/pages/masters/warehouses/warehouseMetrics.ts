/**
 * Everything the Warehouses screen derives from live data, as pure functions.
 *
 * Kept out of the components so each figure can be unit tested against the rule
 * it claims to follow. The screen shows capacity, utilisation and stock side by
 * side, and those three are exactly the numbers a user will check against a
 * report — so the arithmetic is here, tested, rather than inline in JSX where a
 * mistake is invisible in review.
 *
 * The one rule running through all of it: an unconfigured capacity is `null`,
 * never 0. Utilisation against a zero ceiling is either a division by zero or a
 * warehouse that reads as permanently full, and both are lies about a warehouse
 * whose owner simply has not filled the field in yet.
 */

import type { SeriesItem } from '../../../dashboard/model'
import type { WarehouseStockSummary } from '../../../services/reportsApi'
import type { Warehouse } from '../../../services/masters'
import { formatQty, toNumber } from '../../../utils/format'

/** Quantity and value a warehouse currently holds, from the warehouse-stock report. */
export interface WarehouseStock {
  qty: number
  /** null when the user may not see inventory valuation. */
  value: number | null
}

export const EMPTY_STOCK: WarehouseStock = { qty: 0, value: null }

/**
 * Stock per warehouse, keyed by id, from ONE report summary.
 *
 * The screen never asks for a warehouse's stock one row at a time:
 * `/v1/reports/warehouse-stock` already groups the whole company in its
 * summary, so a page of fifty warehouses costs one request, not fifty.
 *
 * `canSeeValue` is the caller's permission, applied here rather than at the
 * point of render, so a component cannot forget it and print a figure the user
 * is not entitled to.
 */
export function stockByWarehouse(summary: WarehouseStockSummary | null, canSeeValue: boolean): Map<number, WarehouseStock> {
  const map = new Map<number, WarehouseStock>()
  for (const row of summary?.by_warehouse ?? []) {
    if (row.warehouse_id === null) continue
    map.set(Number(row.warehouse_id), {
      qty: toNumber(row.closing_qty) ?? 0,
      value: canSeeValue ? toNumber(row.closing_value) ?? 0 : null,
    })
  }
  return map
}

/** A warehouse's configured ceiling, or null when it has none. */
export function capacityOf(warehouse: Warehouse): number | null {
  const capacity = toNumber(warehouse.capacity_units)
  return capacity !== null && capacity > 0 ? capacity : null
}

/**
 * How full a warehouse is, 0-100+, or null when there is nothing to measure against.
 *
 * Not clamped at 100: a warehouse holding more than its stated ceiling is a
 * real and interesting state, and rounding it down to "full" would hide exactly
 * the row the user needs to see. Negative stock reads as 0 rather than a
 * negative bar — the bar has no meaning below empty, and the quantity column
 * beside it already shows the minus sign.
 */
export function utilisationOf(capacity: number | null, stockQty: number): number | null {
  if (capacity === null || capacity <= 0) return null
  return Math.max(0, (stockQty / capacity) * 100)
}

export type UtilisationLevel = 'empty' | 'normal' | 'warning' | 'high'

/**
 * The band a utilisation falls in: 0-70 normal, 71-90 warning, above 90 high.
 *
 * Returned as a name, not a colour, so the caller pairs it with the numeric
 * percentage it always prints beside the bar. Colour alone never carries the
 * status — that is the accessibility rule this split exists to keep.
 */
export function utilisationLevel(pct: number | null): UtilisationLevel {
  if (pct === null) return 'empty'
  if (pct > 90) return 'high'
  if (pct > 70) return 'warning'
  return 'normal'
}

export const UTILISATION_LABELS: Record<UtilisationLevel, string> = {
  empty: 'Capacity not configured',
  normal: 'Within capacity',
  warning: 'Filling up',
  high: 'Over 90% full',
}

/** The postal address a warehouse carries, normalised. Empty strings become null. */
export interface WarehousePlace {
  city: string | null
  state: string | null
  country: string | null
  pincode: string | null
  /** "Delhi, India" — the line the table prints under the branch. Null when nothing is set. */
  label: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function placeOf(warehouse: Warehouse): WarehousePlace {
  const address = (warehouse.address ?? {}) as Record<string, unknown>
  const city = text(address.city)
  const state = text(address.state)
  const country = text(address.country)
  const parts = [city, state, country].filter((p): p is string => p !== null)
  return {
    city,
    state,
    country,
    pincode: text(address.pincode),
    // City and state, or state and country — never all three, which reads as an
    // envelope rather than a location.
    label: parts.length === 0 ? null : parts.slice(0, 2).join(', '),
  }
}

/** A warehouse's point on the map, when it has both halves of one. */
export function coordinatesOf(warehouse: Warehouse): { lat: number; lng: number } | null {
  const lat = toNumber(warehouse.latitude)
  const lng = toNumber(warehouse.longitude)
  if (lat === null || lng === null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export interface LocationGroup {
  key: string
  country: string
  state: string
  city: string
  warehouses: Warehouse[]
}

/**
 * Warehouses grouped country > state > city, for the By Location view.
 *
 * Groups on the rows given, so it reflects whatever filter the toolbar has
 * applied. Warehouses with no address collect under one "No location set"
 * group rather than being dropped — a master screen that quietly hides rows is
 * worse than one that admits the data is incomplete.
 */
export function groupByLocation(rows: readonly Warehouse[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>()
  for (const row of rows) {
    const place = placeOf(row)
    const country = place.country ?? ''
    const state = place.state ?? ''
    const city = place.city ?? ''
    const key = `${country}\u0000${state}\u0000${city}`
    const existing = groups.get(key)
    if (existing) existing.warehouses.push(row)
    else groups.set(key, { key, country, state, city, warehouses: [row] })
  }
  return [...groups.values()].sort((a, b) => {
    // Unplaced warehouses sort last: they are a data-entry to-do, not a location.
    const aEmpty = a.country === '' && a.state === '' && a.city === ''
    const bEmpty = b.country === '' && b.state === '' && b.city === ''
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    if (b.warehouses.length !== a.warehouses.length) return b.warehouses.length - a.warehouses.length
    return `${a.country}${a.state}${a.city}`.localeCompare(`${b.country}${b.state}${b.city}`)
  })
}

/** Label for a location group — "New Delhi, Delhi, India", or the honest fallback. */
export function locationGroupLabel(group: LocationGroup): string {
  const parts = [group.city, group.state, group.country].filter((p) => p !== '')
  return parts.length === 0 ? 'No location set' : parts.join(', ')
}

/**
 * Donut slices: stock quantity per warehouse, largest first.
 *
 * Quantity, not value, because the donut sits on a masters screen every user
 * with warehouse read access can open, and valuation is a separate permission.
 * `sub` carries the value only when the caller is entitled to it.
 */
export function stockSeries(
  rows: readonly Warehouse[],
  stock: Map<number, WarehouseStock>,
  formatValue: (value: number) => string,
): SeriesItem[] {
  const entries = rows
    .map((row) => ({ row, stock: stock.get(row.warehouse_id) ?? EMPTY_STOCK }))
    .filter((e) => e.stock.qty > 0)
    .sort((a, b) => b.stock.qty - a.stock.qty)
  const total = entries.reduce((sum, e) => sum + e.stock.qty, 0)
  const max = entries.reduce((m, e) => Math.max(m, e.stock.qty), 0)
  return entries.map((e) => ({
    key: String(e.row.warehouse_id),
    label: e.row.warehouse_name,
    value: e.stock.qty,
    display: formatQty(e.stock.qty),
    share: total > 0 ? (e.stock.qty / total) * 100 : 0,
    scale: max > 0 ? (e.stock.qty / max) * 100 : 0,
    tone: 'info',
    sub: e.stock.value !== null ? formatValue(e.stock.value) : undefined,
    to: `/registers/warehouse-stock?warehouse_id=${e.row.warehouse_id}`,
  }))
}

/** Total stock quantity across the warehouses given. */
export function totalStockQty(rows: readonly Warehouse[], stock: Map<number, WarehouseStock>): number {
  return rows.reduce((sum, row) => sum + (stock.get(row.warehouse_id)?.qty ?? 0), 0)
}
