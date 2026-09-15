import type { ReactNode } from 'react'
import type { SortOrder } from '../services/api'
import { EmptyState } from '../ui/EmptyState'
import { SmartTable } from '../ui/shell/SmartTable'
import type { SmartColumn } from '../ui/shell/SmartTable'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Sort parameter sent to the API; omit for unsortable columns. */
  sortKey?: string
  /** `index` is the row's position on the current page. */
  render?: (row: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string | number
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
  /** Opt in to the register layout: sticky header, scrolling body. */
  stickyHeader?: boolean
  scrollBody?: boolean
  fillAvailable?: boolean
}

/**
 * The original Inventory list table, re-expressed on top of SmartTable.
 *
 * Its props are unchanged on purpose: 22 screens render one of these, and they
 * all pick up the Books table — sticky-capable header, skeleton loading, real
 * empty and error states, keyboard row navigation — without an edit. Sorting,
 * row actions and the `<tfoot>` slot behave exactly as before.
 *
 * New screens should use SmartTable directly; this stays until the last
 * caller is converted.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyMessage = 'Nothing here yet.',
  sort,
  onSort,
  onRowClick,
  rowActions,
  rowClassName,
  footer,
  stickyHeader,
  scrollBody,
  fillAvailable,
}: DataTableProps<T>) {
  const smartColumns: SmartColumn<T>[] = columns.map((c) => ({
    key: c.key,
    header: c.header,
    sortKey: c.sortKey,
    align: c.align,
    width: c.width,
    cellClassName: c.className,
    headerClassName: c.className,
    render: c.render ? (row, index) => c.render?.(row, index) : undefined,
  }))

  if (rowActions) {
    smartColumns.push({
      key: '__actions',
      header: '',
      align: 'right',
      headerClassName: 'print:hidden',
      cellClassName: 'print:hidden',
      render: (row) => (
        // Row actions must not also trigger the row's own click handler.
        <div
          className="flex items-center justify-end gap-1.5"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {rowActions(row)}
        </div>
      ),
    })
  }

  return (
    <SmartTable<T>
      columns={smartColumns}
      rows={rows}
      rowKey={(row) => rowKey(row)}
      loading={loading}
      error={error ?? null}
      empty={
        typeof emptyMessage === 'string' ? (
          <EmptyState size="sm" title={emptyMessage} />
        ) : (
          emptyMessage
        )
      }
      sort={sort}
      onSort={onSort}
      onRowClick={onRowClick ? (row) => onRowClick(row) : undefined}
      // These screens have always opened a record on a single click.
      activateOnSingleClick
      rowClassName={(row) => rowClassName?.(row)}
      tfoot={footer}
      stickyHeader={stickyHeader}
      scrollBody={scrollBody}
      fillAvailable={fillAvailable}
      minWidth={520}
    />
  )
}
