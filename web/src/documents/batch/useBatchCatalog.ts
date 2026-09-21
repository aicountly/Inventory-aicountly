import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow } from '../../services/lookupApi'
import { batchCatalogKey } from './batchAdjustmentModel'

export interface BatchCatalogRequest {
  itemId: number
  warehouseId: number | null
}

export type BatchIndex = ReadonlyMap<string, readonly BatchRow[]>

export interface BatchCatalog {
  /** `batchCatalogKey(item, warehouse)` → the batches that key has loaded. Absent = not loaded. */
  index: BatchIndex
  rows(itemId: number | null, warehouseId: number | null): readonly BatchRow[] | undefined
  loading(itemId: number | null, warehouseId: number | null): boolean
  /**
   * Re-read every key already loaded and resolve with the new index, so the caller can re-run its
   * rules against what the server says NOW rather than against the closure it started with.
   */
  refresh: () => Promise<BatchIndex>
  refreshing: boolean
  /** Register a batch from a row and fold it into the cache. */
  create(request: BatchCatalogRequest, body: { batch_no: string; expiry_date?: string | null }): Promise<BatchRow>
}

function parseKey(key: string): { itemId: number; warehouseId: number | null } {
  const [itemPart, warehousePart] = key.split(':')
  return { itemId: Number(itemPart), warehouseId: Number(warehousePart) || null }
}

/**
 * `GET /v1/batches?item_id&warehouse_id&with_stock=1` for every item/warehouse pair the lines
 * name, loaded once and shared.
 *
 * The two batch selects on a row, the availability warning, the expiry check and the blocked-batch
 * check all want the same list; a picker that fetched its own would ask for the same rows once per
 * row and still leave the validator with nothing to check against.
 */
export function useBatchCatalog(requests: readonly BatchCatalogRequest[]): BatchCatalog {
  const signature = useMemo(() => {
    const keys = new Set(requests.filter((r) => r.itemId > 0).map((r) => batchCatalogKey(r.itemId, r.warehouseId)))
    return [...keys].sort().join(',')
  }, [requests])

  const [index, setIndex] = useState<Map<string, readonly BatchRow[]>>(() => new Map())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(new Set<string>())
  const loaded = useRef(new Set<string>())
  const indexRef = useRef<Map<string, readonly BatchRow[]>>(index)
  indexRef.current = index

  useEffect(() => {
    const wanted = signature ? signature.split(',') : []
    const missing = wanted.filter((key) => !loaded.current.has(key) && !inFlight.current.has(key))
    if (missing.length === 0) return undefined

    const controller = new AbortController()
    for (const key of missing) inFlight.current.add(key)
    setPending(new Set(inFlight.current))

    void Promise.all(
      missing.map(async (key) => {
        const { itemId, warehouseId } = parseKey(key)
        try {
          const res = await lookupApi.batches(itemId, { warehouseId, signal: controller.signal })
          return [key, res.data] as const
        } catch (err) {
          if (isAbortError(err)) return null
          // A lookup that fails leaves the key unloaded: the selects stay usable and the rules
          // that need batch stock are skipped rather than run against an empty list.
          return [key, null] as const
        }
      }),
    ).then((results) => {
      if (controller.signal.aborted) return
      const settled = results.filter((r): r is readonly [string, BatchRow[] | null] => r !== null)
      for (const [key] of settled) inFlight.current.delete(key)
      setPending(new Set(inFlight.current))
      const withRows = settled.filter((r): r is readonly [string, BatchRow[]] => r[1] !== null)
      if (withRows.length === 0) return
      for (const [key] of withRows) loaded.current.add(key)
      setIndex((current) => {
        const next = new Map(current)
        for (const [key, batches] of withRows) next.set(key, batches)
        return next
      })
    })

    return () => {
      controller.abort()
      for (const key of missing) inFlight.current.delete(key)
    }
  }, [signature])

  const refresh = useCallback(async (): Promise<BatchIndex> => {
    const keys = [...loaded.current]
    if (keys.length === 0) return indexRef.current
    setRefreshing(true)
    try {
      const results = await Promise.all(
        keys.map(async (key) => {
          const { itemId, warehouseId } = parseKey(key)
          try {
            const res = await lookupApi.batches(itemId, { warehouseId })
            return [key, res.data] as const
          } catch {
            return null
          }
        }),
      )
      const next = new Map(indexRef.current)
      for (const entry of results) {
        if (entry) next.set(entry[0], entry[1])
      }
      indexRef.current = next
      setIndex(next)
      return next
    } finally {
      setRefreshing(false)
    }
  }, [])

  const create = useCallback(async (request: BatchCatalogRequest, body: { batch_no: string; expiry_date?: string | null }) => {
    const created = await lookupApi.createBatch({ item_id: request.itemId, batch_no: body.batch_no, expiry_date: body.expiry_date ?? null })
    const key = batchCatalogKey(request.itemId, request.warehouseId)
    setIndex((current) => {
      const next = new Map(current)
      const rows = next.get(key) ?? []
      if (!rows.some((b) => b.batch_id === created.batch_id)) next.set(key, [...rows, created])
      return next
    })
    loaded.current.add(key)
    return created
  }, [])

  const rows = useCallback((itemId: number | null, warehouseId: number | null) => (itemId ? index.get(batchCatalogKey(itemId, warehouseId)) : undefined), [index])
  const loading = useCallback((itemId: number | null, warehouseId: number | null) => (itemId ? pending.has(batchCatalogKey(itemId, warehouseId)) : false), [pending])

  return { index, rows, loading, refresh, refreshing, create }
}
