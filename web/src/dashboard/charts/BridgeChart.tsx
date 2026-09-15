import { useId } from 'react'
import { cx } from '../../ui/cx'

/**
 * The inventory value bridge — a waterfall from opening to closing.
 *
 * Each step is a floating bar: it starts where the running total was and ends
 * where it is now, so the picture IS the arithmetic. The first and last bars
 * are totals and sit on the baseline; everything between them floats.
 *
 * The thing this component refuses to do is draw a bridge that does not close.
 * `steps` are deltas and the caller passes `opening` and `closing` separately;
 * if `opening + Σ deltas` disagrees with `closing`, the residual is drawn as
 * its own labelled bar rather than quietly absorbed into the last step or
 * silently dropped. A waterfall whose bars do not reach its own end value is
 * the most misleading chart on any finance screen.
 */
export interface BridgeStep {
  key: string
  label: string
  /** Signed delta. Positive adds, negative subtracts. */
  delta: number
  /** Already formatted with currency. */
  display: string
  /** Secondary line — movement count, gross figures. */
  sub?: string
}

export interface BridgeChartProps {
  openingLabel: string
  opening: number
  openingDisplay: string
  closingLabel: string
  closing: number
  closingDisplay: string
  steps: readonly BridgeStep[]
  caption: string
  /** Formats the residual bar if one is needed. */
  formatValue: (n: number) => string
  height?: number
  className?: string
}

interface Bar {
  key: string
  label: string
  /** Value the bar spans from and to, in data units. */
  from: number
  to: number
  display: string
  sub?: string
  kind: 'total' | 'increase' | 'decrease' | 'residual'
}

const KIND_FILL: Record<Bar['kind'], string> = {
  total: 'bg-primary',
  increase: 'bg-teal-500',
  decrease: 'bg-orange-500',
  // Amber, not a third neutral: a residual is something to look at.
  residual: 'bg-amber-500',
}

export function buildBridgeBars(
  opening: number,
  steps: readonly BridgeStep[],
  closing: number,
  openingLabel: string,
  closingLabel: string,
  openingDisplay: string,
  closingDisplay: string,
  formatValue: (n: number) => string,
): Bar[] {
  const bars: Bar[] = [
    { key: '__opening__', label: openingLabel, from: 0, to: opening, display: openingDisplay, kind: 'total' },
  ]
  let running = opening
  for (const step of steps) {
    const from = running
    running += step.delta
    bars.push({
      key: step.key,
      label: step.label,
      from,
      to: running,
      display: step.display,
      sub: step.sub,
      kind: step.delta >= 0 ? 'increase' : 'decrease',
    })
  }

  // Sub-rupee drift is floating-point noise from summing; anything larger is a
  // real gap and is shown as one.
  const residual = closing - running
  if (Math.abs(residual) >= 0.01) {
    const from = running
    running += residual
    bars.push({
      key: '__residual__',
      label: 'Unexplained',
      from,
      to: running,
      display: formatValue(residual),
      sub: 'Difference between the steps above and the closing value',
      kind: 'residual',
    })
  }

  bars.push({ key: '__closing__', label: closingLabel, from: 0, to: closing, display: closingDisplay, kind: 'total' })
  return bars
}

export function BridgeChart({
  openingLabel,
  opening,
  openingDisplay,
  closingLabel,
  closing,
  closingDisplay,
  steps,
  caption,
  formatValue,
  height = 200,
  className,
}: BridgeChartProps) {
  const captionId = useId()
  const bars = buildBridgeBars(opening, steps, closing, openingLabel, closingLabel, openingDisplay, closingDisplay, formatValue)

  // The axis spans every value the walk passes through, and always includes
  // zero — a waterfall floated off a non-zero baseline exaggerates every step.
  const values = bars.flatMap((b) => [b.from, b.to])
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const pos = (v: number) => ((v - min) / span) * 100

  return (
    <figure className={cx('m-0', className)}>
      <div role="img" aria-labelledby={captionId} className="flex items-stretch gap-1 overflow-x-auto scrollbar-thin" style={{ height }}>
        {bars.map((bar) => {
          const lo = Math.min(bar.from, bar.to)
          const hi = Math.max(bar.from, bar.to)
          const bottom = pos(lo)
          const barHeight = Math.max(bar.from === bar.to ? 0 : 2, pos(hi) - pos(lo))
          return (
            <div key={bar.key} className="flex min-w-[64px] flex-1 flex-col">
              <div className="relative flex-1">
                <div
                  className={cx('absolute inset-x-1 rounded-sm transition-all duration-500 md:inset-x-2', KIND_FILL[bar.kind])}
                  style={{ bottom: `${bottom}%`, height: `${barHeight}%` }}
                  title={`${bar.label}: ${bar.display}`}
                />
                {/* Zero line, drawn only when the walk actually crosses it. */}
                {min < 0 ? (
                  <div className="absolute inset-x-0 border-t border-dashed border-gray-300" style={{ bottom: `${pos(0)}%` }} aria-hidden />
                ) : null}
              </div>
              <div className="mt-1.5 min-w-0 text-center">
                <p className="truncate text-[10px] text-gray-500" title={bar.label}>
                  {bar.label}
                </p>
                <p
                  className={cx(
                    'truncate text-[11px] font-semibold tabular-nums',
                    bar.kind === 'residual' ? 'text-amber-700' : 'text-gray-900',
                  )}
                >
                  {bar.display}
                </p>
              </div>
            </div>
          )
        })}
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
            <th scope="col">Step</th>
            <th scope="col">Amount</th>
            <th scope="col">Running total</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <th scope="row">{bar.label}</th>
              <td>{bar.display}</td>
              <td>{formatValue(bar.to)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  )
}

export default BridgeChart
