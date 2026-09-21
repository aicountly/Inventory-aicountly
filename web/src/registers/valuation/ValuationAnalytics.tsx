import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, PieChart, TrendingUp, Warehouse } from 'lucide-react'
import { BarList } from '../../dashboard/charts/BarList'
import { DonutChart } from '../../dashboard/charts/DonutChart'
import { TrendAreaChart } from '../../dashboard/charts/TrendAreaChart'
import { formatCurrencyCompact, formatQtyCompact } from '../../dashboard/formatters'
import { CHART_RAMP_PRIMARY } from '../../dashboard/visuals'
import { Card } from '../../ui/Card'
import { Select } from '../../ui/Select'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton, SkeletonRows } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatMoney } from '../../utils/format'
import type { ValuationSnapshotSummary } from '../../services/valuationApi'
import { useValuationAnalytics } from './useValuationAnalytics'
import type { ValuationFilters } from './useValuationAnalytics'
import {
  DEFAULT_TREND_PERIOD,
  TREND_PERIODS,
  composition,
  monthLabel,
  negativesNote,
  warehouseComposition,
} from './valuationAnalyticsModel'
import type { TrendPeriod, WarehouseMeasure } from './valuationAnalyticsModel'

/**
 * The three questions a valuation register cannot answer row by row: how the
 * stock's value has moved, which items hold it, and where it is sitting.
 *
 * Everything drawn here is a figure the valuation engine returned under the
 * register's own filters — see `useValuationAnalytics` for why the warehouse
 * split replays the snapshot per warehouse instead of borrowing the ready-made
 * breakdown on the warehouse-stock report.
 *
 * Each card fails and loads on its own. A slow trend must not hold up the
 * donut, and a 403 on one of them must not blank the band.
 */
export interface ValuationAnalyticsProps {
  summary: ValuationSnapshotSummary
  filters: ValuationFilters
  /** True while the register itself is refetching. */
  loading: boolean
}

export function ValuationAnalytics({ summary, filters, loading }: ValuationAnalyticsProps) {
  const [period, setPeriod] = useState<TrendPeriod>(DEFAULT_TREND_PERIOD)
  const [measure, setMeasure] = useState<WarehouseMeasure>('value')

  const analytics = useValuationAnalytics(filters, period, !loading)

  return (
    <section
      aria-label="Valuation analytics"
      className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr]"
    >
      <TrendCard
        className="lg:col-span-2 xl:col-span-1"
        period={period}
        onPeriod={setPeriod}
        state={analytics.trend}
      />
      <ItemSplitCard state={analytics.topItems} filters={filters} />
      <WarehouseSplitCard
        state={analytics.warehouses}
        summary={summary}
        measure={measure}
        onMeasure={setMeasure}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ shell */

function AnalyticsCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string
  icon: typeof TrendingUp
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card padding="sm" className={cx('flex min-w-0 flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <span className="truncate">{title}</span>
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  )
}

/** One line of explanation under a chart that had to leave something out. */
function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-500" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/**
 * What a card says when its own request failed.
 *
 * Deliberately quiet: the register beside it is fine, and a red panel over a
 * chart would read as "these figures are wrong" rather than "this picture did
 * not load".
 */
function CardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
      <p className="text-xs text-gray-500">This chart could not be loaded.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs font-semibold text-primary hover:underline"
      >
        Try again
      </button>
    </div>
  )
}

function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-full min-h-[160px] items-center justify-center px-4 text-center text-xs text-gray-500">
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------- trend */

