import { Link } from 'react-router-dom'
import { cx } from '../../ui/cx'
import { BAR_FILL, BAR_TRACK } from '../visuals'
import type { SeriesItem } from '../model'

/**
 * Movement classification, as a table with a bar in the last column.
 *
 * **The third column is quantity on hand, not rupees, and the heading says so.**
 * The movement report's summary carries item counts and on-hand quantity per
 * class and no value at all (see valuationModel.movementSeriesForValuation). A
 * currency column here would have to be derived from a different report and
 * captioned as though it came from this one, which is how a dashboard ends up
 * with two different numbers for the same thing.
 *
 * The category name is the drill-through, so the link has real text rather than
 * a whole row wrapped in an anchor — a `<tr>` cannot contain one, and a
 * row-sized click target with no accessible name is worse than a named cell.
 */
export interface MovementClassTableProps {
  rows: readonly SeriesItem[]
  caption: string
  className?: string
}

const HEAD = 'px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500'
const CELL = 'px-2 py-2 tabular-nums whitespace-nowrap'

export function MovementClassTable({ rows, caption, className }: MovementClassTableProps) {
  return (
    <table className={cx('w-full border-collapse text-xs', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-gray-200">
          <th scope="col" className={cx(HEAD, 'text-left')}>Category</th>
          <th scope="col" className={cx(HEAD, 'whitespace-nowrap text-right')}>Items</th>
          <th scope="col" className={cx(HEAD, 'whitespace-nowrap text-right')}>On hand</th>
          <th scope="col" className={cx(HEAD, 'whitespace-nowrap text-right')}>% items</th>
          <th scope="col" className={cx(HEAD, 'hidden w-[26%] sm:table-cell')}>
            <span className="sr-only">Relative size</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="group border-b border-gray-100 transition-colors last:border-b-0 hover:bg-primary-light/30">
            <th scope="row" className="px-2 py-2 text-left font-normal">
              <span className="flex items-center gap-2">
                <span className={cx('h-2 w-2 shrink-0 rounded-full', BAR_FILL[row.tone])} aria-hidden />
                {row.to ? (
                  <Link
                    to={row.to}
                    className="truncate font-medium text-gray-800 no-underline hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-gray-800">{row.label}</span>
                )}
              </span>
            </th>
            <td className={cx(CELL, 'text-right font-semibold text-gray-900')}>{row.display}</td>
            <td className={cx(CELL, 'text-right text-gray-500')}>{row.sub ?? '—'}</td>
            <td className={cx(CELL, 'text-right text-gray-500')}>{row.share.toFixed(0)}%</td>
            <td className="hidden px-2 py-2 sm:table-cell">
              <span className={cx('block h-1.5 overflow-hidden rounded-full', BAR_TRACK)}>
                <span
                  className={cx('block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', BAR_FILL[row.tone])}
                  style={{ width: `${Math.max(row.value > 0 ? 3 : 0, row.scale)}%` }}
                />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default MovementClassTable
