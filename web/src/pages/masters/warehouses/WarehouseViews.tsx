import { MapPin, Package, Warehouse as WarehouseIcon } from 'lucide-react'
import { Badge, EmptyState, ProgressBar, Tooltip, cx } from '../../../ui'
import type { Warehouse } from '../../../services/masters'
import { formatInt, formatQty, humanize } from '../../../utils/format'
import {
  capacityOf,
  coordinatesOf,
  groupByLocation,
  locationGroupLabel,
  utilisationLevel,
  utilisationOf,
  EMPTY_STOCK,
} from './warehouseMetrics'
import type { UtilisationLevel, WarehouseStock } from './warehouseMetrics'

/**
 * The three alternate readings of the same warehouse rows.
 *
 * Views, not copies: each one renders the list the toolbar has already
 * filtered, fetched once. Nothing here has its own store, its own endpoint or
 * its own idea of what a warehouse is.
 */

const BAR: Record<UtilisationLevel, string> = {
  empty: 'bg-gray-300',
  normal: 'bg-primary',
  warning: 'bg-amber-500',
  high: 'bg-red-500',
}

interface ViewProps {
  rows: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  canSeeStock: boolean
  loading: boolean
  onOpen: (row: Warehouse) => void
}

function ViewSkeleton() {
  return (
    <div className="p-4 space-y-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="skeleton block h-14 w-full rounded-xl" />
      ))}
    </div>
  )
}

// --------------------------------------------------------------------- location

