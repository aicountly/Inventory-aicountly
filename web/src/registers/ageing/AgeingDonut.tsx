import { useMemo } from 'react'
import { PieChart } from 'lucide-react'
import { ChartTooltip, useChartTooltip } from '../../dashboard/charts/ChartTooltip'
import { Card } from '../../ui/Card'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatInt } from '../../utils/format'
import { ageingBreakdown, formatShare } from './ageingModel'
import type { AgeBucketKey, StockAgeingSummary } from '../../services/reportsApi'

/**
 * How many distinct items sit in each ageing band.
 *
 * `dashboard/charts/DonutChart` is deliberately not reused: it sorts its slices by
 * size and folds the tail into "Other", which is right for a value share across
 * forty items and wrong for five fixed bands — the colour against "180+ days" would
 * change with the data, and "Other (2)" would hide a band. Here the order and the
 * colour of every slice are fixed, and there is never a sixth.
 *
 * An item with stock in three bands is counted in all three, so the slices are a
 * distribution of item-band pairs and the centre carries the register's own item
 * count. The legend says so rather than leaving the arithmetic to be discovered.
 */
export interface AgeingDonutProps {
  summary: StockAgeingSummary
  active: AgeBucketKey | null
  onSelect: (bucket: AgeBucketKey) => void
  loading: boolean
  className?: string
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function AgeingDonut({ summary, active, onSelect, loading, className }: AgeingDonutProps) {
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const buckets = useMemo(() => ageingBreakdown(summary, 'items'), [summary])

  const arcs = useMemo(() => {
    let offset = 0
    return buckets.map((b) => {
      const arc = { ...b, offset }
      offset += b.share
      return arc
    })
  }, [buckets])

  const anything = buckets.some((b) => b.items > 0)
  const counted = buckets.reduce((acc, b) => acc + b.items, 0)

  return (
    <Card padding="sm" className={cx('flex min-w-0 flex-col', className)}>
      <div className="mb-3 min-w-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <PieChart className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          Items by ageing bucket
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {counted > summary.items
            ? 'Items are counted in every band they hold stock in.'
            : 'Distribution of the items currently in stock.'}
        </p>
      </div>

      {loading && !summary.items ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-[136px] w-[136px]" rounded="full" />
          <div className="flex-1 space-y-2">
            {buckets.map((b) => (
              <Skeleton key={b.key} className="h-6 w-full" />
            ))}
          </div>
        </div>
      ) : !anything ? (
        <p className="flex h-[210px] items-center justify-center px-4 text-center text-xs text-gray-500">
          No items in stock at this date.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-[136px] w-[136px] shrink-0">
            <svg
              viewBox="0 0 100 100"
              className="h-full w-full -rotate-90"
              role="img"
              aria-label="Items by ageing bucket"
            >
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke="rgb(var(--color-surface-3))"
                strokeWidth="14"
              />
              {arcs.map((arc) => {
                if (arc.share <= 0) return null
                const dash = (arc.share / 100) * CIRCUMFERENCE
                const dimmed = active !== null && active !== arc.key
                return (
                  <circle
                    key={arc.key}
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    fill="none"
                    stroke={arc.hex}
                    strokeWidth={active === arc.key ? 17 : 14}
                    strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                    strokeDashoffset={-((arc.offset / 100) * CIRCUMFERENCE)}
                    strokeLinecap="butt"
                    opacity={dimmed ? 0.4 : 1}
                    className="cursor-pointer transition-[stroke-width,opacity] hover:[stroke-width:17]"
                    onMouseEnter={(e) => showTooltip(e, arc.tooltip)}
                    onMouseMove={moveTooltip}
                    onMouseLeave={hideTooltip}
                    onClick={() => onSelect(arc.key)}
                  />
                )
              })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-semibold tabular-nums text-gray-900">
                {formatInt(summary.items)}
              </span>
              <span className="text-label-xs uppercase tracking-wider text-gray-400">
                {summary.items === 1 ? 'Item' : 'Items'}
              </span>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-0.5">
            {buckets.map((b) => {
              const selected = active === b.key
              return (
                <li key={b.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(b.key)}
                    aria-pressed={selected}
                    className={cx(
                      'grid w-full grid-cols-[0.625rem_minmax(0,1fr)_auto_2.75rem] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      selected ? 'bg-primary/5' : 'hover:bg-gray-50',
                      active !== null && !selected && 'opacity-60',
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: b.hex }}
                      aria-hidden
                    />
                    <span className="truncate text-xs text-gray-700" title={b.label}>
                      {b.label}
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-gray-900">
                      {formatInt(b.items)}
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-gray-400">
                      {formatShare(b.share)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <ChartTooltip tooltip={tooltip} />
        </div>
      )}
    </Card>
  )
}

export default AgeingDonut
