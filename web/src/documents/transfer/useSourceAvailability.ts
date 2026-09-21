import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import type { HeaderDraft, LineDraft } from '../formModel'
import { addBuckets, availabilityRequests, stockKey } from './transferModel'
import type { AvailabilityBuckets } from './transferModel'

export interface SourceAvailabilityState {
  /** (item, warehouse, batch) → buckets. Batch 0 is the item across every batch. */
  index: ReadonlyMap<string, AvailabilityBuckets>
  /** Warehouses whose answer is still in flight. */
  pending: ReadonlySet<number>
  error: string | null
  reload: () => void
}

const EMPTY_INDEX: ReadonlyMap<string, AvailabilityBuckets> = new Map()
const EMPTY_PENDING: ReadonlySet<number> = new Set<number>()

/**
 * Live stock at the SOURCE warehouse of every line, from `GET /v1/availability`.
 *
 * One request per distinct source warehouse rather than one per row, asked with
 * `by_batch=1` so the same answer serves both a plain line and a line that has
 * picked a batch. It re-runs when the items, the warehouses or the batches
 * change — never when a quantity does, because the balance does not depend on
 * what is being asked for, and a per-keystroke refetch is what makes an entry
 * screen feel slow.
 */
export function useSourceAvailability(lines: LineDraft[], header: Pick<HeaderDraft, 'from_warehouse_id'>, enabled = true): SourceAvailabilityState {
  const requests = useMemo(() => availabilityRequests(lines, header), [lines, header])
  const signature = useMemo(() => JSON.stringify(requests), [requests])
  const debounced = useDebounce(signature, 250)
  const [index, setIndex] = useState<ReadonlyMap<string, AvailabilityBuckets>>(EMPTY_INDEX)
  const [pending, setPending] = useState<ReadonlySet<number>>(EMPTY_PENDING)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const live = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setIndex(EMPTY_INDEX)
      setPending(EMPTY_PENDING)
      return undefined
    }
    const parsed = JSON.parse(debounced) as { warehouseId: number; itemIds: number[] }[]
    if (parsed.length === 0) {
      setIndex(EMPTY_INDEX)
      setPending(EMPTY_PENDING)
      setError(null)
      return undefined
    }
    const run = ++live.current
    const controller = new AbortController()
    setPending(new Set(parsed.map((r) => r.warehouseId)))
    setError(null)
    Promise.all(
      parsed.map((req) =>
        availabilityApi
          .forItems(req.itemIds, req.warehouseId, true, controller.signal)
          .then((rows) => ({ req, rows })),
      ),
    )
      .then((results) => {
        if (controller.signal.aborted || run !== live.current) return
        const next = new Map<string, AvailabilityBuckets>()
        for (const { req, rows } of results) {
          for (const row of rows) {
            const buckets: AvailabilityBuckets = {
              on_hand: Number(row.on_hand) || 0,
              reserved: Number(row.reserved) || 0,
              committed: Number(row.committed) || 0,
              available: Number(row.available) || 0,
              in_transit: Number(row.in_transit) || 0,
              expected: Number(row.expected) || 0,
            }
            const warehouseId = row.warehouse_id ?? req.warehouseId
            const batchId = row.batch_id ?? null
            if (batchId) next.set(stockKey(row.item_id, warehouseId, batchId), buckets)
            // The batch-0 cell is the item across every batch, which is what a
            // line that has not picked one draws on.
            const allKey = stockKey(row.item_id, warehouseId, null)
            next.set(allKey, addBuckets(next.get(allKey), buckets))
          }
          // An item with no balance row at all still needs a cell, or the row
          // reads "loading" for ever instead of "nothing here".
          for (const itemId of req.itemIds) {
            const allKey = stockKey(itemId, req.warehouseId, null)
            if (!next.has(allKey)) next.set(allKey, { on_hand: 0, reserved: 0, committed: 0, available: 0, in_transit: 0, expected: 0 })
          }
        }
        setIndex(next)
        setPending(EMPTY_PENDING)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err) || run !== live.current) return
        setIndex(EMPTY_INDEX)
        setPending(EMPTY_PENDING)
        setError(errorMessage(err, 'Live stock could not be read just now.'))
      })
    return () => controller.abort()
  }, [debounced, enabled, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  // While the signature is still settling (the debounce, or the very first
  // render) every warehouse in the draft counts as pending. Without this the
  // rows spend the first fraction of a second reading "short by 10" against an
  // index that has not been fetched yet, which is a lie told in red.
  const settling = signature !== debounced
  const effectivePending = useMemo(
    () => (settling ? new Set(requests.map((r) => r.warehouseId)) : pending),
    [settling, requests, pending],
  )

  return { index, pending: effectivePending, error, reload }
}
