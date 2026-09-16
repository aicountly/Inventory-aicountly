import { useId, useMemo } from 'react'
import { ChartTooltip, useChartTooltip } from './ChartTooltip'
import { cx } from '../../ui/cx'

/**
 * A measured series over time, as a line on a soft fill.
 *
 * Every point is a value the server was asked for at that date — there is no
 * smoothing, no interpolation and no trailing average. The line is drawn
 * straight between measurements rather than as a spline for exactly that
 * reason: a curve through two month-end figures implies the shape of the weeks
 * nobody measured, and on a stock-valuation chart that shape reads as history.
 *
 * Gaps are gaps. A date whose request failed is absent from `points`, and the
 * line joins the measurements either side of it rather than inventing one to
 * keep the spacing even.
 *
 * **Why the labels and dots are HTML, not SVG.** The plot is a `0 0 100 100`
 * viewBox stretched with `preserveAspectRatio="none"`, which is what makes it
 * fluid without a resize observer — but that scale is non-uniform, so anything
 * in it that is not a stroke comes out distorted: text squashed horizontally,
 * a circle drawn as an ellipse. Strokes escape through `vector-effect`; glyphs
 * and dots cannot, so they sit in an absolutely-positioned layer above the SVG
 * where a percentage means the same thing in both axes.
 *
 * The colour is `--color-primary`, so the chart follows the accent chosen in
 * Appearance instead of staying green on a re-themed app.
 */
export interface TrendPointInput {
  /** Stable identity — the ISO date the figure was measured at. */
  key: string
  /** X-axis label, already short ("Sep 26"). */
  label: string
  value: number
  /** Extra clause in the tooltip — a quantity beside a value. */
  sub?: string
}

export interface TrendAreaChartProps {
  points: readonly TrendPointInput[]
  /** Formats the y-axis ticks and the tooltip figure. */
  formatValue: (n: number) => string
  /** Describes the series for a screen reader. */
  caption: string
  height?: number
  className?: string
}

/** Gutters around the plot box, in pixels — room for the axis labels. */
const AXIS_Y = 56
const AXIS_X = 22

