import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { ChartTooltip, useChartTooltip } from '../../dashboard/charts/ChartTooltip'
import { formatCurrencyCompact, formatQtyCompact } from '../../dashboard/formatters'
import { BAR_FILL } from '../../dashboard/visuals'
import { Card } from '../../ui/Card'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatInt, formatMoney, formatQty } from '../../utils/format'
import {
  AGEING_METRIC_LABELS,
  ageingBreakdown,
  formatShare,
} from './ageingModel'
import type { AgeingBucketView, AgeingMetric } from './ageingModel'
import type { AgeBucketKey, StockAgeingSummary } from '../../services/reportsApi'

/**
 * Where the stock value is concentrated, by age.
 *
 * Drawn as five labelled columns rather than a plotted series: there are exactly five
 * buckets, they never change, and the question is "which of these five is big", which
 * a bar answers and an axis only decorates. `dashboard/charts/ColumnChart` is the
 * nearest thing the app already has and is the wrong shape here — it groups a series
 * across many categories with one fill per series, while this needs one fill per
 * bucket so that red always means 180+ days. Same idiom, same tone table, no new
 * dependency.
 *
 * Every column is a button: pressing it filters the register to that bucket, and
 * pressing the active one clears the filter. The `<table>` underneath is the
 * accessible equivalent and carries the same figures, so nothing here is available
 * only by hovering or only by colour.
 */
export interface AgeingDistributionChartProps {
  summary: StockAgeingSummary
  metric: AgeingMetric
  onMetric: (metric: AgeingMetric) => void
  /** The bucket the register is currently filtered to, if any. */
  active: AgeBucketKey | null
  onSelect: (bucket: AgeBucketKey) => void
  loading: boolean
  className?: string
}

const METRIC_OPTIONS: { value: AgeingMetric; label: string }[] = [
  { value: 'value', label: AGEING_METRIC_LABELS.value },
  { value: 'qty', label: AGEING_METRIC_LABELS.qty },
  { value: 'items', label: AGEING_METRIC_LABELS.items },
]

function metricDisplay(bucket: AgeingBucketView, metric: AgeingMetric): string {
  if (metric === 'qty') return formatQtyCompact(bucket.qty)
  if (metric === 'items') return formatInt(bucket.items)
  return formatCurrencyCompact(bucket.value)
}

export function AgeingDistributionChart({
  summary,
  metric,
  onMetric,
  active,
  onSelect,
  loading,
  className,
}: AgeingDistributionChartProps) {
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const buckets = useMemo(() => ageingBreakdown(summary, metric), [summary, metric])
  const anything = buckets.some((b) => Math.abs(b.metric) > 0)

  return (
    <Card padding="sm" className={cx('flex min-w-0 flex-col', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <BarChart3 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
            Stock value ageing distribution
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Where inventory {AGEING_METRIC_LABELS[metric].toLowerCase()} is concentrated. Select a
            band to filter the register.
          </p>
        </div>
        <SegmentedControl<AgeingMetric>
          value={metric}
          onChange={onMetric}
          options={METRIC_OPTIONS}
          className="shrink-0"
        />
      </div>

      {loading && !summary.items ? (
        <Skeleton className="h-[232px] w-full" />
      ) : !anything ? (
        <p className="flex h-[232px] items-center justify-center px-4 text-center text-xs text-gray-500">
          No stock on hand at this date, so there is no ageing to chart.
        </p>
      ) : (
        <>
          <div className="flex h-[210px] items-end gap-2" role="group" aria-label="Ageing bands">
            {buckets.map((b) => {
              const selected = active === b.key
              const dimmed = active !== null && !selected
              // A zero band draws no bar at all: a sliver that looks like stock where
              // there is none is worse than a gap, and the figure is printed above it
              // and listed in the table below either way.
              const height = Math.abs(b.metric) > 0 ? Math.max(4, b.scale) : 0
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelect(b.key)}
                  onMouseEnter={(e) => showTooltip(e, b.tooltip)}
                  onMouseMove={moveTooltip}
                  onMouseLeave={hideTooltip}
                  onBlur={hideTooltip}
                  aria-pressed={selected}
                  aria-label={`${b.label}: ${b.tooltip}`}
                  className={cx(
                    'group flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5 rounded-lg px-1 pb-1 pt-2 text-center transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    selected ? 'bg-primary/5' : 'hover:bg-gray-50',
                    dimmed && 'opacity-55',
                  )}
                >
                  <span className="truncate text-[11px] font-semibold tabular-nums text-gray-700">
                    {metricDisplay(b, metric)}
                  </span>
                  <span className="flex flex-1 items-end">
                    <span
                      className={cx(
                        'w-full rounded-t-md transition-[height] duration-500',
                        BAR_FILL[b.tone],
                        selected && 'ring-2 ring-inset ring-gray-900/15',
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </span>
                  <span className="truncate text-[11px] font-medium text-gray-500">{b.short}</span>
                  <span className="truncate text-[10px] tabular-nums text-gray-400">
                    {formatShare(b.share)}
                  </span>
                </button>
              )
            })}
          </div>
          <ChartTooltip tooltip={tooltip} />
        </>
      )}

      {/* The accessible equivalent of the bars — the same numbers, not a description
          of a picture. In a div rather than on the table itself: a table ignores the
          1px clamp the sr-only recipe relies on and would widen the document. */}
      <div className="sr-only">
        <table>
          <caption>
            Stock ageing distribution by {AGEING_METRIC_LABELS[metric].toLowerCase()} as at{' '}
            {summary.as_of}
          </caption>
          <thead>
            <tr>
              <th scope="col">Ageing band</th>
              <th scope="col">Quantity</th>
              <th scope="col">Value</th>
              <th scope="col">Items</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.label}</th>
                <td>{formatQty(b.qty)}</td>
                <td>{formatMoney(b.value)}</td>
                <td>{formatInt(b.items)}</td>
                <td>{formatShare(b.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default AgeingDistributionChart
