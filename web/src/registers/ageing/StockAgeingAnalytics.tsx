import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Info, PieChart } from 'lucide-react'
import { Card } from '../../ui/Card'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatCount } from '../../dashboard/formatters'
import { formatInt, formatMoney } from '../../utils/format'
import type { StockAgeingSummary } from '../../services/reportsApi'
import { AgeingBandBars, AgeingBandDonut, MEASURE_NOUN } from './AgeingBandCharts'
import { StockHealthScore } from './StockHealthScore'
import {
  bucketSlices,
  itemGroupName,
  stockHealth,
  warehouseName,
  worstForAgeing,
} from './stockAgeingModel'
import type { AgeingMeasure, BucketSlice } from './stockAgeingModel'

/**
 * The band under the KPI cards: where the value is sitting, and what that says about it.
 *
 * Everything drawn here comes from the summary the register already fetched under the
 * reader's own filters — not one extra request, and therefore never a second, differently
 * filtered answer beside the first. There is no trend line and no "vs last month" because
 * the ageing endpoint answers for ONE date; a comparison would have to be invented, and an
 * invented delta on a stock-health screen is the kind of figure that ends up in a board
 * pack.
 *
 * Screen only (`print:hidden`): the printed sheet carries the KPI cards, the totals row
 * and the rows themselves, which are the record. A picture of them is not.
 */
export interface StockAgeingAnalyticsProps {
  summary: StockAgeingSummary
  /** True while the register itself is refetching. */
  loading: boolean
}

/* -------------------------------------------------------------- card shell */

