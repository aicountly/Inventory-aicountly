/**
 * Everything the serial workspace knows, in one place.
 *
 * The split the page is built on: SERVER state lives here (rows, counters,
 * lookups) and UI state lives in the components that own it (which drawer is
 * open, which rows are ticked). Filters sit in the URL, which is why a filtered
 * view is a link somebody can send.
 *
 * Two requests, not one: the table and the counters answer different questions
 * at different speeds, and a summary endpoint that is slow or forbidden must
 * never hold up the rows. They are given the SAME filters — `serialSummaryQuery`
 * strips only the paging — so the cards describe the table under them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCompany } from '../company/CompanyContext'
import { useFormOptions } from '../hooks/useFormOptions'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { isAbortError } from '../services/api'
import { batchesApi, locationsApi, serialsApi } from '../services/masters'
import type { Batch, Location, Serial, SerialSummary } from '../services/masters'
import { SERIAL_FILTER_KEYS, serialListQuery, serialSummaryQuery } from './serialFilters'

export interface SerialsWorkspace {
  list: ReturnType<typeof useListParams>
  rows: Serial[]
  meta: { total: number; limit: number; offset: number } | null
  loading: boolean
  error: Error | null
  reload: () => void
  fetchedAt: number | null

  summary: SerialSummary | null
  summaryLoading: boolean
  /** The counters failed but the table did not — the strip says so and the page carries on. */
  summaryFailed: boolean

  /** The reader's own permissions, as the server reported them with the rows. */
  costVisible: boolean
  currency: string

  options: ReturnType<typeof useFormOptions>['options']
  optionsError: string | null
  /** Locations of the warehouse currently filtered on; empty until one is picked. */
  locations: Location[]
  /** Batches of the item currently filtered on; empty until one is picked. */
  batches: Batch[]

  query: ReturnType<typeof serialListQuery>
  scopeKey: string | null
}

export function useSerialsWorkspace(enabled: boolean): SerialsWorkspace {
  const { scope } = useCompany()
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null
  const list = useListParams({ sort: 'updated_at', order: 'desc', filterKeys: SERIAL_FILTER_KEYS })
  const formOptions = useFormOptions()

  const query = useMemo(() => serialListQuery(list.query, list.state.filters), [list.query, list.state.filters])
  const summaryParams = useMemo(() => serialSummaryQuery(query), [query])

  const rowsQuery = useQuery(
    (signal) => serialsApi.list(query, signal),
    [scopeKey, query],
    { enabled: enabled && !!scope, resetKey: scopeKey },
  )

  const summaryQuery = useQuery(
    (signal) => serialsApi.summary(summaryParams, signal),
    [scopeKey, summaryParams],
    { enabled: enabled && !!scope, resetKey: scopeKey },
  )

  // ---- lookups for the filter selects ------------------------------------
  // Loaded on demand rather than up front: a company with 200 warehouses has
  // thousands of bins, and none of them are needed until a warehouse is chosen.
  const warehouseFilter = list.state.filters.warehouse_id ?? ''
  const itemFilter = list.state.filters.item_id ?? ''
  const [locations, setLocations] = useState<Location[]>([])
  const [batches, setBatches] = useState<Batch[]>([])

  useEffect(() => {
    const warehouseId = Number(warehouseFilter)
    if (!warehouseId) {
      setLocations([])
      return undefined
    }
    const controller = new AbortController()
    locationsApi
      .list({ warehouse_id: warehouseId, limit: 1000, sort: 'location_code', status: 'active' }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setLocations(res.data)
      })
      .catch((err: unknown) => {
        // A bin list that will not load must not take the page with it: the
        // filter simply stays a plain id box.
        if (!controller.signal.aborted && !isAbortError(err)) setLocations([])
      })
    return () => controller.abort()
  }, [warehouseFilter, scopeKey])

  useEffect(() => {
    const itemId = Number(itemFilter)
    if (!itemId) {
      setBatches([])
      return undefined
    }
    const controller = new AbortController()
    batchesApi
      .list({ item_id: itemId, limit: 500, sort: 'batch_no' }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setBatches(res.data)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) setBatches([])
      })
    return () => controller.abort()
  }, [itemFilter, scopeKey])

  const reload = useCallback(() => {
    rowsQuery.reload()
    summaryQuery.reload()
  }, [rowsQuery, summaryQuery])

  /*
   * Cost visibility is sticky across a reload.
   *
   * `keepData` leaves the previous page on screen while the next one loads, so
   * dropping the column to `false` for the duration of a request would make it
   * blink out and back on every page turn. It is re-read from each response and
   * reset by the scope change, which is the only event that can actually change
   * the answer.
   */
  const costVisibleRef = useRef(true)
  const currencyRef = useRef('INR')
  const lastScope = useRef(scopeKey)
  if (lastScope.current !== scopeKey) {
    lastScope.current = scopeKey
    costVisibleRef.current = true
    currencyRef.current = 'INR'
  }
  if (rowsQuery.data?.cost_visible !== undefined) costVisibleRef.current = rowsQuery.data.cost_visible
  if (rowsQuery.data?.currency) currencyRef.current = rowsQuery.data.currency
  if (summaryQuery.data?.currency) currencyRef.current = summaryQuery.data.currency

  return {
    list,
    rows: rowsQuery.data?.data ?? [],
    meta: rowsQuery.data?.meta ?? null,
    loading: rowsQuery.loading,
    error: rowsQuery.error,
    reload,
    fetchedAt: rowsQuery.fetchedAt,

    summary: summaryQuery.data,
    summaryLoading: summaryQuery.loading,
    summaryFailed: summaryQuery.error !== null,

    costVisible: costVisibleRef.current,
    currency: currencyRef.current,

    options: formOptions.options,
    optionsError: formOptions.error,
    locations,
    batches,

    query,
    scopeKey,
  }
}
