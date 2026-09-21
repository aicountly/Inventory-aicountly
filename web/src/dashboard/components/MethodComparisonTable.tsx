import { cx } from '../../ui/cx'
import { formatCurrencyCompact } from '../formatters'
import { BAR_TRACK } from '../visuals'
import { formatVariance } from '../valuationMethods'
import type { MethodRow } from '../valuationMethods'

/**
 * The same stock costed four ways, in four rows.
 *
 * This panel COMPARES; it does not switch anything. The method a company's
 * books are kept on is a setting under Settings with its own permission, and
 * offering to change it from a dashboard tile would let someone restate a
 * year's closing stock from a screen they opened to read a number.
 *
 * A method that could not be valued reads "Unavailable" and has no bar. It is
 * never a zero: a blank in a comparison is a missing answer, while a zero is a
 * claim that this method values the company's stock at nothing.
 */
export interface MethodComparisonTableProps {
  rows: readonly MethodRow[]
  className?: string
}

const HEAD = 'px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500'

export function MethodComparisonTable({ rows, className }: MethodComparisonTableProps) {
  return (
    <table className={cx('w-full border-collapse text-xs', className)}>
      <caption className="sr-only">
        Total stock value under each valuation method, with the difference from the method the books are kept on.
      </caption>
      <thead>
        <tr className="border-b border-gray-200">
          <th scope="col" className={cx(HEAD, 'text-left')}>Method</th>
          <th scope="col" className={cx(HEAD, 'text-right')}>Value</th>
          <th scope="col" className={cx(HEAD, 'text-right')}>Variance</th>
          <th scope="col" className={cx(HEAD, 'hidden text-left sm:table-cell')}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.method}
            className={cx(
              'border-b border-gray-100 transition-colors last:border-b-0',
              row.isBasis ? 'bg-primary-light/25' : 'hover:bg-gray-50',
            )}
          >
            <th scope="row" className="px-2 py-2 text-left font-medium text-gray-800">
              <span className="block truncate">{row.label}</span>
              <span className={cx('mt-1 block h-1 overflow-hidden rounded-full sm:hidden', BAR_TRACK)}>
                <span
                  className={cx('block h-full rounded-full', row.isBasis ? 'bg-primary' : 'bg-sky-500')}
                  style={{ width: `${row.scale}%` }}
                />
              </span>
            </th>
            <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-gray-900">
              {row.value === null ? <span className="text-gray-400">Unavailable</span> : formatCurrencyCompact(row.value)}
            </td>
            <td
              className={cx(
                'whitespace-nowrap px-2 py-2 text-right tabular-nums',
                row.variancePercent === null
                  ? 'text-gray-300'
                  : row.variancePercent > 0
                    ? 'text-emerald-600'
                    : row.variancePercent < 0
                      ? 'text-red-600'
                      : 'text-gray-500',
              )}
            >
              {row.isBasis ? <span className="text-gray-400">—</span> : formatVariance(row.variancePercent)}
            </td>
            <td className="hidden px-2 py-2 sm:table-cell">
              <span
                className={cx(
                  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  row.status === 'basis'
                    ? 'border-primary/25 bg-primary-light text-primary'
                    : row.status === 'unavailable'
                      ? 'border-gray-200 bg-gray-50 text-gray-500'
                      : 'border-sky-200 bg-sky-50 text-sky-700',
                )}
              >
                {row.statusLabel}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default MethodComparisonTable
