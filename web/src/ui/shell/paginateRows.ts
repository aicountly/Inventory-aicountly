export type PageSize = number | 'all'

export interface PageSlice<T> {
  pageRows: readonly T[]
  total: number
  page: number
  totalPages: number
  from: number
  to: number
}

/** Pure client-side slice. Ported from Books so the two products page alike. */
export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: PageSize,
): PageSlice<T> {
  const total = rows.length
  if (pageSize === 'all' || pageSize >= total) {
    return { pageRows: rows, total, page: 1, totalPages: 1, from: total ? 1 : 0, to: total }
  }
  const size = Number(pageSize) || 25
  const totalPages = Math.max(1, Math.ceil(total / size))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = (safePage - 1) * size + 1
  const to = Math.min(total, safePage * size)
  return {
    pageRows: rows.slice((safePage - 1) * size, safePage * size),
    total,
    page: safePage,
    totalPages,
    from: total ? from : 0,
    to: total ? to : 0,
  }
}