export function WarehouseByLocationView({ rows, stock, canSeeStock, loading, onOpen }: ViewProps) {
  if (loading && rows.length === 0) return <ViewSkeleton />
  const groups = groupByLocation(rows)
  if (groups.length === 0) {
    return <EmptyState icon={MapPin} title="Nothing to group" description="No warehouses match the current filters." className="py-10" />
  }

  return (
    <div className="p-4 space-y-4">
      {groups.map((group) => {
        const active = group.warehouses.filter((w) => Number(w.is_active) === 1).length
        return (
          <section key={group.key} aria-label={locationGroupLabel(group)}>
            <header className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden />
              <h3 className="text-xs font-semibold text-gray-900">{locationGroupLabel(group)}</h3>
              <Badge tone="neutral" size="xs">
                {formatInt(group.warehouses.length)}
              </Badge>
              <span className="text-[10.5px] text-gray-500">{formatInt(active)} active</span>
            </header>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {group.warehouses.map((w) => {
                const s = canSeeStock ? (stock.get(w.warehouse_id) ?? EMPTY_STOCK) : null
                return (
                  <li key={w.warehouse_id}>
                    <button
                      type="button"
                      onClick={() => onOpen(w)}
                      className="w-full flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/30"
                    >
                      <span className="w-9 h-9 shrink-0 grid place-items-center rounded-lg bg-gray-50 text-gray-500" aria-hidden>
                        <WarehouseIcon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1 grid gap-0.5">
                        <span className="text-xs font-semibold text-gray-900 truncate">{w.warehouse_name}</span>
                        <span className="text-[10.5px] text-gray-500 truncate">
                          {humanize(w.warehouse_type)}
                          {w.warehouse_code ? ` · ${w.warehouse_code}` : ''}
                        </span>
                      </span>
                      {s ? <span className="text-[11px] font-semibold text-gray-700 tabular-nums shrink-0">{formatQty(s.qty)}</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------------- capacity

export function WarehouseCapacityView({ rows, stock, canSeeStock, loading, onOpen }: ViewProps) {
  if (loading && rows.length === 0) return <ViewSkeleton />

  const configured = rows.filter((w) => capacityOf(w) !== null)
  if (configured.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No warehouse has a capacity yet"
        description="Set a maximum stock quantity on a warehouse and this view shows how full each one is, with the stock it holds against the ceiling you set."
        className="py-10"
      />
    )
  }

  const ranked = [...configured].sort((a, b) => {
    const ua = utilisationOf(capacityOf(a), stock.get(a.warehouse_id)?.qty ?? 0) ?? 0
    const ub = utilisationOf(capacityOf(b), stock.get(b.warehouse_id)?.qty ?? 0) ?? 0
    return ub - ua
  })
  const unconfigured = rows.length - configured.length

  return (
    <div className="p-4 space-y-2">
      {unconfigured > 0 ? (
        <p className="text-[11px] text-gray-500 mb-1">
          {formatInt(unconfigured)} of {formatInt(rows.length)} warehouses have no capacity set and are not listed here.
        </p>
      ) : null}
      <ul className="space-y-2">
        {ranked.map((w) => {
          const capacity = capacityOf(w) as number
          const qty = stock.get(w.warehouse_id)?.qty ?? 0
          const pct = canSeeStock ? (utilisationOf(capacity, qty) ?? 0) : null
          const level = utilisationLevel(pct)
          return (
            <li key={w.warehouse_id}>
              <button
                type="button"
                onClick={() => onOpen(w)}
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/20"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-semibold text-gray-900 truncate">{w.warehouse_name}</span>
                  <span className="text-[11px] tabular-nums text-gray-500 shrink-0">
                    {pct === null ? 'Stock unavailable' : `${formatQty(qty)} of ${formatQty(capacity)} units`}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar
                    value={pct === null ? 0 : Math.min(100, pct)}
                    size="md"
                    className="flex-1"
                    barClassName={BAR[level]}
                    aria-label={`${w.warehouse_name} utilisation`}
                  />
                  <span className={cx('text-[11px] font-semibold tabular-nums w-12 text-right', level === 'high' ? 'text-red-600' : level === 'warning' ? 'text-amber-600' : 'text-gray-700')}>
                    {pct === null ? '—' : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// --------------------------------------------------------------------- map

export interface PlottedWarehouse {
  warehouse: Warehouse
  lat: number
  lng: number
  /** 0-100 within the plotted bounds. */
  x: number
  y: number
}

/**
 * Warehouses positioned within the bounding box of the points themselves.
 *
 * There is no map library in this project and no tile provider configured, and
 * adding a paid one for a master screen is not a decision this component gets
 * to make. So this plots the real coordinates on a real equirectangular
 * projection of the area they cover, and says plainly that it is a coordinate
 * plot rather than dressing itself up as a map. The geometry is exported and
 * pure so the positions can be tested.
 */
export function plotWarehouses(rows: readonly Warehouse[]): PlottedWarehouse[] {
  const points = rows
    .map((warehouse) => ({ warehouse, coords: coordinatesOf(warehouse) }))
    .filter((p): p is { warehouse: Warehouse; coords: { lat: number; lng: number } } => p.coords !== null)
  if (points.length === 0) return []

  const lats = points.map((p) => p.coords.lat)
  const lngs = points.map((p) => p.coords.lng)
  // A single point, or several at the same place, has no extent; padding keeps
  // the divisor away from zero and puts the pin in the middle instead of a corner.
  const pad = 0.5
  const minLat = Math.min(...lats) - pad
  const maxLat = Math.max(...lats) + pad
  const minLng = Math.min(...lngs) - pad
  const maxLng = Math.max(...lngs) + pad

  return points.map(({ warehouse, coords }) => ({
    warehouse,
    lat: coords.lat,
    lng: coords.lng,
    x: ((coords.lng - minLng) / (maxLng - minLng)) * 100,
    // Latitude grows north, the viewport grows down.
    y: ((maxLat - coords.lat) / (maxLat - minLat)) * 100,
  }))
}

export function WarehouseMapView({ rows, stock, canSeeStock, loading, onOpen }: ViewProps) {
  if (loading && rows.length === 0) return <ViewSkeleton />

  const plotted = plotWarehouses(rows)
  const missing = rows.length - plotted.length

  if (plotted.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No warehouse has coordinates yet"
        description="Add a latitude and longitude on the warehouse form and it appears here. The city and state on the address already power the By location view."
        className="py-10"
      />
    )
  }

  return (
    <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)]">
      <div
        className="relative min-h-[280px] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden"
        role="img"
        aria-label={`Coordinate plot of ${plotted.length} warehouse${plotted.length === 1 ? '' : 's'}`}
      >
        <svg className="absolute inset-0 w-full h-full text-gray-200" aria-hidden>
          <defs>
            <pattern id="wh-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wh-grid)" />
        </svg>
        {plotted.map((p) => (
          <Tooltip key={p.warehouse.warehouse_id} label={`${p.warehouse.warehouse_name} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}>
            <button
              type="button"
              onClick={() => onOpen(p.warehouse)}
              className="absolute -translate-x-1/2 -translate-y-full rounded p-0.5 text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <MapPin className="w-5 h-5 drop-shadow" aria-hidden />
              <span className="sr-only">{p.warehouse.warehouse_name}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 mb-2">
          Plotted from the coordinates stored on each warehouse. No map provider is configured, so this is a plain coordinate plot.
        </p>
        <ul className="space-y-1.5 max-h-[260px] overflow-y-auto">
          {plotted.map((p) => (
            <li key={p.warehouse.warehouse_id}>
              <button
                type="button"
                onClick={() => onOpen(p.warehouse)}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-primary-light/40 transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 grid gap-0.5">
                  <span className="text-xs font-semibold text-gray-900 truncate">{p.warehouse.warehouse_name}</span>
                  <span className="text-[10.5px] text-gray-500 tabular-nums">
                    {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                  </span>
                </span>
                {canSeeStock ? (
                  <span className="text-[11px] tabular-nums text-gray-600 shrink-0">{formatQty(stock.get(p.warehouse.warehouse_id)?.qty ?? 0)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {missing > 0 ? (
          <p className="mt-2 text-[10.5px] text-gray-500">
            {formatInt(missing)} warehouse{missing === 1 ? ' has' : 's have'} no coordinates and {missing === 1 ? 'is' : 'are'} not plotted.
          </p>
        ) : null}
      </div>
    </div>
  )
}
