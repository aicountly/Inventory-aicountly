import type { ListResponse } from './api'

export interface FetchAllOptions {
  /** Page size to request; every list endpoint accepts at least 500. */
  limit?: number
  /** Stop after this many rows so an export cannot run away. */
  maxRows?: number
}

export interface FetchAllResult<T> {
  rows: T[]
  total: number
  truncated: boolean
}

/** Walk every page of a list endpoint (for CSV export). */
export async function fetchAllRows<T>(fetchPage: (page: number, limit: number) => Promise<ListResponse<T>>, options: FetchAllOptions = {}): Promise<FetchAllResult<T>> {
  const limit = options.limit ?? 500
  const maxRows = options.maxRows ?? 10_000
  const rows: T[] = []
  let total = 0
  for (let page = 1; page <= 1000; page += 1) {
    const res = await fetchPage(page, limit)
    rows.push(...res.data)
    total = res.meta.total
    if (res.data.length === 0 || res.data.length < limit || rows.length >= total) break
    if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), total, truncated: true }
  }
  return { rows, total, truncated: false }
}
