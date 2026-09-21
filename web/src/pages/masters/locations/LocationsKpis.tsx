import { CircleCheck, CirclePause, MapPin, Warehouse } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { cx } from '../../../ui/cx'
import { formatInt } from '../../../utils/format'
import type { LocationStats } from './locationsModel'

/**
 * The four figures over the list.
 *
 * Every one is counted from the rows the API returned for the current company,
 * warehouse and type — never from the page on screen, and never from a
 * status-filtered set, or "Inactive 0" would just be the filter talking.
 *
 * `previous` is deliberately never passed: the API sends no comparative for a
 * master, so no card gets a delta chip. The `hint` line carries the real
 * supporting figure instead.
 */

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'

export interface LocationsKpisProps {
  stats: LocationStats
  /** Warehouses the company has, for the coverage denominator. */
  warehouseCount: number
  loading?: boolean
  /** The stats walk hit its row cap, so these are a floor, not a total. */
  truncated?: boolean
  className?: string
}

function pct(value: number): string {
  if (value <= 0) return '0% of total'
  if (value >= 99.5 && value < 100) return '>99% of total'
  return `${Math.round(value)}% of total`
}

export function LocationsKpis({
  stats,
  warehouseCount,
  loading = false,
  truncated = false,
  className,
}: LocationsKpisProps) {
  if (loading) {
    return (
      <div className={cx(GRID, className)} aria-hidden>
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
      </div>
    )
  }

  const empty = stats.total === 0

  return (
    <section className={cx(GRID, className)} aria-label="Location statistics">
      <StatCard
        layout="metric"
        icon={MapPin}
        tone="primary"
        label="Total locations"
        value={formatInt(stats.total)}
        hint={
          truncated
            ? 'First 10,000 rows'
            : empty
              ? 'None created yet'
              : `Across ${formatInt(stats.warehousesCovered)} ${stats.warehousesCovered === 1 ? 'warehouse' : 'warehouses'}`
        }
      />
      <StatCard
        layout="metric"
        icon={CircleCheck}
        tone="info"
        label="Active"
        value={formatInt(stats.active)}
        hint={empty ? '—' : pct(stats.activePct)}
      />
      <StatCard
        layout="metric"
        icon={CirclePause}
        tone="warning"
        label="Inactive"
        value={formatInt(stats.inactive)}
        hint={empty ? '—' : pct(stats.inactivePct)}
      />
      <StatCard
        layout="metric"
        icon={Warehouse}
        tone="violet"
        label="Warehouses covered"
        value={formatInt(stats.warehousesCovered)}
        hint={
          warehouseCount > 0
            ? `of ${formatInt(warehouseCount)} ${warehouseCount === 1 ? 'warehouse' : 'warehouses'}`
            : '—'
        }
      />
    </section>
  )
}

export default LocationsKpis
