import type { ReactNode } from 'react'
import { SmartTable } from './SmartTable'
import type { SmartTableProps } from './SmartTable'
import { TablePagination } from './TablePagination'
import { useClientTablePagination } from './useClientTablePagination'
import type { PageSize } from './paginateRows'

export interface PaginatedSmartTableProps<T> extends Omit<SmartTableProps<T>, 'footer'> {
  paginationResetKey?: string | number
  initialPageSize?: PageSize
  /** Render every row with no controls (e.g. when printing). */
  paginate?: boolean
  footer?: ReactNode
}

/** SmartTable with a client-side pagination footer. */
export function PaginatedSmartTable<T>({
  rows,
  paginationResetKey,
  initialPageSize = 25,
  paginate = true,
  keyboardResetKey,
  footer,
  ...rest
}: PaginatedSmartTableProps<T>) {
  const resetKey =
    paginationResetKey ??
    (typeof keyboardResetKey === 'string' || typeof keyboardResetKey === 'number'
      ? keyboardResetKey
      : undefined)
  const { pagination, page, pageSize, setPage, setPageSize, pageRows } = useClientTablePagination(
    rows,
    { resetKey, initialPageSize },
  )

  const paginationFooter = paginate ? (
    <TablePagination
      page={pagination.page}
      pageSize={pageSize}
      total={pagination.total}
      totalPages={pagination.totalPages}
      from={pagination.from}
      to={pagination.to}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      allowAll
    />
  ) : null

  return (
    <SmartTable
      {...rest}
      rows={paginate ? pageRows : rows}
      // Paging is a focus reset: the first row of the new page takes focus.
      keyboardResetKey={`${resetKey ?? ''}|${page}|${pageSize}`}
      footer={
        paginationFooter || footer ? (
          <>
            {paginationFooter}
            {footer}
          </>
        ) : null
      }
    />
  )
}

export default PaginatedSmartTable
