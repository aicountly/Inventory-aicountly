import { cx } from '../../ui/cx'
import type { MasterHealth } from './mastersOverview'

/**
 * The health ring: one arc per state, drawn on a single circle.
 *
 * Same technique as the dashboard's DonutChart — `strokeDasharray` sets an
 * arc's length and `strokeDashoffset` its start — but this ring answers a fixed
 * three-state question rather than an arbitrary value share, so it carries no
 * tooltip, no links and no slice cap. With nothing assessed it still renders:
 * a full track, an em dash and the "Configuration overview" label, never a
 * fabricated score.
 */

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const STROKE = 12

interface Segment {
  key: string
  value: number
  className: string
}

export function MasterHealthRing({ health }: { health: MasterHealth }) {
  const segments: Segment[] = [
    { key: 'good', value: health.good, className: 'text-primary' },
    { key: 'review', value: health.review, className: 'text-amber-500' },
    { key: 'missing', value: health.missing, className: 'text-red-500' },
  ]

  let offset = 0
  const arcs = health.assessed
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const fraction = s.value / health.assessed
          const arc = { ...s, dash: fraction * CIRCUMFERENCE, offset: offset * CIRCUMFERENCE }
          offset += fraction
          return arc
        })
    : []

  return (
    <div className="relative h-[116px] w-[116px] shrink-0">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={
          health.assessed
            ? `${health.good} of ${health.assessed} masters hold records`
            : 'Master health could not be assessed'
        }
      >
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          /* The token, not a grey utility: a `text-gray-100` stroke stays
             near-white in dark mode, where this track has to recede. */
          stroke="rgb(var(--color-surface-3))"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="butt"
            stroke="currentColor"
            className={cx(arc.className, 'transition-[stroke-dasharray] duration-500')}
            strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <strong className="text-xl font-bold leading-none tabular-nums text-gray-900">
          {health.percent === null ? '—' : `${health.percent}%`}
        </strong>
        <span className="mt-1 max-w-[5.5rem] text-[11px] font-medium leading-tight text-gray-500">
          {health.label}
        </span>
      </div>
    </div>
  )
}

export default MasterHealthRing
