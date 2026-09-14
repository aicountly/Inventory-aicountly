import { Link } from 'react-router-dom'
import { donutArcs } from '../model'
import type { SeriesItem } from '../model'
import { chartColor } from '../visuals'
import { ChartTooltip, useChartTooltip } from './ChartTooltip'

/**
 * Value-share donut, drawn as stroked arcs on one circle.
 *
 * `strokeDasharray` sets the arc length and `strokeDashoffset` its start, which
 * is why the geometry (donutArcs, in model.ts) is pure arithmetic and unit
 * tested: getting a slice one percent wrong is invisible in review and obvious
 * to a user comparing it with the register.
 *
 * Every slice and every legend row is a link into the register that produced it.
 */
export interface DonutChartProps {
  items: readonly SeriesItem[]
  /** Figure printed in the middle — the real company total, already formatted. */
  centerValue: string
  centerLabel?: string
  maxSlices?: number
  ariaLabel?: string
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function DonutChart({
  items,
  centerValue,
  centerLabel = 'Total',
  maxSlices = 6,
  ariaLabel = 'Value share',
}: DonutChartProps) {
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const arcs = donutArcs(items, maxSlices)
  const byKey = new Map(items.map((i) => [i.key, i]))

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[132px] h-[132px] shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" role="img" aria-label={ariaLabel}>
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="14" />
          {arcs.map((arc) => {
            const dash = (arc.percent / 100) * CIRCUMFERENCE
            return (
              <circle
                key={arc.key}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke={chartColor(arc.colorIndex)}
                strokeWidth="14"
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-((arc.offset / 100) * CIRCUMFERENCE)}
                strokeLinecap="butt"
                className="transition-[stroke-width] hover:[stroke-width:16]"
                onMouseEnter={(e) => showTooltip(e, `${arc.label}: ${arc.display} (${arc.percent.toFixed(1)}%)`)}
                onMouseMove={moveTooltip}
                onMouseLeave={hideTooltip}
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-label-xs uppercase tracking-wider text-gray-400">{centerLabel}</span>
          <span className="text-sm font-bold tabular-nums text-gray-900">{centerValue}</span>
        </div>
      </div>

      <ul className="flex-1 min-w-0 space-y-1 max-h-[160px] overflow-y-auto">
        {arcs.map((arc) => {
          const source = byKey.get(arc.key)
          const body = (
            <>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: chartColor(arc.colorIndex) }}
                aria-hidden
              />
              <span className="text-gray-700 truncate flex-1" title={arc.label}>
                {arc.label}
              </span>
              <span className="font-semibold text-gray-900 tabular-nums shrink-0">{arc.display}</span>
              <span className="text-label-xs text-gray-400 tabular-nums shrink-0 w-11 text-right">
                {arc.percent.toFixed(1)}%
              </span>
            </>
          )
          return (
            <li key={arc.key}>
              {arc.to ? (
                <Link
                  to={arc.to}
                  className="flex items-center gap-2 text-xs rounded-md px-1.5 py-1 -mx-1.5 hover:bg-primary-light/50 transition-colors"
                  title={source?.sub ? `${arc.label} · ${source.sub}` : arc.label}
                >
                  {body}
                </Link>
              ) : (
                <span className="flex items-center gap-2 text-xs px-1.5 py-1">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}

export default DonutChart
