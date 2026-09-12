import type { ReactNode } from 'react'
import type { SortOrder } from '../services/api'
import { errorMessage } from '../services/api'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Sort parameter sent to the API; omit for unsortable columns. */
  sortKey?: string
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  loading?: boolean
  error?: Error | null
  emptyMessage?: ReactNode
  sort?: { key: string; order: SortOrder }
  onSort?: (key: string) => void
  onRowClick?: (row: T) => void
  /** Rendered in a trailing column, right-aligned. */
  rowActions?: (row: T) => ReactNode
  rowClassName?: (row: T) => string | undefined
  /** Rows rendered inside <tfoot> (totals). */
  footer?: ReactNode
}

function cellValue<T>(row: T, key: string): ReactNode {
  const v = (row as Record<string, unknown>)[key]
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, emptyMessage = 'Nothing here yet.', sort, onSort, onRowClick, rowActions, rowClassName, footer }: DataTableProps<T>) {
  const colCount = columns.length + (rowActions ? 1 : 0)
  const showState = rows.length === 0

  return (
    <div className="table-wrap">
      <table className={`table${loading && rows.length > 0 ? ' dimmed' : ''}`} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {columns.map((c) => {
              const alignClass = c.align ? ` align-${c.align}` : ''
              const sortable = !!c.sortKey && !!onSort
              const active = sortable && sort?.key === c.sortKey
              return (
                <th key={c.key} className={`${alignClass}${c.className ? ` ${c.className}` : ''}`} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort?.order === 'desc' ? 'descending' : 'ascending') : undefined}>
                  {sortable ? (
                    <button type="button" className={`th-sort${active ? ' active' : ''}`} onClick={() => onSort?.(c.sortKey as string)}>
                      {c.header}
                      <span className="arrow" aria-hidden>
                        {active ? (sort?.order === 'desc' ? '▼' : '▲') : '▲'}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
            {rowActions ? <th className="align-right" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {showState ? (
            <tr>
              <td colSpan={colCount} className="table-state">
                {error ? <span style={{ color: 'var(--danger)' }}>{errorMessage(error)}</span> : loading ? 'Loading…' : emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const extra = rowClassName?.(row)
              const clickable = !!onRowClick
              return (
                <tr
                  key={rowKey(row)}
                  className={`${clickable ? 'clickable' : ''}${extra ? ` ${extra}` : ''}` || undefined}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.align ? `align-${c.align}` : ''}${c.className ? ` ${c.className}` : ''}` || undefined}>
                      {c.render ? c.render(row) : cellValue(row, c.key)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="align-right" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">{rowActions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              )
            })
          )}
        </tbody>
        {footer && !showState ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  )
}
