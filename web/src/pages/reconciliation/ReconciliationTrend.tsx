import { useId, useMemo, useState } from 'react'
import { cx } from '../../ui/cx'
import { formatCurrencyCompact } from '../../dashboard/formatters'
import { ChartTooltip, useChartTooltip } from '../../dashboard/charts/ChartTooltip'
import { formatDate, formatMoney } from '../../utils/format'
import { MATERIAL_TOLERANCE } from './reconciliationModel'
import type { TrendPoint } from './reconciliationModel'

/**
 * Inventory closing value against the Books Stock-in-Hand balance, run by run.
 *
 * The axis starts at zero and both series share it. That is the whole point:
 * these two numbers are meant to be the same number, and an axis cropped to the
 * band they occupy would turn a 0.4% gap into a canyon and a reconciled company
 * into a crisis. A gap you can SEE here is a gap worth acting on; the exact
 * rupees are in the tooltip, the table above and the difference column.
 *
 * Hand-rolled SVG, like every other chart in this app — there is no charting
 * dependency and two polylines do not justify adding one.
 */
export interface ReconciliationTrendProps {
  points: readonly TrendPoint[]
  className?: string
}

const W = 960
const H = 320
const PAD = { top: 14, right: 18, left: 70 }
const INNER_W = W - PAD.left - PAD.right
/** The two value series. */
const INNER_H = 186
/** The difference bars underneath them, on their own scale. */
const BAR_TOP = 234
const BAR_H = 56
const LABEL_Y = 310

/** Catmull-Rom through the points, as a cubic Bézier path — a smooth line that
 *  still passes through every measured value rather than near it. */
