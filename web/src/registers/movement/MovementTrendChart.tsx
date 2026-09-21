import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, FileText, Package, TrendingUp } from 'lucide-react'
import { ColumnChart } from '../../dashboard/charts/ColumnChart'
import { BAR_FILL } from '../../dashboard/visuals'
import { Card } from '../../ui/Card'
import { Select } from '../../ui/Select'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatDate, formatInt, formatMoney } from '../../utils/format'
import type { MovementRegisterSummary } from './movementSummary'
import {
  BUCKET_LABELS,
  BUCKET_NOUN,
  MEASURE_LABELS,
  availableBuckets,
  trendView,
} from './movementTrendModel'
import type { MovementTrendBucket, TrendMeasure } from './movementTrendModel'

/**
 * What moved, when — the one question the register cannot be read down to answer.
 *
 * Everything drawn here came back with the rows, in the same response and under the same
 * filters, so the chart can never describe a differently filtered set from the table
 * beneath it. It fetches nothing of its own for exactly that reason.
 *
 * The controls widen the buckets and switch the measure; neither asks the server for
 * anything, because both are exact re-readings of figures it already sent (see
 * movementTrendModel). A narrower bucket than the one served is not offered at all.
 */
export interface MovementTrendChartProps {
  summary: MovementRegisterSummary
  /** True while the register itself is refetching. */
  loading: boolean
}

export function MovementTrendChart({ summary, loading }: MovementTrendChartProps) {
  const trend = summary.trend
  const served = trend?.bucket ?? 'day'
  const [bucket, setBucket] = useState<MovementTrendBucket | ''>('')
  const [measure, setMeasure] = useState<TrendMeasure>('qty')

  const buckets = useMemo(() => availableBuckets(served), [served])
  // '' means "as the server bucketed it", so a filter change that switches the span from
  // days to weeks is followed rather than pinned to a width that no longer exists.
  const effective = bucket && buckets.includes(bucket) ? bucket : served
  const view = useMemo(() => trendView(trend, effective, measure), [trend, effective, measure])

  const unit = measure === 'qty' ? 'units' : 'in value'
  const period =
    trend?.from && trend?.to ? `${formatDate(trend.from)} – ${formatDate(trend.to)}` : 'the selected period'

  return (
    <section
      aria-label="Movement analytics"
      className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)]"
    >
      <Card padding="sm" className="flex min-w-0 flex-col">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <TrendingUp className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              Movement trend
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">
              {period} · one column per {BUCKET_NOUN[effective]}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Select
              value={measure}
              onChange={(e) => setMeasure(e.target.value as TrendMeasure)}
              aria-label="Chart measure"
              className="h-8 w-auto min-w-[6.5rem] text-xs"
            >
              {(['qty', 'value'] as const).map((m) => (
                <option key={m} value={m}>
                  {MEASURE_LABELS[m]}
                </option>
              ))}
            </Select>
            <Select
              value={effective}
              onChange={(e) => setBucket(e.target.value as MovementTrendBucket)}
              aria-label="Chart grouping"
              // One option when the server already bucketed at the coarsest width it
              // offers; a select that cannot change anything is disabled rather than
              // left looking like a choice.
              disabled={buckets.length < 2}
              className="h-8 w-auto min-w-[6.5rem] text-xs"
            >
              {buckets.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABELS[b]}
                </option>
              ))}
            </Select>
          </div>
        </header>

        {loading && !trend ? (
          <Skeleton height="h-[9.5rem]" />
        ) : view.empty ? (
          <p className="flex h-[9.5rem] items-center justify-center text-xs text-gray-500">
            {trend ? 'No movement to chart in this period.' : 'The trend could not be read just now.'}
          </p>
        ) : (
          <ColumnChart
            categories={view.categories}
            categoryTitles={view.titles}
            categoryLabel={effective === 'day' ? 'Date' : effective === 'week' ? 'Week' : 'Month'}
            unit={unit}
            height={152}
            barClassName={view.categories.length > 40 ? 'w-1 md:w-1.5' : 'w-2 md:w-3'}
            caption={`Inward against outward movement per ${BUCKET_NOUN[effective]} over ${period}, in ${
              measure === 'qty' ? 'base units' : 'value'
            }.`}
            truncatedNote={
              trend?.truncated
                ? 'The period is longer than this chart draws; the later buckets are not shown.'
                : undefined
            }
            series={[
              { key: 'in', label: 'Inward', fill: BAR_FILL.success, values: view.inward },
              { key: 'out', label: 'Outward', fill: BAR_FILL.critical, values: view.outward },
            ]}
            className={cx(loading && 'opacity-60 transition-opacity')}
          />
        )}

        {measure === 'qty' && !view.empty ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
            Quantities are each item&rsquo;s own stock unit, so a column counts units across
            items rather than one physical measure.
          </p>
        ) : null}
      </Card>

      <MovementBreakdown summary={summary} loading={loading} />
    </section>
  )
}

