import { ChevronRight, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatDate, formatInt, formatMoney, formatQty } from '../../../utils/format'
import { deviationSpread, relativeBar } from './model'
import type { MethodComparison, MethodComparisonRow } from './model'
import { signedMoney, signedPercent } from './words'

/**
 * The four methods, side by side.
 *
 * The item-master row is the basis and is marked as such — tinted, pilled
 * "books basis", and measured against nothing. The three below it are
 * counterfactual: what the same physical stock would be worth if one method
 * were applied throughout. Nothing on this screen writes any of them anywhere,
 * and the footnote under the table says so in words.
 *
 * Sign is carried by the digits, not only by the colour: `+47,720.00` reads as
 * an increase in greyscale, to a colour-blind reader and on a fax of a printout.
 */

const HEAD_CELL = 'px-3 py-2 text-label-sm font-semibold uppercase tracking-wide text-gray-500'

const HELP = {
  stockValue: 'Closing stock valued at the unit cost this method resolves, as at the selected date.',
  vsBasis:
    'Difference from the basis — the value calculated using each item’s own configured valuation method.',
  relative: 'This method’s value against the item-master basis of 100%, scaled to the widest gap shown.',
  variance: 'The difference as a percentage of the basis stock value.',
}

function HeadHelp({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Tooltip label={label}>
        <button
          type="button"
          // Icon-only and purely explanatory: it is reachable and readable, and
          // pressing it does nothing the tooltip has not already said.
          aria-label={label}
          className="rounded text-gray-300 transition-colors hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
    </span>
  )
}

export interface MethodComparisonTableProps {
  comparison: MethodComparison
  asOf: string
  /** Opens the per-item breakdown for a method. */
  onDrilldown: (row: MethodComparisonRow) => void
  /** Dims the figures while a refresh is in flight, rather than blanking them. */
  refreshing?: boolean
}