export function TrendAreaChart({
  points,
  formatValue,
  caption,
  height = 232,
  className,
}: TrendAreaChartProps) {
  const captionId = useId()
  const gradientId = useId()
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()

  const geometry = useMemo(() => {
    if (points.length === 0) return null

    const values = points.map((p) => p.value)
    const maxValue = Math.max(...values, 0)
    const minValue = Math.min(...values, 0)
    // Headroom above the peak so the line never touches the frame, and a floor
    // that honours negative stock value instead of clipping it out of sight.
    const top = maxValue > 0 ? maxValue * 1.12 : 1
    const bottom = minValue < 0 ? minValue * 1.12 : 0
    const span = top - bottom || 1

    // Percentages of the plot box: 0,0 is its top-left corner.
    const px = (i: number) => (points.length <= 1 ? 50 : (i / (points.length - 1)) * 100)
    const py = (v: number) => 100 - ((v - bottom) / span) * 100

    const plotted = points.map((p, i) => ({ ...p, px: px(i), py: py(p.value) }))
    const line = plotted
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px.toFixed(3)},${p.py.toFixed(3)}`)
      .join(' ')

    // The fill drops to the zero line, not to the bottom of the box: with a
    // negative point in the series those are different places, and shading down
    // to the frame would colour in value that is not there.
    const baseline = py(Math.max(bottom, 0))
    const area =
      plotted.length > 1
        ? `${line} L${plotted[plotted.length - 1].px.toFixed(3)},${baseline.toFixed(3)} L${plotted[0].px.toFixed(3)},${baseline.toFixed(3)} Z`
        : ''

    const ticks = [top, bottom + span / 2, bottom].map((v) => ({ v, py: py(v) }))

    // Hover bands, clamped to the plot box. The first and last points sit ON
    // its edges, so a band centred on them would hang half its width outside
    // the card — and an element wider than the viewport makes the whole page
    // scroll sideways, which is the one thing a register must never do.
    const band = points.length <= 1 ? 100 : 100 / (points.length - 1)
    const bands = plotted.map((p) => {
      const from = Math.max(0, p.px - band / 2)
      const to = Math.min(100, p.px + band / 2)
      return { key: p.key, from, width: to - from, point: p }
    })

    return { plotted, line, area, ticks, bands }
  }, [points])

  if (!geometry) {
    return (
      <p className={cx('py-10 text-center text-xs text-gray-500', className)}>
        No measured points in this period.
      </p>
    )
  }

  return (
    <figure className={cx('m-0', className)}>
      <div
        className="relative w-full"
        style={{ height }}
        onMouseLeave={hideTooltip}
      >
        {/* The plot box. Everything inside is positioned in percentages of it. */}
        <div
          className="absolute"
          style={{ top: 0, right: 0, bottom: AXIS_X, left: AXIS_Y }}
        >
          {geometry.ticks.map((t) => (
            <div
              key={t.v}
              className="absolute inset-x-0 border-t border-gray-200"
              style={{ top: `${t.py}%` }}
              aria-hidden
            >
              <span className="absolute right-full top-0 -translate-y-1/2 whitespace-nowrap pr-2 text-[10px] tabular-nums text-gray-400">
                {formatValue(t.v)}
              </span>
            </div>
          ))}

          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.20" />
                <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geometry.area ? <path d={geometry.area} fill={`url(#${gradientId})`} /> : null}
            <path
              d={geometry.line}
              fill="none"
              stroke="rgb(var(--color-primary))"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {geometry.plotted.map((p) => (
            <span
              key={`dot-${p.key}`}
              className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white"
              style={{ left: `${p.px}%`, top: `${p.py}%` }}
              aria-hidden
            />
          ))}

          {/* Hover targets: a 7px dot is far too small, so each measurement owns
              the vertical band of the plot nearest to it. */}
          {geometry.bands.map((b) => (
            <button
              key={`hit-${b.key}`}
              type="button"
              tabIndex={-1}
              aria-hidden
              className="absolute top-0 h-full cursor-default bg-transparent"
              style={{ left: `${b.from}%`, width: `${b.width}%` }}
              onMouseEnter={(e) =>
                showTooltip(
                  e,
                  `${b.point.label}: ${formatValue(b.point.value)}${b.point.sub ? ` · ${b.point.sub}` : ''}`,
                )
              }
              onMouseMove={moveTooltip}
            />
          ))}
        </div>

        {/* X axis, in the gutter the plot box leaves below itself. */}
        <div
          className="absolute"
          style={{ right: 0, bottom: 0, left: AXIS_Y, height: AXIS_X }}
        >
          {/* The end labels are anchored, not centred: a label centred on a
              point that sits ON the plot's edge hangs half its width outside
              the card, and at phone widths that is enough to make the whole
              page scroll sideways. */}
          {geometry.plotted.map((p, i) => {
            const first = i === 0
            const last = i === geometry.plotted.length - 1
            return (
              <span
                key={`x-${p.key}`}
                className={cx(
                  'absolute top-1.5 whitespace-nowrap text-[10px] text-gray-400',
                  !first && !last && '-translate-x-1/2',
                )}
                style={first ? { left: 0 } : last ? { right: 0 } : { left: `${p.px}%` }}
                aria-hidden
              >
                {p.label}
              </span>
            )
          })}
        </div>
      </div>

      <ChartTooltip tooltip={tooltip} />

      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>

      {/* The chart's accessible equivalent. In a div rather than `sr-only` on
          the table itself — a table ignores the 1px width the sr-only recipe
          relies on and would widen the document (see ForecastChart). */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.label}</th>
                <td>{formatValue(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

export default TrendAreaChart