/**
 * The figures that did not earn a KPI card but must not be lost.
 *
 * Net value in particular: the register has always reported it, and dropping it to make
 * room for a quantity card would be a redesign that quietly removed an accounting figure.
 * It reads here beside the inward and outward halves it is the difference of.
 */
function MovementBreakdown({
  summary,
  loading,
}: {
  summary: MovementRegisterSummary
  loading: boolean
}) {
  const scope = summary.whole ? 'Across every matching movement' : 'Across this page only'

  return (
    <Card padding="sm" className="flex min-w-0 flex-col">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Activity className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        Value and coverage
      </h2>
      {loading && summary.pageRows === 0 ? (
        <div className="space-y-2">
          <Skeleton height="h-7" />
          <Skeleton height="h-7" />
          <Skeleton height="h-7" />
          <Skeleton height="h-7" />
        </div>
      ) : (
        <dl className="m-0 min-w-0">
          <Line
            icon={ArrowDownLeft}
            tone="text-emerald-600"
            label="Inward value"
            value={formatMoney(summary.in_value)}
          />
          <Line
            icon={ArrowUpRight}
            tone="text-rose-600"
            label="Outward value"
            value={formatMoney(summary.out_value)}
          />
          <Line
            icon={Activity}
            tone={summary.net_value < 0 ? 'text-rose-600' : 'text-violet-600'}
            label="Net value"
            value={formatMoney(summary.net_value)}
            strong
            valueClassName={summary.net_value < 0 ? 'text-rose-600' : undefined}
          />
          <Line
            icon={Package}
            tone="text-sky-600"
            label="Items moved"
            value={formatInt(summary.items)}
          />
          <Line
            icon={FileText}
            tone="text-gray-500"
            label="Documents"
            value={formatInt(summary.documents)}
          />
        </dl>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{scope}.</p>
    </Card>
  )
}

function Line({
  icon: Icon,
  tone,
  label,
  value,
  strong = false,
  valueClassName,
}: {
  icon: typeof Activity
  tone: string
  label: string
  value: ReactNode
  strong?: boolean
  valueClassName?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-gray-100 py-1.5 first:border-t-0 first:pt-0">
      <dt className="flex min-w-0 items-center gap-1.5 text-xs text-gray-600">
        <Icon className={cx('h-3.5 w-3.5 shrink-0', tone)} aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cx(
          'm-0 shrink-0 tabular-nums',
          strong ? 'text-sm font-semibold text-gray-900' : 'text-xs font-medium text-gray-800',
          valueClassName,
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Placeholder with the band's own geometry, for the first load. */
export function MovementTrendChartSkeleton() {
  return (
    <section
      aria-hidden
      className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)]"
    >
      <Card padding="sm">
        <Skeleton height="h-4" className="w-40" />
        <div className="mt-3">
          <Skeleton height="h-[9.5rem]" />
        </div>
      </Card>
      <Card padding="sm" className="space-y-2">
        <Skeleton height="h-4" className="w-32" />
        <Skeleton height="h-7" />
        <Skeleton height="h-7" />
        <Skeleton height="h-7" />
      </Card>
    </section>
  )
}

export default MovementTrendChart
