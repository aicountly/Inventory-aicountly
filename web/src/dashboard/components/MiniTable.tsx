import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { TABLE_HEADER, TABLE_STICKY_HEAD } from '../../styles/designTokens'

/**
 * The compact table inside a dashboard card: sticky header, capped scroll, one
 * click per row into the record behind it.
 *
 * This is a deliberate stand-in. The shared `SmartTable` (Books' shell/SmartTable
 * port, with keyboard row activation, totals and column config) is landing in
 * src/ui/shell; when it does, this component should become a thin wrapper over
 * it with DASHBOARD_TABLE_PROPS, exactly as Books' DashboardCompactTable is.
 * Everything that would differ — the design-token class strings, the row-click
 * contract, the sticky head — is already sourced from the shared tokens, so the
 * swap is mechanical and no widget changes.
 */
export interface MiniColumn<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right'
  /** Extra classes for the cell (width caps, tabular-nums…). */
  cellClassName?: string
  headerClassName?: string
  render: (row: T) => ReactNode
}

export interface MiniTableProps<T> {
  columns: readonly MiniColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T, index: number) => string | number
  /** Destination for the row; a row with no destination is not clickable. */
  to?: (row: T) => string | null
  /** Tailwind max-height for the scroll body. */
  maxHeight?: string
  /** Extra classes on a row — used to tint the ones that need attention. */
  rowClassName?: (row: T) => string | undefined
}

export function MiniTable<T>({
  columns,
  rows,
  rowKey,
  to,
  maxHeight = 'max-h-64',
  rowClassName,
}: MiniTableProps<T>) {
  const navigate = useNavigate()

  return (
    <div className={`overflow-auto ${maxHeight} -mx-1`}>
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${TABLE_STICKY_HEAD} ${TABLE_HEADER} px-1.5 py-1.5 ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                } ${c.headerClassName ?? ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const href = to ? to(row) : null
            return (
              <tr
                key={rowKey(row, i)}
                className={`table-row-hover border-b border-gray-50 ${href ? 'cursor-pointer' : ''} ${
                  rowClassName?.(row) ?? ''
                }`}
                {...(href
                  ? {
                      onClick: () => navigate(href),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(href)
                        }
                      },
                      tabIndex: 0,
                      role: 'link',
                      'aria-label': `Open row ${i + 1}`,
                    }
                  : {})}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-1.5 py-1.5 align-middle ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${
                      c.cellClassName ?? ''
                    }`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default MiniTable
