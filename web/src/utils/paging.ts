import type { ListMeta } from '../services/api'

/**
 * Client-side page of an in-memory list, in the same {data, meta} shape the API
 * uses so the shared Pagination component works for endpoints that return
 * every row at once (period locks, profiles, members, document types).
 */
export function pageSlice<T>(rows: readonly T[], page: number, limit: number): { data: T[]; meta: ListMeta } {
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
  const pages = Math.max(1, Math.ceil(rows.length / l))
  const p = Number.isFinite(page) && page > 0 ? Math.min(Math.floor(page), pages) : 1
  const offset = (p - 1) * l
  return { data: rows.slice(offset, offset + l), meta: { total: rows.length, limit: l, offset } }
}
