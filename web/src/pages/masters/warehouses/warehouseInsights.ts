/**
 * The Quick Insights card, computed — not written.
 *
 * Every line this returns is a statement about the company's own warehouses,
 * derived from figures already on screen, and every one carries a link to the
 * screen that acts on it. Nothing here is a slogan: if the data does not
 * support a claim, the claim is not produced. That is why "Stock is well
 * distributed" is gated on there actually being capacities to judge
 * distribution by, rather than being the cheerful default.
 *
 * Ordered by urgency, capped by the caller: a card that lists nine things
 * prioritises none of them.
 */

import type { Warehouse } from '../../../services/masters'
import { capacityOf, placeOf, utilisationOf } from './warehouseMetrics'
import type { WarehouseStock } from './warehouseMetrics'

export type InsightIcon = 'balanced' | 'add' | 'alert' | 'bins' | 'map' | 'empty' | 'negative' | 'capacity' | 'default'
export type InsightTone = 'success' | 'info' | 'warning' | 'danger' | 'violet'

export interface WarehouseInsight {
  id: string
  title: string
  detail: string
  icon: InsightIcon
  tone: InsightTone
  /** Where the insight is actioned. Every insight has one. */
  to: string
}

export interface InsightInput {
  /** Every warehouse in scope — not the page on screen. */
  warehouses: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  /** Bin/zone rows configured, from the locations master. null = not loaded yet. */
  locationCount: number | null
  /** Warehouses flagged as the company default. */
  defaultCount: number
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export function buildWarehouseInsights(input: InsightInput, limit = 4): WarehouseInsight[] {
  const { warehouses, stock, locationCount, defaultCount } = input
  const out: WarehouseInsight[] = []
  if (warehouses.length === 0) return out

  const active = warehouses.filter((w) => Number(w.is_active) === 1)
  const withCapacity = warehouses
    .map((w) => ({ w, capacity: capacityOf(w) }))
    .filter((e): e is { w: Warehouse; capacity: number } => e.capacity !== null)

  const utilisations = withCapacity.map((e) => ({
    w: e.w,
    pct: utilisationOf(e.capacity, stock.get(e.w.warehouse_id)?.qty ?? 0) ?? 0,
  }))
  const over90 = utilisations.filter((u) => u.pct > 90)
  const over80 = utilisations.filter((u) => u.pct > 80)
  const negative = warehouses.filter((w) => (stock.get(w.warehouse_id)?.qty ?? 0) < 0)
  const emptyActive = active.filter((w) => (stock.get(w.warehouse_id)?.qty ?? 0) === 0)
  const unplaced = warehouses.filter((w) => placeOf(w).label === null)

  // --- things that are wrong now ------------------------------------------
  if (negative.length > 0) {
    out.push({
      id: 'negative-stock',
      title: `${negative.length} ${plural(negative.length, 'warehouse holds', 'warehouses hold')} negative stock`,
      detail: 'Stock has been issued that was never received. Review the balances.',
      icon: 'negative',
      tone: 'danger',
      to: '/registers/stock-balances?negative=1',
    })
  }

  if (over90.length > 0) {
    out.push({
      id: 'over-capacity',
      title: `${over90.length} ${plural(over90.length, 'warehouse is', 'warehouses are')} over 90% full`,
      detail: over90.length === 1 ? `${over90[0].w.warehouse_name} is at ${over90[0].pct.toFixed(0)}% of its capacity.` : 'Plan a transfer before receiving more stock.',
      icon: 'alert',
      tone: 'danger',
      to: '/masters/warehouses?view=capacity',
    })
  } else if (over80.length > 0) {
    out.push({
      id: 'filling-up',
      title: `${over80.length} ${plural(over80.length, 'warehouse is', 'warehouses are')} above 80% capacity`,
      detail: 'Still within capacity, but worth watching.',
      icon: 'alert',
      tone: 'warning',
      to: '/masters/warehouses?view=capacity',
    })
  }

  // --- things that are not set up -----------------------------------------
  if (withCapacity.length === 0) {
    out.push({
      id: 'capacity-missing',
      title: 'Warehouse capacity is not configured',
      detail: 'Set a maximum stock quantity to track how full each warehouse is.',
      icon: 'capacity',
      tone: 'violet',
      to: '/masters/warehouses?view=capacity',
    })
  } else if (withCapacity.length < warehouses.length) {
    const missing = warehouses.length - withCapacity.length
    out.push({
      id: 'capacity-partial',
      title: `${missing} of ${warehouses.length} warehouses have no capacity set`,
      detail: 'Utilisation is measured only across the ones that do.',
      icon: 'capacity',
      tone: 'violet',
      to: '/masters/warehouses?view=capacity',
    })
  }

  if (defaultCount === 0) {
    out.push({
      id: 'no-default',
      title: 'No default warehouse',
      detail: 'Documents that do not name a warehouse have nowhere to post.',
      icon: 'default',
      tone: 'warning',
      to: '/masters/warehouses',
    })
  }

  if (locationCount === 0) {
    out.push({
      id: 'enable-bins',
      title: 'Enable bin locations',
      detail: 'Zones, racks and bins make counting and picking accurate.',
      icon: 'bins',
      tone: 'info',
      to: '/masters/locations',
    })
  }

  if (unplaced.length > 0) {
    out.push({
      id: 'no-address',
      title: `${unplaced.length} ${plural(unplaced.length, 'warehouse has', 'warehouses have')} no address`,
      detail: 'Add a city to group them by location and plot them on the map.',
      icon: 'map',
      tone: 'info',
      to: '/masters/warehouses?view=location',
    })
  }

  // --- observations, only when they are earned ----------------------------
  if (emptyActive.length > 0 && emptyActive.length < active.length) {
    out.push({
      id: 'empty-warehouses',
      title: `${emptyActive.length} active ${plural(emptyActive.length, 'warehouse is', 'warehouses are')} empty`,
      detail: 'No stock on hand. Check whether they are still in use.',
      icon: 'empty',
      tone: 'warning',
      to: '/registers/stock-balances',
    })
  }

  if (over80.length === 0 && withCapacity.length > 1) {
    out.push({
      id: 'well-distributed',
      title: 'Stock is well distributed',
      detail: 'No warehouse is above 80% of its capacity.',
      icon: 'balanced',
      tone: 'success',
      to: '/reports/warehouse-stock',
    })
  }

  if (warehouses.length === 1) {
    out.push({
      id: 'add-more',
      title: 'Add more warehouses',
      detail: 'Separate locations give you stock visibility per site.',
      icon: 'add',
      tone: 'violet',
      to: '/masters/warehouses?new=1',
    })
  }

  return out.slice(0, limit)
}
