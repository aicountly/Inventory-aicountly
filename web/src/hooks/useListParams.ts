import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ListQuery, SortOrder } from '../services/api'

export interface ListParamDefaults {
  sort: string
  order?: SortOrder
  limit?: number
  /** Names of extra filter parameters kept in the URL (e.g. `brand_id`). */
  filterKeys?: readonly string[]
}

export interface ListParamsState {
  q: string
  page: number
  limit: number
  sort: string
  order: SortOrder
  filters: Record<string, string>
}

export interface ListParams {
  state: ListParamsState
  /** Ready to spread into `api.list()`. */
  query: ListQuery
  setQ: (q: string) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  /** Sort by `key`; clicking the active key flips the order. */
  toggleSort: (key: string) => void
  setFilter: (key: string, value: string) => void
  reset: () => void
}

const LIMITS = [25, 50, 100, 200]
export const PAGE_SIZE_OPTIONS = LIMITS

/**
 * List state (search, page, sort, filters) kept in the URL query string, so the
 * browser back button, refresh and shared links all restore the same view.
 */
export function useListParams(defaults: ListParamDefaults): ListParams {
  const [params, setParams] = useSearchParams()
  const defaultLimit = defaults.limit ?? 50
  const defaultOrder = defaults.order ?? 'asc'
  const filterKeys = defaults.filterKeys ?? []

  const state = useMemo<ListParamsState>(() => {
    const page = Number(params.get('page') ?? 1)
    const limit = Number(params.get('limit') ?? defaultLimit)
    const order = params.get('order') === 'desc' ? 'desc' : params.get('order') === 'asc' ? 'asc' : defaultOrder
    const filters: Record<string, string> = {}
    for (const key of filterKeys) {
      const v = params.get(key)
      if (v) filters[key] = v
    }
    return {
      q: params.get('q') ?? '',
      page: Number.isInteger(page) && page > 0 ? page : 1,
      limit: LIMITS.includes(limit) ? limit : defaultLimit,
      sort: params.get('sort') || defaults.sort,
      order,
      filters,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKeys is treated as static
  }, [params, defaultLimit, defaultOrder, defaults.sort])

  const update = useCallback(
    (patch: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '' || v === undefined) next.delete(k)
            else next.set(k, String(v))
          }
          if (resetPage) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setQ = useCallback((q: string) => update({ q }), [update])
  const setPage = useCallback((page: number) => update({ page: page > 1 ? page : null }, false), [update])
  const setLimit = useCallback((limit: number) => update({ limit: limit === defaultLimit ? null : limit }), [update, defaultLimit])
  const setFilter = useCallback((key: string, value: string) => update({ [key]: value }), [update])
  const toggleSort = useCallback(
    (key: string) => {
      const nextOrder: SortOrder = state.sort === key ? (state.order === 'asc' ? 'desc' : 'asc') : 'asc'
      update({ sort: key === defaults.sort && nextOrder === defaultOrder ? null : key, order: nextOrder === defaultOrder && key === defaults.sort ? null : nextOrder })
    },
    [state.sort, state.order, update, defaults.sort, defaultOrder],
  )
  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])

  const query = useMemo<ListQuery>(
    () => ({ q: state.q || undefined, page: state.page, limit: state.limit, sort: state.sort, order: state.order, ...state.filters }),
    [state],
  )

  return { state, query, setQ, setPage, setLimit, toggleSort, setFilter, reset }
}
