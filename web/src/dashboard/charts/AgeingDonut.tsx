import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../ui/cx'
import { percentOf } from '../formatters'
import type { SeriesItem, Tone } from '../model'
import { ChartTooltip, useChartTooltip } from './ChartTooltip'

/**
 * The ageing donut — deliberately NOT the shared DonutChart.
 *
 * Two differences, and both of them are the point:
 *
 *  1. **Slices stay in bucket order.** DonutChart sorts by size and colours by
 *     rank, which is right for "value by warehouse" — the biggest slice is the
 *     headline and the colours mean nothing. Here the colours mean everything:
 *     green is new stock and red is old, and a chart that repainted the oldest
 *     bucket green because it happened to be the largest would invert the one
 *     thing a reader takes from it at a glance.
 *  2. **Hover cross-highlights.** Pointing at an arc raises its legend row and
 *     pointing at a row raises its arc, because "which slice is 91–180 days"
 *     is otherwise a guess on a five-slice ring.
 *
 * The shares are already computed against the non-negative base by
 * `ageingView`, so a negative bucket never reaches this component — it cannot
 * be a slice of a whole, and it is listed as an exception beside the chart
 * instead.
 */
export interface AgeingDonutProps {
  items: readonly SeriesItem[]
  /** Already formatted for the chosen basis. */
  centerValue: string
  centerLabel: string
  /** Read out with the figures, e.g. "value at cost". */
  measureLabel: string
  className?: string
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const ARC_STROKE: Record<Tone, string> = {
  success: '#10b981',
  info: '#0ea5e9',
  warning: '#f59e0b',
  danger: '#f97316',
  critical: '#ef4444',
  primary: '#0aa35f',
  neutral: '#94a3b8',
  teal: '#14b8a6',
  violet: '#a78bfa',
}

export function AgeingDonut({ items, centerValue, centerLabel, measureLabel, className }: AgeingDonutProps) {
  const captionId = useId()
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const [active, setActive] = useState<string | null>(null)

  const positive = items.filter((i) => i.value > 0)
  const total = positive.reduce((acc, i) => acc + i.value, 0)

  let offset = 0
  const arcs = positive.map((item) => {
    const percent = percentOf(item.value, total)
    const arc = { item, percent, offset }
    offset += percent
    return arc
  })

  return (
    <div className={cx('flex flex-col items-center gap-4 sm:flex-row sm:items-center', className)}>
      <div className="relative h-[140px] w-[140px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-labelledby={captionId}>
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="13" />
          {arcs.map(({ item, percent, offset: start }) => {
            const dash = (percent / 100) * CIRCUMFERENCE
            const dim = active !== null && active !== item.key
            return (
              <circle
                key={item.key}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke={ARC_STROKE[item.tone] ?? ARC_STROKE.neutral}
                strokeWidth={active === item.key ? 16 : 13}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-((start / 100) * CIRCUMFERENCE)}
                strokeLinecap="butt"
                opacity={dim ? 0.35 : 1}
                className="transition-[stroke-width,opacity] duration-150 motion-reduce:transition-none"
                onMouseEnter={(e) => {
                  setActive(item.key)
                  showTooltip(e, `${item.label}: ${item.display} (${percent.toFixed(1)}%)`)
                }}
                onMouseMove={moveTooltip}
                onMouseLeave={() => {
                  setActive(null)
                  hideTooltip()
                }}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-sm font-bold tabular-nums text-gray-900">{centerValue}</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">{centerLabel}</span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {items.map((item) => {
          const share = item.value > 0 ? percentOf(item.value, total) : 0
          const row = (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ARC_STROKE[item.tone] ?? ARC_STROKE.neutral }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-gray-700" title={item.label}>
                {item.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-gray-900">{item.display}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-[11px] text-gray-400">
                {share.toFixed(0)}%
              </span>
            </>
          )
          const cls = cx(
            '-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors',
            active === item.key ? 'bg-primary-light/50' : 'hover:bg-primary-light/40',
          )
          return (
            <li
              key={item.key}
              onMouseEnter={() => setActive(item.key)}
              onMouseLeave={() => setActive(null)}
            >
              {item.to ? (
                <Link
                  to={item.to}
                  className={cx(cls, 'no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40')}
                  title={item.sub ? `${item.label} · ${item.sub}` : item.label}
                  onFocus={() => setActive(item.key)}
                  onBlur={() => setActive(null)}
                >
                  {row}
                </Link>
              ) : (
                <span className={cls}>{row}</span>
              )}
            </li>
          )
        })}
      </ul>

      {/* The chart's accessible equivalent. Clipped inside a div for the same
          reason as BridgeChart: a bare sr-only <table> keeps its intrinsic
          width and pushes the page's scroll width past the viewport. */}
      <div className="sr-only">
        <table>
          <caption id={captionId}>
            Ageing of remaining stock by {measureLabel}. Total {centerValue}.
          </caption>
          <thead>
            <tr>
              <th scope="col">Age bucket</th>
              <th scope="col">{centerLabel}</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{item.display}</td>
                <td>{item.value > 0 ? `${percentOf(item.value, total).toFixed(1)}%` : '0%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}

export default AgeingDonut
