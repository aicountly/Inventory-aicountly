import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ChartTooltip, useChartTooltip } from '../../dashboard/charts/ChartTooltip'
import { cx } from '../../ui/cx'
import { formatCount, formatCurrencyCompact, formatQtyCompact } from '../../dashboard/formatters'
import { formatMoney, formatQty } from '../../utils/format'
import { measureOf, percentOf } from './stockAgeingModel'
import type { AgeingMeasure, BucketSlice } from './stockAgeingModel'

/**
 * The two pictures of one ageing split: bars by band, and the same bands as a ring.
 *
 * Written here rather than taken from `dashboard/charts` for one reason that matters:
 * those charts RANK — `donutArcs` sorts slices by size and colours them by position, which
 * is right for "top items by value" and wrong for an ageing band, where 0–30 must always
 * be green, always sit first, and must keep its place in the row even when it is empty. A
 * ring whose colours moved with the data would be unreadable against the legend beside it.
 *
 * Three rules both charts keep:
 *
 *  - **Colour is never the only signal.** Every band is labelled on the axis or in the
 *    legend, and both charts ship the visually-hidden `<table>` that IS the data — a
 *    screen reader gets the figures, not a description of a picture.
 *  - **An empty band is drawn as empty**, never as a sliver. A 1px stub where nothing is
 *    sitting reads as a small amount rather than as none.
 *  - **A band is a link when it can filter**, and inert markup when it cannot, so nothing
 *    on screen offers an interaction that does nothing.
 */

function formatMeasure(value: number, measure: AgeingMeasure): string {
  if (measure === 'value') return formatCurrencyCompact(value)
  if (measure === 'qty') return formatQtyCompact(value)
  return formatCount(value)
}

function formatMeasureFull(value: number, measure: AgeingMeasure): string {
  if (measure === 'value') return formatMoney(value)
  if (measure === 'qty') return formatQty(value, '0')
  return formatCount(value)
}

export const MEASURE_NOUN: Record<AgeingMeasure, string> = {
  value: 'Stock value',
  qty: 'Quantity',
  items: 'Items',
}

/** The hover line — the same sentence for a bar and for an arc. */
function tooltipFor(slice: BucketSlice, measure: AgeingMeasure): string {
  return `${slice.srLabel} · ${formatMeasureFull(measureOf(slice, measure), measure)} · ${percentOf(slice, measure).toFixed(1)}% of ${MEASURE_NOUN[measure].toLowerCase()}`
}