function smoothPath(pts: readonly { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

export function ReconciliationTrend({ points, className }: ReconciliationTrendProps) {
  const captionId = useId()
  const gradientId = useId()
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const [active, setActive] = useState<number | null>(null)

  const geometry = useMemo(() => {
    if (points.length === 0) return null
    const max = points.reduce((m, p) => Math.max(m, p.inventory, p.books), 0)
    const scaleMax = max > 0 ? max * 1.08 : 1
    const x = (i: number) =>
      PAD.left + (points.length === 1 ? INNER_W / 2 : (i / (points.length - 1)) * INNER_W)
    const y = (v: number) => PAD.top + INNER_H - (Math.max(v, 0) / scaleMax) * INNER_H
    const inventory = points.map((p, i) => ({ x: x(i), y: y(p.inventory) }))
    const books = points.map((p, i) => ({ x: x(i), y: y(p.books) }))
    const bandWidth = points.length > 1 ? INNER_W / (points.length - 1) : INNER_W
    const maxDiff = points.reduce((m, p) => Math.max(m, Math.abs(p.difference)), 0)
    const bars = points.map((p, i) => {
      const abs = Math.abs(p.difference)
      // A non-zero gap always draws something: a bar rounded away to nothing
      // reads as "reconciled", which is the one thing it is not.
      const height = maxDiff > 0 && abs > 0 ? Math.max(3, (abs / maxDiff) * BAR_H) : 0
      return {
        x: x(i) - Math.min(22, bandWidth * 0.34) / 2,
        width: Math.min(22, bandWidth * 0.34),
        y: BAR_TOP + BAR_H - height,
        height,
        material: abs >= MATERIAL_TOLERANCE,
      }
    })
    const area =
      inventory.length > 1
        ? `${smoothPath(inventory)} L${inventory[inventory.length - 1].x.toFixed(2)},${(PAD.top + INNER_H).toFixed(2)} L${inventory[0].x.toFixed(2)},${(PAD.top + INNER_H).toFixed(2)} Z`
        : ''
    return {
      x,
      inventory,
      books,
      area,
      bars,
      maxDiff,
      inventoryPath: smoothPath(inventory),
      booksPath: smoothPath(books),
      yTicks: [0, scaleMax / 2, scaleMax].map((v) => ({ v, y: y(v) })),
      bandWidth,
    }
  }, [points])

  if (!geometry) {
    return (
      <p className={cx('py-10 text-center text-xs text-gray-500', className)}>
        Run reconciliation over multiple dates to view the trend.
      </p>
    )
  }

  const label = (i: number) => {
    const p = points[i]
    return `${formatDate(p.date)} · Inventory ₹ ${formatMoney(p.inventory)} · Books ₹ ${formatMoney(p.books)} · Difference ₹ ${formatMoney(p.difference)}`
  }

  return (
    <figure className={cx('m-0', className)}>
      <svg
        role="img"
        aria-labelledby={captionId}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.16" />
            <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geometry.yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="currentColor"
              className="text-gray-200"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" className="fill-gray-400 text-[11px]">
              {formatCurrencyCompact(t.v)}
            </text>
          </g>
        ))}

        {geometry.area ? <path d={geometry.area} fill={`url(#${gradientId})`} /> : null}

        {/* Books is dashed as well as blue. The two series are MEANT to be the
            same number, so they sit on top of each other when all is well — and
            one solid line hiding another is a chart that looks like it lost a
            series. The dash also survives a monochrome print. */}
        <path
          d={geometry.booksPath}
          fill="none"
          stroke="rgb(2 132 199)"
          strokeWidth={2.5}
          strokeDasharray="8 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={geometry.inventoryPath} fill="none" stroke="rgb(var(--color-primary))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={p.runId}>
            <circle cx={geometry.books[i].x} cy={geometry.books[i].y} r={active === i ? 5 : 3.5} fill="rgb(2 132 199)" />
            <circle cx={geometry.inventory[i].x} cy={geometry.inventory[i].y} r={active === i ? 5 : 3.5} fill="rgb(var(--color-primary))" />
            <text x={geometry.x(i)} y={LABEL_Y} textAnchor="middle" className="fill-gray-400 text-[11px]">
              {formatDate(p.date).slice(0, 6)}
            </text>
          </g>
        ))}

        {/* |difference| per run, on its own scale — the figure the two lines
            above cannot show, because at this zoom they agree to the pixel. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={BAR_TOP + BAR_H}
          y2={BAR_TOP + BAR_H}
          stroke="currentColor"
          className="text-gray-200"
          strokeWidth={1}
        />
        <text x={PAD.left - 8} y={BAR_TOP + BAR_H + 4} textAnchor="end" className="fill-gray-400 text-[11px]">
          ₹0
        </text>
        {geometry.maxDiff > 0 ? (
          <text x={PAD.left - 8} y={BAR_TOP + 10} textAnchor="end" className="fill-gray-400 text-[11px]">
            {formatCurrencyCompact(geometry.maxDiff)}
          </text>
        ) : null}
        {geometry.bars.map((bar, i) =>
          bar.height > 0 ? (
            <rect
              key={`bar-${points[i].runId}`}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={2}
              className={bar.material ? 'fill-red-400' : 'fill-emerald-400'}
            />
          ) : null,
        )}

        {active !== null ? (
          <line
            x1={geometry.x(active)}
            x2={geometry.x(active)}
            y1={PAD.top}
            y2={BAR_TOP + BAR_H}
            stroke="currentColor"
            className="text-gray-300"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ) : null}

        {/* One hit band per run, so the tooltip follows the pointer across the
            whole column rather than only over a 7px dot. */}
        {points.map((p, i) => (
          <rect
            key={`band-${p.runId}`}
            x={geometry.x(i) - geometry.bandWidth / 2}
            y={PAD.top}
            width={geometry.bandWidth}
            height={BAR_TOP + BAR_H - PAD.top}
            fill="transparent"
            onMouseEnter={(e) => {
              setActive(i)
              showTooltip(e, label(i))
            }}
            onMouseMove={moveTooltip}
            onMouseLeave={() => {
              setActive(null)
              hideTooltip()
            }}
          />
        ))}
      </svg>

      <ChartTooltip tooltip={tooltip} />

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-primary" aria-hidden />
          Inventory Value (₹)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-5 rounded"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgb(2 132 199) 0 6px, transparent 6px 10px)' }}
            aria-hidden
          />
          Books Stock Ledger (₹), dashed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2 rounded-sm bg-red-400" aria-hidden />
          |Difference| per run, own scale
        </span>
        <span className="text-gray-400">
          The two lines share one zero-based axis — nothing is zoomed to make the gap look bigger than it is.
        </span>
      </div>

      <figcaption id={captionId} className="sr-only">
        Inventory closing value and the Books Stock-in-Hand balance for the last {points.length} completed
        reconciliation runs.
      </figcaption>

      {/* The accessible equivalent: the same numbers, not a description. */}
      <div className="sr-only">
        <table>
          <caption>Inventory value against the Books stock ledger, by reconciliation date</caption>
          <thead>
            <tr>
              <th scope="col">As at</th>
              <th scope="col">Inventory value</th>
              <th scope="col">Books stock ledger</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.runId}>
                <th scope="row">{formatDate(p.date)}</th>
                <td>{formatMoney(p.inventory)}</td>
                <td>{formatMoney(p.books)}</td>
                <td>{formatMoney(p.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

export default ReconciliationTrend