export function MethodComparisonTable({
  comparison,
  asOf,
  onDrilldown,
  refreshing = false,
}: MethodComparisonTableProps) {
  const spread = deviationSpread(comparison.rows)

  return (
    <div
      className={cx(
        // `relative` is load-bearing, not decoration. `sr-only` positions its
        // box absolutely, so without a positioned ancestor inside this scroller
        // the caption and the per-row readings resolve against the viewport —
        // escaping the clip and leaving the whole document scrollable sideways
        // by the width of the table, on a phone, with nothing visible there.
        'relative w-full min-w-0 overflow-x-auto transition-opacity',
        refreshing && 'opacity-60',
      )}
    >
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Item count, closing quantity and stock value under each valuation method as at{' '}
          {formatDate(asOf)}, each compared with the item-master basis.
        </caption>
        <thead className="bg-gray-50">
          <tr className="border-y border-gray-200 text-left">
            <th scope="col" className={HEAD_CELL}>
              Method
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'text-right')}>
              Items
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'text-right')}>
              Closing qty
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'text-right')}>
              <HeadHelp label={HELP.stockValue}>Stock value</HeadHelp>
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'text-right')}>
              <HeadHelp label={HELP.vsBasis}>vs item master</HeadHelp>
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'w-[22%] min-w-[11rem]')}>
              <HeadHelp label={HELP.relative}>Relative value</HeadHelp>
            </th>
            <th scope="col" className={cx(HEAD_CELL, 'text-right')}>
              <HeadHelp label={HELP.variance}>Variance</HeadHelp>
            </th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <MethodRow key={row.method} row={row} spread={spread} onDrilldown={onDrilldown} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MethodRow({
  row,
  spread,
  onDrilldown,
}: {
  row: MethodComparisonRow
  spread: number
  onDrilldown: (row: MethodComparisonRow) => void
}) {
  if (!row.answered) {
    return (
      <tr className="border-b border-gray-100 last:border-b-0">
        <th scope="row" className="px-3 py-3 text-left font-semibold text-gray-900">
          {row.label}
        </th>
        {/* A blank row in a comparison is a missing answer. A zero here would
            read as "this method values the stock at nothing", which is a
            different — and much more alarming — statement. */}
        <td colSpan={6} className="px-3 py-3 text-xs text-gray-500">
          Could not be valued at this date.
        </td>
      </tr>
    )
  }

  const tone =
    row.difference === null || row.difference === 0
      ? 'text-gray-500'
      : row.difference > 0
        ? 'text-emerald-600'
        : 'text-red-600'

  return (
    <tr
      className={cx(
        'border-b border-gray-100 last:border-b-0',
        row.baseline ? 'bg-primary-light/30' : 'table-row-hover',
      )}
    >
      <th scope="row" className="px-3 py-3 text-left font-semibold text-gray-900">
        {row.baseline ? (
          <span className="flex flex-wrap items-center gap-2">
            {row.label}
            <span className="rounded-full bg-primary-light px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Books basis
            </span>
          </span>
        ) : (
          // The method name is the drill-down, so the affordance is a real
          // button with a real label rather than a click handler on the row:
          // a row that only responds to a mouse is a row a keyboard cannot open.
          <button
            type="button"
            onClick={() => onDrilldown(row)}
            className="group inline-flex items-center gap-1 rounded text-left font-semibold text-gray-900 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="group-hover:underline">{row.label}</span>
            <ChevronRight
              className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-primary"
              aria-hidden
            />
            <span className="sr-only">— show the items behind this difference</span>
          </button>
        )}
      </th>
      <td className="px-3 py-3 text-right tabular-nums text-gray-600">{formatInt(row.items)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-gray-600">{formatQty(row.closingQty)}</td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums text-gray-900">
        {formatMoney(row.stockValue)}
      </td>
      <td className={cx('px-3 py-3 text-right tabular-nums', row.difference === null ? 'text-gray-400' : tone)}>
        {row.difference === null ? '—' : signedMoney(row.difference)}
      </td>
      <td className="px-3 py-3">
        <RelativeValueBar row={row} spread={spread} />
      </td>
      <td className={cx('px-3 py-3 text-right font-medium tabular-nums', row.variancePercent === null ? 'text-gray-400' : tone)}>
        {row.variancePercent === null ? '—' : signedPercent(row.variancePercent)}
      </td>
    </tr>
  )
}

const FILL_TONE = {
  above: 'bg-emerald-500',
  below: 'bg-rose-400',
  level: 'bg-gray-300',
} as const

const DOT_TONE = {
  above: 'bg-emerald-500',
  below: 'bg-rose-500',
  level: 'bg-gray-400',
} as const

/**
 * The relative-value micro-bar: a track with the basis at its centre and a fill
 * running out to one side.
 *
 * Centred rather than left-origin because of what these figures look like in
 * practice — four methods inside a percent of each other. Bars drawn in
 * proportion to the *values* would be four bars of identical length, which
 * looks like a chart and carries no information. From the centre, the eye reads
 * the one comparison this column exists for: which side of the books each
 * method falls, and by how much relative to the others.
 *
 * `aria-hidden` on the drawing, with the reading spelled out for a screen
 * reader beside it. A div with a width in percent is not a figure anyone can
 * hear.
 */
export function RelativeValueBar({ row, spread }: { row: MethodComparisonRow; spread: number }) {
  const bar = relativeBar(row, spread)
  const pct = row.relativeValue

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-1.5 min-w-[5rem] flex-1 rounded-full bg-gray-100" aria-hidden>
        {/* The basis line — the thing every bar is read against. */}
        <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded bg-gray-300" />
        {bar.width > 0 ? (
          <span
            className={cx('absolute top-0 h-full rounded-full', FILL_TONE[bar.direction])}
            style={
              bar.direction === 'above'
                ? { left: '50%', width: `${bar.width}%` }
                : { right: '50%', width: `${bar.width}%` }
            }
          />
        ) : null}
        <span
          className={cx(
            'absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm',
            DOT_TONE[bar.direction],
          )}
          style={{
            left:
              bar.direction === 'above'
                ? `${50 + bar.width}%`
                : bar.direction === 'below'
                  ? `${50 - bar.width}%`
                  : '50%',
          }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-500">
        {pct === null ? '—' : `${pct.toFixed(1)}%`}
      </span>
      <span className="sr-only">
        {pct === null
          ? 'No basis to compare against.'
          : row.baseline
            ? 'The basis, 100%.'
            : bar.direction === 'level'
              ? `Level with the basis at ${pct.toFixed(2)}%.`
              : `${Math.abs(bar.deviation).toFixed(2)}% ${bar.direction} the basis.`}
      </span>
    </div>
  )
}

export default MethodComparisonTable