/** The figures behind either chart, for assistive technology and for print. */
function BandTable({
  id,
  slices,
  measure,
  caption,
}: {
  id: string
  slices: readonly BucketSlice[]
  measure: AgeingMeasure
  caption: string
}) {
  return (
    <table id={id} className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Ageing band</th>
          <th scope="col">{MEASURE_NOUN[measure]}</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {slices.map((slice) => (
          <tr key={slice.key}>
            <th scope="row">{slice.srLabel}</th>
            <td>{formatMeasureFull(measureOf(slice, measure), measure)}</td>
            <td>{percentOf(slice, measure).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ------------------------------------------------------------------- bars */

export interface AgeingBandBarsProps {
  slices: readonly BucketSlice[]
  measure: AgeingMeasure
  /** Where clicking a band goes, or null when it cannot filter. */
  hrefFor?: (slice: BucketSlice) => string | null
  /** The band currently filtered, drawn as pressed. */
  activeKey?: string | null
  height?: number
}

export function AgeingBandBars({
  slices,
  measure,
  hrefFor,
  activeKey = null,
  height = 196,
}: AgeingBandBarsProps) {
  const tableId = useId()
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()
  const max = slices.reduce((m, s) => Math.max(m, measureOf(s, measure)), 0)

  return (
    <figure className="m-0">
      <div className="flex items-end gap-1.5 sm:gap-3" style={{ height }} role="img" aria-labelledby={tableId}>
        {slices.map((slice) => {
          const value = measureOf(slice, measure)
          // A band with nothing in it draws no bar at all — see the rules above.
          const pct = max > 0 && value > 0 ? Math.max(3, (value / max) * 100) : 0
          const active = activeKey === slice.key
          const href = hrefFor?.(slice) ?? null
          const label = tooltipFor(slice, measure)

          const body = (
            <>
              <span
                className={cx(
                  'block text-center text-[11px] font-semibold tabular-nums leading-none transition-opacity',
                  value > 0 ? 'text-gray-700' : 'text-gray-300',
                )}
              >
                {value > 0 ? formatMeasure(value, measure) : '—'}
              </span>
              <span className="flex flex-1 items-end pt-1.5">
                <span
                  className="block w-full rounded-t-md transition-[height,opacity] duration-300 motion-reduce:transition-none"
                  style={{ height: `${pct}%`, backgroundColor: slice.color, opacity: active ? 1 : 0.88 }}
                />
              </span>
            </>
          )

          const shared = {
            className: cx(
              'group flex h-full min-w-0 flex-1 flex-col rounded-lg px-0.5 pt-1',
              href && 'cursor-pointer hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active && 'bg-primary-light/60 ring-1 ring-primary/30',
            ),
            onMouseEnter: (e: React.MouseEvent) => showTooltip(e, label),
            onMouseMove: moveTooltip,
            onMouseLeave: hideTooltip,
          }

          return href ? (
            <Link
              key={slice.key}
              to={href}
              replace
              aria-label={`${label}. ${active ? 'Filtered — select to clear' : 'Select to filter the register to this band'}`}
              aria-pressed={active}
              role="button"
              {...shared}
            >
              {body}
            </Link>
          ) : (
            <span key={slice.key} {...shared}>
              {body}
            </span>
          )
        })}
      </div>

      {/* The axis. Outside the bar row so the labels never shrink the plot. */}
      <div className="mt-1.5 flex gap-1.5 border-t border-gray-100 pt-1.5 sm:gap-3">
        {slices.map((slice) => (
          <span key={slice.key} className="min-w-0 flex-1 text-center">
            <span className="flex items-center justify-center gap-1">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span
                className={cx(
                  'truncate text-[11px] font-medium',
                  activeKey === slice.key ? 'text-primary' : 'text-gray-500',
                )}
              >
                {slice.label}
              </span>
            </span>
            <span className="mt-0.5 block text-[10px] tabular-nums text-gray-400">
              {percentOf(slice, measure).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>

      <BandTable
        id={tableId}
        slices={slices}
        measure={measure}
        caption={`${MEASURE_NOUN[measure]} by ageing band`}
      />
      <ChartTooltip tooltip={tooltip} />
    </figure>
  )
}

/* ------------------------------------------------------------------ donut */

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface AgeingBandDonutProps {
  slices: readonly BucketSlice[]
  measure: AgeingMeasure
  centerValue: string
  centerLabel: string
  hrefFor?: (slice: BucketSlice) => string | null
  activeKey?: string | null
}

export function AgeingBandDonut({
  slices,
  measure,
  centerValue,
  centerLabel,
  hrefFor,
  activeKey = null,
}: AgeingBandDonutProps) {
  const tableId = useId()
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useChartTooltip()

  const total = slices.reduce((sum, s) => sum + Math.max(0, measureOf(s, measure)), 0)
  let offset = 0
  const arcs = slices.map((slice) => {
    const value = Math.max(0, measureOf(slice, measure))
    const percent = total > 0 ? (value / total) * 100 : 0
    const arc = { slice, percent, offset }
    offset += percent
    return arc
  })

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-[140px] w-[140px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-labelledby={tableId}>
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="14" />
          {arcs.map(({ slice, percent, offset: start }) => {
            if (percent <= 0) return null
            const dash = (percent / 100) * CIRCUMFERENCE
            return (
              <circle
                key={slice.key}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke={slice.color}
                strokeWidth={activeKey === slice.key ? 17 : 14}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-((start / 100) * CIRCUMFERENCE)}
                strokeLinecap="butt"
                className="transition-[stroke-width] hover:[stroke-width:17]"
                onMouseEnter={(e) => showTooltip(e, tooltipFor(slice, measure))}
                onMouseMove={moveTooltip}
                onMouseLeave={hideTooltip}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-semibold tabular-nums leading-none text-gray-900">
            {centerValue}
          </span>
          <span className="mt-1 text-[11px] uppercase tracking-wider text-gray-400">
            {centerLabel}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {slices.map((slice) => {
          const href = hrefFor?.(slice) ?? null
          const active = activeKey === slice.key
          const row = (
            <>
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="min-w-0 flex-1 truncate">{slice.srLabel}</span>
              <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                {formatMeasure(measureOf(slice, measure), measure)}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-gray-400">
                {percentOf(slice, measure).toFixed(1)}%
              </span>
            </>
          )
          return (
            <li key={slice.key}>
              {href ? (
                <Link
                  to={href}
                  replace
                  aria-pressed={active}
                  role="button"
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-600 no-underline transition-colors',
                    'hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    active && 'bg-primary-light/60 ring-1 ring-primary/30',
                  )}
                >
                  {row}
                </Link>
              ) : (
                <span className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-gray-600">
                  {row}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <BandTable
        id={tableId}
        slices={slices}
        measure={measure}
        caption={`${MEASURE_NOUN[measure]} by ageing band`}
      />
      <ChartTooltip tooltip={tooltip} />
    </div>
  )
}
