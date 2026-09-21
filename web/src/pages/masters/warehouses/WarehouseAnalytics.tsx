import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Grid3x3,
  LayoutGrid,
  MapPin,
  Plus,
  Scale,
  Star,
  TrendingDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DonutChart } from '../../../dashboard/charts/DonutChart'
import { Card, CardHeader, EmptyState, IconTile, cx } from '../../../ui'
import type { Warehouse, WarehouseSummary } from '../../../services/masters'
import { formatCompactMoney, formatInt, formatQty } from '../../../utils/format'
import { buildWarehouseInsights } from './warehouseInsights'
import type { InsightIcon, WarehouseInsight } from './warehouseInsights'
import { plotWarehouses } from './WarehouseViews'
import { stockSeries, totalStockQty } from './warehouseMetrics'
import type { WarehouseStock } from './warehouseMetrics'

/**
 * The three cards under the table: where the warehouses are, what they hold,
 * and what to do next.
 *
 * All three are computed from data already on screen — the company summary and
 * the one warehouse-stock report the page fetched. None of them issues its own
 * request, and none of them renders a figure the user cannot find again on a
 * report.
 */

export interface WarehouseAnalyticsProps {
  summary: WarehouseSummary | null
  /** Every warehouse in scope; empty until the analytics tab has loaded them. */
  rows: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  canSeeStock: boolean
  canSeeStockValue: boolean
  currency: string
  locationCount: number | null
  loading: boolean
  className?: string
}

export function WarehouseAnalytics({
  summary,
  rows,
  stock,
  canSeeStock,
  canSeeStockValue,
  currency,
  locationCount,
  loading,
  className,
}: WarehouseAnalyticsProps) {
  return (
    <div className={cx('grid gap-3.5 lg:grid-cols-2 wide:grid-cols-[1.2fr_0.9fr_0.9fr]', className)}>
      <WarehouseDistribution summary={summary} rows={rows} loading={loading} />
      <WarehouseStockChart
        rows={rows}
        stock={stock}
        canSeeStock={canSeeStock}
        canSeeStockValue={canSeeStockValue}
        currency={currency}
        loading={loading}
      />
      <WarehouseInsightsCard
        rows={rows}
        stock={stock}
        summary={summary}
        locationCount={locationCount}
        loading={loading}
        className="lg:col-span-2 wide:col-span-1"
      />
    </div>
  )
}

function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cx('min-h-[268px]', className)}>
      <span className="skeleton block h-4 w-40 rounded mb-4" aria-hidden />
      <span className="skeleton block h-[190px] w-full rounded-xl" aria-hidden />
    </Card>
  )
}

// ------------------------------------------------------------ distribution

