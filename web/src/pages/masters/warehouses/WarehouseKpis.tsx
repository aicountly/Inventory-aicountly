import { Building2, CheckCircle2, Gauge, PauseCircle, Package } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, IconTile, ProgressBar, Tooltip, cx } from '../../../ui'
import type { IconTone } from '../../../ui'
import { AREA_UNIT_LABELS } from '../../../services/masters'
import type { AreaUnit, WarehouseSummary } from '../../../services/masters'
import { formatInt, formatQty } from '../../../utils/format'
import { utilisationLevel } from './warehouseMetrics'
import type { UtilisationLevel } from './warehouseMetrics'

/**
 * The five figures a user should be able to read in about five seconds: how
 * many warehouses there are, how many are working, how many are not, how much
 * they can hold and how full they are.
 *
 * Every one comes from `GET /v1/warehouses/summary` (counts, capacity) or the
 * warehouse-stock report (quantity) — never from the rows on screen, which are
 * one page of a filtered list and would make "Total capacity" a different
 * number on page two.
 *
 * Where a figure cannot be computed, the card says so. "Not configured" is a
 * real and useful answer: it tells the user there is a field to fill in, which
 * a 0 would not, and it is the only honest thing to print when no warehouse in
 * the company has a capacity.
 */

const CARD_CLASS = 'flex flex-row items-start gap-3 min-w-[160px] min-h-[104px]'
const LABEL_CLASS = 'text-[11px] font-medium text-gray-500 uppercase tracking-wide truncate'
const VALUE_CLASS = 'mt-1 text-2xl leading-none font-semibold tabular-nums text-gray-900 truncate'
const HINT_CLASS = 'mt-1.5 text-[11px] text-gray-500 min-h-[16px]'

interface KpiCardProps {
  label: string
  value: string
  hint?: string
  /** Explains the arithmetic, for a figure a reader may want to check. */
  tooltip?: string
  icon: LucideIcon
  tone: IconTone
  children?: React.ReactNode
}

function KpiCard({ label, value, hint, tooltip, icon, tone, children }: KpiCardProps) {
  const body = (
    <>
      <p className={VALUE_CLASS}>{value}</p>
      {children}
      {hint ? <p className={HINT_CLASS}>{hint}</p> : <p className={HINT_CLASS} />}
    </>
  )
  return (
    <Card padding="sm" className={CARD_CLASS}>
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        <p className={LABEL_CLASS}>{label}</p>
        {tooltip ? <Tooltip label={tooltip}>{body}</Tooltip> : body}
      </div>
    </Card>
  )
}

function KpiSkeleton() {
  return (
    <Card padding="sm" className={CARD_CLASS}>
      <span className="skeleton w-12 h-12 rounded-xl shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <span className="skeleton block h-3 w-20 rounded" aria-hidden />
        <span className="skeleton block h-6 w-24 rounded" aria-hidden />
        <span className="skeleton block h-3 w-16 rounded" aria-hidden />
      </div>
    </Card>
  )
}

/** The bar's colour by band. The percentage is always printed beside it — colour never carries the status alone. */
const UTILISATION_BAR: Record<UtilisationLevel, string> = {
  empty: 'bg-gray-300',
  normal: 'bg-primary',
  warning: 'bg-amber-500',
  high: 'bg-red-500',
}

export interface WarehouseKpisProps {
  summary: WarehouseSummary | null
  loading: boolean
  /** Total stock quantity across the company, from the warehouse-stock report. */
  stockQty: number | null
  className?: string
}

/** "2,500 Sq. Ft.", or "2,500 Sq. Ft. + 2 more units" when the company mixes units. */
function areaLine(summary: WarehouseSummary): string | undefined {
  const units = summary.capacity.area_by_unit
  if (units.length === 0) return undefined
  const [first, ...rest] = units
  const label = AREA_UNIT_LABELS[first.unit as AreaUnit] ?? first.unit
  const head = `${formatQty(first.area)} ${label}`
  return rest.length === 0 ? head : `${head} + ${rest.length} more unit${rest.length === 1 ? '' : 's'}`
}

export function WarehouseKpis({ summary, loading, stockQty, className }: WarehouseKpisProps) {
  const grid = cx('grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-5', className)

  if (loading && !summary) {
    return (
      <div className={grid}>
        {[0, 1, 2, 3, 4].map((i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (!summary) return null

  const { total, active, inactive } = summary
  const share = (n: number): string => (total > 0 ? `${Math.round((n / total) * 100)}% of total` : '—')

  const capacity = summary.capacity.units
  const capacityConfigured = summary.capacity.configured
  const hasCapacity = capacity !== null && capacity > 0

  // Utilisation is only meaningful against a configured ceiling, and only over
  // the warehouses that have one. Reporting it across warehouses with no
  // capacity would divide the company's whole stock by part of its shelf space.
  const utilisation = hasCapacity && stockQty !== null ? Math.max(0, (stockQty / capacity) * 100) : null
  const level = utilisationLevel(utilisation)

  return (
    <div className={grid}>
      <KpiCard
        label="Total warehouses"
        value={formatInt(total)}
        hint={summary.defaults > 0 ? `${formatInt(summary.defaults)} default` : 'No default set'}
        icon={Building2}
        tone="info"
      />
      <KpiCard label="Active" value={formatInt(active)} hint={share(active)} icon={CheckCircle2} tone="success" />
      <KpiCard label="Inactive" value={formatInt(inactive)} hint={share(inactive)} icon={PauseCircle} tone="danger" />
      <KpiCard
        label="Total capacity"
        value={hasCapacity ? `${formatQty(capacity)} Units` : 'Not configured'}
        hint={hasCapacity ? (areaLine(summary) ?? `${formatInt(capacityConfigured)} of ${formatInt(total)} configured`) : 'Set a maximum stock quantity on a warehouse'}
        tooltip={hasCapacity ? `Sum of the maximum stock quantity on ${formatInt(capacityConfigured)} of ${formatInt(total)} warehouses.` : undefined}
        icon={Package}
        tone="info"
      />
      <KpiCard
        label="Utilisation"
        value={utilisation === null ? 'Not configured' : `${utilisation.toFixed(utilisation >= 10 ? 0 : 1)}%`}
        hint={
          utilisation === null
            ? hasCapacity
              ? 'Stock figures unavailable'
              : 'Needs a configured capacity'
            : `${formatQty(stockQty ?? 0)} of ${formatQty(capacity)} units`
        }
        tooltip={utilisation === null ? undefined : 'Stock on hand divided by the configured capacity, across the warehouses that have one.'}
        icon={Gauge}
        tone={level === 'high' ? 'danger' : level === 'warning' ? 'warning' : 'success'}
      >
        {utilisation === null ? null : (
          <ProgressBar
            value={Math.min(100, utilisation)}
            size="sm"
            className="mt-2"
            barClassName={UTILISATION_BAR[level]}
            aria-label={`Utilisation ${utilisation.toFixed(1)} percent`}
          />
        )}
      </KpiCard>
    </div>
  )
}
