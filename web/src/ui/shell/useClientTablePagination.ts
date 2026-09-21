import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [pageSize, setSize] = useState<PageSize>(initialPageSize)

  /*
   * A size change returns to page 1, in the same update.
   *
   * The reader who asks for 100 rows means the first 100; left on page 7 of
   * the old size they land somewhere arbitrary, or past the end. The control
   * used to reset the page itself, which cost every URL-backed list its page
   * size (see TablePagination), so the reset belongs here, beside the state it
   * is resetting.
   */
  const setPageSize = useCallback((size: PageSize) => {
    setSize(size)
    setPage(1)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const pagination = useMemo(() => paginateRows(rows, page, pageSize), [rows, page, pageSize])

  useEffect(() => {
    if (page > pagination.totalPages) setPage(pagination.totalPages)
  }, [page, pagination.totalPages])

  return { pagination, page, pageSize, setPage, setPageSize, pageRows: pagination.pageRows }
}