function WarehouseDistribution({
  summary,
  rows,
  loading,
}: {
  summary: WarehouseSummary | null
  rows: readonly Warehouse[]
  loading: boolean
}) {
  if (loading && !summary) return <CardSkeleton />
  if (!summary) return null

  const places = summary.by_location.filter((l) => l.city !== '' || l.state !== '' || l.country !== '')
  const cities = new Set(places.filter((l) => l.city !== '').map((l) => `${l.country}/${l.state}/${l.city}`)).size
  const plotted = plotWarehouses(rows)

  return (
    <Card className="min-h-[268px]">
      <CardHeader title="Warehouse distribution" description="Where this company holds stock" />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(120px,0.7fr)]">
        <div className="min-h-[190px] rounded-xl border border-gray-200 bg-gray-50 overflow-hidden relative">
          {plotted.length > 0 ? (
            <div className="absolute inset-0" role="img" aria-label={`${plotted.length} warehouses plotted by coordinates`}>
              {plotted.map((p) => (
                <span
                  key={p.warehouse.warehouse_id}
                  className="absolute -translate-x-1/2 -translate-y-full text-primary"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  title={p.warehouse.warehouse_name}
                >
                  <MapPin className="w-4 h-4" aria-hidden />
                </span>
              ))}
            </div>
          ) : places.length > 0 ? (
            /* No coordinates: the postal addresses still say where the warehouses
               are, so the card lists those rather than showing an empty frame. */
            <ul className="absolute inset-0 overflow-y-auto p-2.5 space-y-1">
              {places.slice(0, 8).map((l) => (
                <li key={`${l.country}/${l.state}/${l.city}`} className="flex items-center gap-2 text-xs">
                  <MapPin className="w-3 h-3 text-gray-400 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-gray-700">
                    {[l.city, l.state, l.country].filter((p) => p !== '').join(', ')}
                  </span>
                  <span className="tabular-nums font-semibold text-gray-900 shrink-0">{formatInt(l.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="absolute inset-0 grid place-items-center px-4">
              <p className="text-[11px] text-center text-gray-500">
                No warehouse has an address yet. Add a city on the warehouse form to see the spread.
              </p>
            </div>
          )}
        </div>

        <dl className="grid content-center gap-3">
          <Stat label="With warehouses" value={`${formatInt(cities)} ${cities === 1 ? 'city' : 'cities'}`} />
          <Stat label="Warehouses" value={`${formatInt(summary.active)} active`} />
          <Stat label="Warehouses" value={`${formatInt(summary.inactive)} inactive`} />
          <Stat label="With coordinates" value={formatInt(summary.geo.with_coordinates)} />
        </dl>
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dd className="text-xs font-semibold text-gray-900 order-1">{value}</dd>
      <dt className="text-[10.5px] text-gray-500 order-2">{label}</dt>
    </div>
  )
}

// ------------------------------------------------------------ stock donut

function WarehouseStockChart({
  rows,
  stock,
  canSeeStock,
  canSeeStockValue,
  currency,
  loading,
}: {
  rows: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  canSeeStock: boolean
  canSeeStockValue: boolean
  currency: string
  loading: boolean
}) {
  if (loading && rows.length === 0) return <CardSkeleton />

  if (!canSeeStock) {
    return (
      <Card className="min-h-[268px]">
        <CardHeader title="Stock by warehouse" />
        <EmptyState
          icon={Boxes}
          title="Stock is not visible to you"
          description="Reading the warehouse stock report is a separate permission."
          compact
        />
      </Card>
    )
  }

  const series = stockSeries(rows, stock, (value) => formatCompactMoney(value, currency))
  const total = totalStockQty(rows, stock)

  return (
    <Card className="min-h-[268px]">
      <CardHeader title="Stock by warehouse" description={canSeeStockValue ? 'Quantity on hand, value on hover' : 'Quantity on hand'} />
      {series.length === 0 ? (
        <EmptyState icon={Boxes} title="No stock on hand" description="Nothing is held in any warehouse in this period." compact />
      ) : (
        <DonutChart items={series} centerValue={formatQty(total)} centerLabel="Total stock" ariaLabel="Share of stock quantity by warehouse" />
      )}
    </Card>
  )
}

// ------------------------------------------------------------ insights

const INSIGHT_ICONS: Record<InsightIcon, LucideIcon> = {
  balanced: Scale,
  add: Plus,
  alert: AlertTriangle,
  bins: Grid3x3,
  map: MapPin,
  empty: LayoutGrid,
  negative: TrendingDown,
  capacity: Boxes,
  default: Star,
}

function WarehouseInsightsCard({
  rows,
  stock,
  summary,
  locationCount,
  loading,
  className,
}: {
  rows: readonly Warehouse[]
  stock: Map<number, WarehouseStock>
  summary: WarehouseSummary | null
  locationCount: number | null
  loading: boolean
  className?: string
}) {
  if (loading && rows.length === 0) return <CardSkeleton className={className} />

  const insights: WarehouseInsight[] = buildWarehouseInsights({
    warehouses: rows,
    stock,
    locationCount,
    defaultCount: summary?.defaults ?? 0,
  })

  return (
    <Card className={cx('min-h-[268px] flex flex-col', className)}>
      <CardHeader
        title="Quick insights"
        action={
          <Link to="/reports" className="text-[10.5px] font-semibold text-gray-600 hover:text-primary inline-flex items-center gap-1 no-underline">
            View reports
            <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        }
      />
      {insights.length === 0 ? (
        <EmptyState icon={Scale} title="Nothing needs attention" description="No warehouse is over capacity, negative or unconfigured." compact />
      ) : (
        <ul className="space-y-1.5">
          {insights.map((insight) => {
            const Icon = INSIGHT_ICONS[insight.icon]
            return (
              <li key={insight.id}>
                <Link
                  to={insight.to}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-gray-100 bg-white p-2 no-underline transition-colors hover:bg-gray-50"
                >
                  <IconTile icon={Icon} tone={insight.tone} size="sm" />
                  <span className="min-w-0 grid gap-0.5">
                    <span className="text-[11px] font-semibold text-gray-900">{insight.title}</span>
                    <span className="text-[9.5px] leading-snug text-gray-500">{insight.detail}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
