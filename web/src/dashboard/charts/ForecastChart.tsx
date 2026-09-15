import { useId, useMemo } from 'react'
import { cx } from '../../ui/cx'

/**
 * Observed demand, and a projection of it.
 *
 * The one thing this chart exists to get right: **actual stops at the as-at
 * point and projection starts after it.** The concept mockup this replaces drew
 * measured-looking points to the right of "Today"; nothing here can, because
 * the two series are separate arrays and the projection is drawn from the last
 * actual point onwards, with a different line pattern AND a different label AND
 * a different colour — three signals, so the distinction survives greyscale
 * printing and colour-blind readers alike.
 *
 * There is no shaded confidence band. A band is a claim about the spread of an
 * error distribution, and a trailing mean over daily issues does not give us
 * one; drawing a plausible-looking envelope would be inventing precision. The
 * caller states the method and the history behind it in words instead.
 */
export interface SeriesPoint {
  date: string
  value: number
}

export interface ForecastChartProps {
  actual: readonly SeriesPoint[]
  /** Begins the day AFTER the last actual point. Empty when we will not guess. */
  forecast: readonly SeriesPoint[]
  /** The boundary date — drawn as a labelled rule. */
  asOf: string
  caption: string
  unit: string
  formatValue: (n: number) => string
  formatDate: (iso: string) => string
  height?: number
  className?: string
}

const PAD = { top: 8, right: 8, bottom: 22, left: 44 }

export function ForecastChart({
  actual,
  forecast,
  asOf,
  caption,
  unit,
  formatValue,
  formatDate,
  height = 220,
  className,
}: ForecastChartProps) {
  const captionId = useId()
  const gradientId = useId()

  const geometry = useMemo(() => {
    const all = [...actual, ...forecast]
    if (all.length === 0) return null

    // A 1000-unit viewBox with preserveAspectRatio="none" makes the SVG fluid
    // without a resize observer; strokes use vector-effect so they do not
    // stretch with it.
    const W = 1000
    const H = 300
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom

    const maxValue = Math.max(...all.map((p) => p.value), 0)
    // Never divide by zero, and never draw a flat line at the very top: a
    // series of all zeros should sit on the baseline.
    const scaleMax = maxValue > 0 ? maxValue * 1.1 : 1

    const x = (i: number) => PAD.left + (all.length <= 1 ? innerW / 2 : (i / (all.length - 1)) * innerW)
    const y = (v: number) => PAD.top + innerH - (v / scaleMax) * innerH

    const actualPoints = actual.map((p, i) => ({ ...p, x: x(i), y: y(p.value) }))
    const forecastPoints = forecast.map((p, i) => ({ ...p, x: x(actual.length + i), y: y(p.value) }))

    const line = (pts: { x: number; y: number }[]) =>
      pts.length === 0 ? '' : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

    const lastActual = actualPoints[actualPoints.length - 1]
    // The projection line starts AT the last measured point, so the join is
    // continuous and the dash pattern is the only thing that changes.
    const forecastPath = lastActual && forecastPoints.length > 0
      ? line([lastActual, ...forecastPoints])
      : line(forecastPoints)

    const area = actualPoints.length > 1
      ? `${line(actualPoints)} L${actualPoints[actualPoints.length - 1].x.toFixed(2)},${(PAD.top + innerH).toFixed(2)} L${actualPoints[0].x.toFixed(2)},${(PAD.top + innerH).toFixed(2)} Z`
      : ''

    return {
      W,
      H,
      innerH,
      actualPoints,
      forecastPoints,
      actualPath: line(actualPoints),
      forecastPath,
      area,
      boundaryX: lastActual?.x ?? PAD.left,
      scaleMax,
      yTicks: [0, scaleMax / 2, scaleMax].map((v) => ({ v, y: y(v) })),
    }
  }, [actual, forecast])

  if (!geometry) {
    return <p className={cx('text-xs text-gray-500', className)}>No demand history to plot for this item.</p>
  }

  return (
    <figure className={cx('m-0', className)}>
      <svg
        role="img"
        aria-labelledby={captionId}
        viewBox={`0 0 ${geometry.W} ${geometry.H}`}
        preserveAspectRatio="none"
        style={{ height, width: '100%' }}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geometry.yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={geometry.W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="currentColor"
              className="text-gray-200"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text x={PAD.left - 6} y={t.y + 3} textAnchor="end" className="fill-gray-400 text-[10px]">
              {formatValue(t.v)}
            </text>
          </g>
        ))}

        {geometry.area ? <path d={geometry.area} fill={`url(#${gradientId})`} /> : null}

        <path
          d={geometry.actualPath}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* The as-at rule. Everything right of it is projection. */}
        <line
          x1={geometry.boundaryX}
          x2={geometry.boundaryX}
          y1={PAD.top}
          y2={PAD.top + geometry.innerH}
          stroke="currentColor"
          className="text-gray-400"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />

        {geometry.forecastPath ? (
          <path
            d={geometry.forecastPath}
            fill="none"
            stroke="rgb(14 165 233)"
            strokeWidth={2}
            // Dashed as well as differently coloured: the distinction has to
            // survive a monochrome print and a colour-blind reader.
            strokeDasharray="6 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-emerald-500" aria-hidden />
          Actual, to {formatDate(asOf)}
        </span>
        {forecast.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-5 rounded"
              style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgb(14 165 233) 0 5px, transparent 5px 9px)' }}
              aria-hidden
            />
            Projected
          </span>
        ) : null}
      </div>

      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>
      {/* The accessible equivalent of the chart above.
          Wrapped in a div rather than carrying `sr-only` on the <table> itself:
          a table auto-sizes to its content and ignores the 1px width the
          sr-only recipe relies on, so the table stayed 1,800px wide and pushed
          the document's scroll width past the viewport — a horizontal scrollbar
          on every page, caused by something nobody can see. A div honours the
          clamp and the table inside it is clipped with everything else. */}
      <div className="sr-only">
        <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{unit}</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {actual.map((p) => (
            <tr key={`a-${p.date}`}>
              <th scope="row">{formatDate(p.date)}</th>
              <td>{formatValue(p.value)}</td>
              <td>Actual</td>
            </tr>
          ))}
          {forecast.map((p) => (
            <tr key={`f-${p.date}`}>
              <th scope="row">{formatDate(p.date)}</th>
              <td>{formatValue(p.value)}</td>
              <td>Projected</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  )
}

export default ForecastChart