function AnalyticsCard({
  title,
  hint,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  icon: typeof BarChart3
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card padding="sm" className={cx('flex min-w-0 flex-col', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            <span className="truncate">{title}</span>
          </h2>
          {hint ? <p className="mt-0.5 truncate text-[11px] text-gray-500">{hint}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  )
}

/** One figure the bands cannot show as a shape — a share, a sum or an age. */
function HealthMetric({
  label,
  value,
  hint,
  explain,
  tone,
}: {
  label: string
  value: string
  hint?: ReactNode
  explain: string
  tone?: 'warning' | 'danger' | 'rose'
}) {
  const accent =
    tone === 'rose' ? 'text-rose-600' : tone === 'danger' ? 'text-orange-600' : tone === 'warning' ? 'text-amber-600' : 'text-gray-900'
  return (
    <Card padding="sm" className="flex min-w-0 flex-col justify-center">
      <span className="flex items-center gap-1 text-label-xs font-semibold uppercase tracking-wide text-gray-500">
        <span className="truncate">{label}</span>
        <Tooltip label={explain}>
          <span
            tabIndex={0}
            role="note"
            aria-label={`${label}: ${explain}`}
            className="inline-flex shrink-0 rounded text-gray-300 hover:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Info className="h-3 w-3" aria-hidden />
          </span>
        </Tooltip>
      </span>
      <strong className={cx('mt-1.5 truncate text-xl font-semibold tabular-nums', accent)}>
        {value}
      </strong>
      {hint ? <span className="mt-1 truncate text-[11px] text-gray-500">{hint}</span> : null}
    </Card>
  )
}

/* -------------------------------------------------------------------- band */

export function StockAgeingAnalytics({ summary, loading }: StockAgeingAnalyticsProps) {
  const [measure, setMeasure] = useState<AgeingMeasure>('value')
  const [params] = useSearchParams()

  const slices = useMemo(() => bucketSlices(summary), [summary])
  const health = useMemo(() => stockHealth(summary), [summary])
  const activeBucket = summary.age_bucket ?? null
  const totalItems = useMemo(() => slices.reduce((n, s) => n + s.items, 0), [slices])

  /**
   * Clicking a band filters the register to it — and clicking the band already applied
   * clears it, which is the only way back out of a filter the reader set from a chart.
   * Built from the live URL so every other filter, the sort and the page size survive the
   * click; `page` is dropped, because page 7 of the old answer is not page 7 of this one.
   */
  const hrefFor = useMemo(
    () =>
      (slice: BucketSlice): string | null => {
        const next = new URLSearchParams(params)
        if (activeBucket === slice.key) next.delete('age_bucket')
        else next.set('age_bucket', slice.key)
        next.delete('page')
        const qs = next.toString()
        return qs ? `?${qs}` : '?'
      },
    [params, activeBucket],
  )

  // The share each one carries is taken against the summary's own over-90 / over-180
  // totals: the server bounds these lists, so summing the rows would divide by a
  // truncated whole and overstate the leader.
  const worstWarehouse = useMemo(
    () => worstForAgeing(summary.by_warehouse, warehouseName, 'value_over_90', health.valueOver90),
    [summary.by_warehouse, health.valueOver90],
  )
  const worstGroup = useMemo(
    () => worstForAgeing(summary.by_item_group, itemGroupName, 'value_over_180', health.valueOver180),
    [summary.by_item_group, health.valueOver180],
  )

  const empty = summary.total_qty === 0 && summary.total_value === 0 && totalItems === 0

  if (loading && empty) {
    return (
      <section aria-label="Stock ageing analytics" className="grid gap-3 print:hidden xl:grid-cols-[1.55fr_1fr]">
        <Skeleton className="h-[290px] w-full" />
        <Skeleton className="h-[290px] w-full" />
      </section>
    )
  }

  return (
    <section
      aria-label="Stock ageing analytics"
      className={cx('grid gap-3 print:hidden', loading && 'opacity-60 transition-opacity')}
    >
      <div className="grid min-w-0 gap-3 xl:grid-cols-[1.55fr_minmax(20rem,1fr)]">
        <AnalyticsCard
          title="Stock value ageing distribution"
          hint="Where the stock on hand is concentrated, by how long it has been sitting"
          icon={BarChart3}
          action={
            <SegmentedControl<AgeingMeasure>
              value={measure}
              onChange={setMeasure}
              options={[
                { value: 'value', label: 'Value', title: 'Stock value at cost' },
                { value: 'qty', label: 'Quantity', title: 'Units on hand' },
                { value: 'items', label: 'Items', title: 'Lines, counted once each' },
              ]}
            />
          }
        >
          {empty ? (
            <EmptyChart>Nothing is in stock under these filters, so there is no ageing to plot.</EmptyChart>
          ) : (
            <>
              <AgeingBandBars
                slices={slices}
                measure={measure}
                hrefFor={hrefFor}
                activeKey={activeBucket}
              />
              <p className="mt-2 text-[11px] text-gray-400">
                {activeBucket
                  ? 'Filtered to one band — select it again to clear.'
                  : 'Select a band to filter the register to the lines holding stock in it.'}
                {measure === 'items'
                  ? ' Each line is counted once, in the band its weighted average age falls in.'
                  : ''}
              </p>
            </>
          )}
        </AnalyticsCard>

        <AnalyticsCard
          title="Items by ageing band"
          hint="Each line counted once, by its weighted average age"
          icon={PieChart}
        >
          {empty || totalItems === 0 ? (
            <EmptyChart>
              No line has an average age to place in a band under these filters.
            </EmptyChart>
          ) : (
            <AgeingBandDonut
              slices={slices}
              measure="items"
              centerValue={formatCount(totalItems)}
              centerLabel={totalItems === 1 ? 'Item' : 'Items'}
              hrefFor={hrefFor}
              activeKey={activeBucket}
            />
          )}
        </AnalyticsCard>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(19rem,1.5fr)_repeat(3,minmax(0,1fr))]">
        <Card padding="sm" className="min-w-0">
          <StockHealthScore health={health} />
        </Card>

        <HealthMetric
          label="Capital > 90 days"
          value={formatMoney(health.valueOver90)}
          hint={`${health.percentOver90.toFixed(1)}% of stock value${
            worstWarehouse ? ` · most of it in ${worstWarehouse.label}` : ''
          }`}
          explain="Value of the stock on hand whose cost layers are more than 90 days old — the 91–180 and 180+ bands added together."
          tone={health.percentOver90 >= 25 ? 'danger' : 'warning'}
        />

        <HealthMetric
          label="Capital > 180 days"
          value={formatMoney(health.valueOver180)}
          hint={`${health.percentOver180.toFixed(1)}% of stock value${
            worstGroup ? ` · led by ${worstGroup.label}` : ''
          }`}
          explain="Value sitting in the 180+ band. This is the stock most likely to need a write-down, a discount or a disposal decision."
          tone="rose"
        />

        <HealthMetric
          label="Weighted avg. age"
          value={
            summary.weighted_age_days === null
              ? '—'
              : `${formatInt(summary.weighted_age_days)} days`
          }
          hint={
            summary.oldest_days === null
              ? 'Across current stock'
              : `Oldest layer on hand: ${formatInt(summary.oldest_days)} days`
          }
          explain="Mean age of every unit on hand, weighted by quantity — not the average of the per-item averages. Computed by the server over the whole filtered set, not just this page."
        />
      </div>

      {/* The one line a reader takes away, when the figures support one. */}
      {worstWarehouse && worstWarehouse.percentOfAtRisk >= 25 ? (
        <p className="text-[11px] text-gray-500">
          <strong className="font-semibold text-gray-700">{worstWarehouse.label}</strong> holds{' '}
          {worstWarehouse.percentOfAtRisk.toFixed(0)}% of the stock value older than 90 days (
          {formatMoney(worstWarehouse.value_over_90)} of {formatMoney(health.valueOver90)}).
          {' '}All figures are as at {summary.as_of}, on the {MEASURE_NOUN.value.toLowerCase()} the
          costing method assigns.
        </p>
      ) : null}
    </section>
  )
}

function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-xs text-gray-500">
      {children}
    </p>
  )
}

export default StockAgeingAnalytics
