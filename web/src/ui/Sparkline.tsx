import { useId } from 'react'
import { cx } from './cx'

export interface SparklineProps {
  /** Oldest first. Fewer than two points draws nothing. */
  points: readonly number[]
  /**
   * The line's colour. `currentColor` by default, so a sparkline inherits the
   * tone of whatever it sits inside rather than carrying a palette of its own.
   */
  className?: string
  width?: number
  height?: number
  /** Fill the area under the line with a fading wash of the same colour. */
  filled?: boolean
  /** Mark the latest point. */
  dot?: boolean
  /**
   * What the series is, for assistive technology.
   *
   * Omit it and the graphic is hidden outright. That is the right default here:
   * a sparkline beside a KPI card is a restatement of a figure already on the
   * screen in words, and announcing "graphic" over it adds noise, not meaning.
   */
  label?: string
}

/**
 * Six numbers as a 60-pixel line.
 *
 * Hand-drawn SVG rather than a charting dependency, for the same reason
 * `dashboard/charts` is: the app ships no chart library, and adding one to draw
 * a polyline would be a hundred kilobytes for eleven lines of path arithmetic.
 *
 * A flat series is drawn flat, down the middle, rather than being normalised into
 * an invented wiggle — when every point is equal the honest picture is a
 * horizontal line.
 */
export function Sparkline({
  points,
  className,
  width = 64,
  height = 20,
  filled = true,
  dot = true,
  label,
}: SparklineProps) {
  const gradientId = useId()
  const usable = points.filter((n) => Number.isFinite(n))
  if (usable.length < 2) return null

  const min = Math.min(...usable)
  const max = Math.max(...usable)
  const span = max - min
  // Inset by a pixel top and bottom so a peak and a trough are not clipped by
  // the viewBox they sit exactly on.
  const pad = 1.5
  const usableHeight = height - pad * 2
  const step = usable.length > 1 ? width / (usable.length - 1) : width

  const coords = usable.map((value, i) => {
    const x = i * step
    const y = span === 0 ? height / 2 : pad + usableHeight - ((value - min) / span) * usableHeight
    return [x, y] as const
  })

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`
  const last = coords[coords.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx('overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {filled ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {dot && last ? <circle cx={last[0]} cy={last[1]} r={1.75} fill="currentColor" /> : null}
    </svg>
  )
}

export default Sparkline
