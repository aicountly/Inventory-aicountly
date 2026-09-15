import { useEffect, useMemo, useState } from 'react'
import { paginateRows } from './paginateRows'
import type { PageSize, PageSlice } from './paginateRows'

export interface ClientTablePagination<T> {
  pagination: PageSlice<T>
  page: number
  pageSize: PageSize
  setPage: (page: number) => void
  setPageSize: (size: PageSize) => void
  pageRows: readonly T[]
}

/** Client-side table pagination. Resets to page 1 when `resetKey` changes. */
export function useClientTablePagination<T>(
  rows: readonly T[],
  { resetKey, initialPageSize = 25 }: { resetKey?: string | number; initialPageSize?: PageSize } = {},
): ClientTablePagination<T> {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize)

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const pagination = useMemo(() => paginateRows(rows, page, pageSize), [rows, page, pageSize])

  useEffect(() => {
    if (page > pagination.totalPages) setPage(pagination.totalPages)
  }, [page, pagination.totalPages])

  return { pagination, page, pageSize, setPage, setPageSize, pageRows: pagination.pageRows }
}
