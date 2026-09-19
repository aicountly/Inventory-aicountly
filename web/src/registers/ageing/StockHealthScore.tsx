import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../ui/cx'
import { formatMoney } from '../../utils/format'
import { HEALTH_BANDS, HEALTH_SCORE_WEIGHTS } from './stockAgeingModel'
import type { StockHealth } from './stockAgeingModel'

/**
 * One number for "how healthy is the stock on hand", and the arithmetic behind it.
 *
 * The score is a STATED RULE, not a model, and the page says so out loud: 100 less a
 * penalty per band, weights fixed in `stockAgeingModel`, every term shown on request. A
 * controller who disagrees with the 82 can see which band cost the 18 and check it
 * against the same figures on the same screen. Nothing here is called intelligence,
 * nothing is learned, and nothing is hidden — a score a reader cannot reproduce is a
 * score they cannot defend in a review meeting, which makes it worse than no score.
 *
 * The band name is always printed beside the ring: the colour is a second signal, never
 * the only one.
 */

const RING_RADIUS = 34
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const RING_STROKE: Record<string, string> = {
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f97316',
  rose: '#f43f5e',
  teal: '#14b8a6',
}

const BAND_TEXT: Record<string, string> = {
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-orange-600',
  rose: 'text-rose-600',
  teal: 'text-teal-600',
}

export function StockHealthScore({ health }: { health: StockHealth }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const { score, band } = health
  const stroke = RING_STROKE[band.tone] ?? RING_STROKE.success
  const dash = ((score ?? 0) / 100) * RING_CIRCUMFERENCE

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-4">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="40" cy="40" r={RING_RADIUS} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="8" />
            {score === null ? null : (
              <circle
                cx="40"
                cy="40"
                r={RING_RADIUS}
                fill="none"
                stroke={stroke}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${RING_CIRCUMFERENCE - dash}`}
                className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold leading-none tabular-nums text-gray-900">
              {score === null ? '—' : score}
            </span>
            <span className="mt-0.5 text-[10px] text-gray-400">/ 100</span>
          </div>
        </div>

        <div className="min-w-0">
          <span className="text-label-xs font-semibold uppercase tracking-wide text-gray-400">
            Stock health
          </span>
          {/* The word, not the colour, is what this card asserts. */}
          <p className={cx('mt-0.5 text-lg font-semibold leading-tight', BAND_TEXT[band.tone] ?? 'text-gray-900')}>
            {score === null ? 'No stock to assess' : band.label}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {score === null
              ? 'Nothing matches the current filters, so there is no ageing profile to score.'
              : band.summary}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="mt-2 inline-flex w-fit items-center gap-1 rounded text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        How is this calculated?
        <ChevronDown className={cx('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open ? (
        <div id={panelId} className="mt-2 rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 text-[11px] leading-relaxed text-gray-600">
          <p className="font-semibold text-gray-700">
            100, less a fixed penalty for the share of stock <em>value</em> in each ageing band.
          </p>
          <table className="mt-1.5 w-full">
            <thead>
              <tr className="text-left text-gray-400">
                <th scope="col" className="font-medium">Band</th>
                <th scope="col" className="text-right font-medium">Share of value</th>
                <th scope="col" className="text-right font-medium">Weight</th>
                <th scope="col" className="text-right font-medium">Points off</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {health.terms.map((term) => (
                <tr key={term.key}>
                  <th scope="row" className="py-0.5 pr-2 text-left font-normal">{term.label}</th>
                  <td className="py-0.5 text-right">{term.percent.toFixed(1)}%</td>
                  <td className="py-0.5 text-right text-gray-400">×{term.weight}</td>
                  <td className="py-0.5 text-right font-semibold text-gray-700">
                    −{term.penalty.toFixed(1)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200">
                <th scope="row" className="py-1 pr-2 text-left font-semibold text-gray-700">Score</th>
                <td colSpan={2} />
                <td className="py-1 text-right font-semibold text-gray-900">
                  {score === null ? '—' : score}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1.5">
            Bands up to 60 days carry no penalty. Anything older is weighted{' '}
            {Object.values(HEALTH_SCORE_WEIGHTS).join(', ')} respectively, and the result is
            clamped to 0–100. Bands:{' '}
            {HEALTH_BANDS.map((b) => `${b.label} ${b.min}+`).join(' · ')}.
          </p>
          <p className="mt-1.5 text-gray-500">
            Capital older than 90 days: <strong className="text-gray-700">{formatMoney(health.valueOver90)}</strong> ·
            older than 180 days: <strong className="text-gray-700">{formatMoney(health.valueOver180)}</strong>.
            Ageing itself comes from the open cost layers, not from this score — it is a
            reading of them.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export default StockHealthScore