function TrendCard({
  period,
  onPeriod,
  state,
  className,
}: {
  period: TrendPeriod
  onPeriod: (p: TrendPeriod) => void
  state: ReturnType<typeof useValuationAnalytics>['trend']
  className?: string
}) {
  const points = useMemo(
    () =>
      (state.data ?? []).map((p) => ({
        key: p.date,
        label: monthLabel(p.date),
        value: p.value,
        sub: `${formatQtyCompact(p.qty)} units`,
      })),
    [state.data],
  )

  return (
    <AnalyticsCard
      title="Stock value trend"
      icon={TrendingUp}
      className={className}
      action={
        <Select
          value={period}
          onChange={(e) => onPeriod(e.target.value as TrendPeriod)}
          aria-label="Trend period"
          className="w-auto"
        >
          {TREND_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      }
    >
      {state.error ? (
        <CardError onRetry={state.reload} />
      ) : state.loading && points.length === 0 ? (
        <Skeleton className="h-[232px] w-full" />
      ) : points.length === 0 ? (
        <CardEmpty>No valuation dates in this period fall inside the financial year.</CardEmpty>
      ) : (
        <>
          <TrendAreaChart
            points={points}
            formatValue={formatCurrencyCompact}
            caption="Closing stock value at each month end, on the filters and valuation method this register is read under."
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Each point is a closing valuation the server computed at that date, on the
            same method and filters.
          </p>
        </>
      )}
    </AnalyticsCard>
  )
}

/* -------------------------------------------------------------- item split */

function ItemSplitCard({
  state,
  filters,
}: {
  state: ReturnType<typeof useValuationAnalytics>['topItems']
  filters: ValuationFilters
}) {
  const view = useMemo(() => {
    const data = state.data
    if (!data) return null
    return composition(
      data.rows.map((r) => ({
        key: String(r.item_id),
        label: r.item_name ?? `Item #${r.item_id}`,
        value: r.stock_value,
        qty: r.closing_qty,
        to: `/valuation/cost-layers?item_id=${r.item_id}`,
      })),
      data.totalValue,
    )
  }, [state.data])

  const note = view ? negativesNote(view) : null

  return (
    <AnalyticsCard title="Valuation by item" icon={PieChart}>
      {state.error ? (
        <CardError onRetry={state.reload} />
      ) : state.loading && !view ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-[132px] w-[132px]" rounded="full" />
          <SkeletonRows rows={4} className="flex-1" />
        </div>
      ) : !view || view.invalid ? (
        <CardEmpty>
          {view && view.negatives > 0
            ? 'Every item at this date carries a negative stock value, which cannot be shown as a share.'
            : 'No stock value to split at this date.'}
        </CardEmpty>
      ) : (
        <>
          <DonutChart
            items={view.slices}
            // One more than the band can produce, so the chart never re-groups
            // a tail that has already been folded into "Others" against the
            // server's total.
            maxSlices={view.slices.length + 1}
            centerValue={formatCurrencyCompact(view.total)}
            centerLabel="Total value"
            ariaLabel="Stock value by item"
            // One hue, not six: every slice here is rupees of stock, so the
            // ramp orders them by size instead of implying six categories.
            palette={CHART_RAMP_PRIMARY}
          />
          {note ? <Caveat>{note}</Caveat> : null}
          {state.data && state.data.itemCount > view.slices.length ? (
            <p className="mt-2 text-[11px] text-gray-400">
              Top {state.data.rows.length} of {state.data.itemCount} items by value.{' '}
              <Link
                to={`/registers/valuation?as_of=${filters.asOf}&method=${filters.method}&sort=stock_value&order=desc`}
                className="font-semibold text-primary hover:underline"
              >
                See all
              </Link>
            </p>
          ) : null}
        </>
      )}
    </AnalyticsCard>
  )
}

/* --------------------------------------------------------- warehouse split */

function WarehouseSplitCard({
  state,
  summary,
  measure,
  onMeasure,
}: {
  state: ReturnType<typeof useValuationAnalytics>['warehouses']
  summary: ValuationSnapshotSummary
  measure: WarehouseMeasure
  onMeasure: (m: WarehouseMeasure) => void
}) {
  const view = useMemo(() => {
    if (!state.data) return null
    return warehouseComposition(
      state.data.warehouses,
      { value: summary.total_value, qty: summary.total_qty },
      measure,
    )
  }, [state.data, summary.total_value, summary.total_qty, measure])

  const skipped = state.data?.skipped ?? 0

  return (
    <AnalyticsCard
      title="Valuation by warehouse"
      icon={Warehouse}
      action={
        <SegmentedControl<WarehouseMeasure>
          value={measure}
          onChange={onMeasure}
          options={[
            { value: 'value', label: 'By value' },
            { value: 'qty', label: 'By quantity' },
          ]}
        />
      }
    >
      {state.error ? (
        <CardError onRetry={state.reload} />
      ) : state.loading && !view ? (
        <SkeletonRows rows={5} />
      ) : !view || view.invalid ? (
        <CardEmpty>
          {measure === 'value'
            ? 'No stock value to split across warehouses at this date.'
            : 'No stock quantity to split across warehouses at this date.'}
        </CardEmpty>
      ) : (
        <>
          <BarList items={view.slices} />
          <p className="mt-2 text-[11px] text-gray-400">
            Total {measure === 'value' ? formatMoney(summary.total_value) : formatQtyCompact(summary.total_qty)}
            {measure === 'value' ? '' : ' units'} across {view.slices.length}{' '}
            {view.slices.length === 1 ? 'line' : 'lines'}.
          </p>
          {skipped > 0 ? (
            <Caveat>
              {skipped} more {skipped === 1 ? 'warehouse is' : 'warehouses are'} not shown. Each one
              is a separate valuation run, so the split stops before it becomes the slowest thing on
              the page — filter to a warehouse to value it on its own.
            </Caveat>
          ) : null}
        </>
      )}
    </AnalyticsCard>
  )
}

export default ValuationAnalytics
