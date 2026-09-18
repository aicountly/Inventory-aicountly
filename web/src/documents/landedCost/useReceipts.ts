/**
 * Reading the receipts a landed cost can be loaded onto, and the lines of the ones chosen.
 *
 * Two queries, deliberately separate. The PICKER needs a page of candidates and nothing about their
 * lines; the ALLOCATION needs every valued inward line of the handful actually selected. Fetching
 * lines for the whole candidate list to fill a table the user will mostly ignore is the kind of
 * eager read that makes a document screen feel slow on a company with ten thousand receipts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage, isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { DocumentListRow, InventoryDocument } from '../types'
import { allocationLinesFrom } from './model'
import type { AllocationLine } from './model'

/**
 * Receipts a cost can be loaded onto: inward types whose lines are valued when they post.
 * Mirrors DocumentPostingService::valuesLinesNow — the server refuses anything else.
 */
export const TARGET_TYPES = 'PURCHASE_RECEIPT,MATERIAL_RECEIPT,OPENING_STOCK,WRITE_IN,SALES_RETURN'
export const TARGET_STATUSES = 'POSTED,PARTIALLY_FULFILLED,COMPLETED'

export interface ReceiptSearch {
  /** Free text over document no / party, as the documents list understands it. */
  q?: string
  from?: string
  to?: string
  party_ref?: number | null
  limit?: number
}

/** The candidate list behind the picker. */
export function useEligibleReceipts(search: ReceiptSearch, enabled = true) {
  const { q, from, to, party_ref: partyRef, limit = 25 } = search
  return useQuery(
    (signal) =>
      documentsApi.list(
        {
          document_type: TARGET_TYPES,
          status: TARGET_STATUSES,
          limit,
          sort: 'document_date',
          order: 'desc',
          ...(q && q.trim() ? { q: q.trim() } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(partyRef ? { party_ref: partyRef } : {}),
        },
        signal,
      ),
    [q, from, to, partyRef, limit],
    { enabled },
  )
}

export interface LoadedReceipt {
  document_id: number
  document: InventoryDocument
  lines: AllocationLine[]
  /** The version this screen allocated against. Compared again before posting. */
  loadedVersion: number
  loadedStatus: string
}

export interface SelectedReceiptsState {
  receipts: LoadedReceipt[]
  lines: AllocationLine[]
  loading: boolean
  /** Receipt id → why it could not be read. The row says so instead of vanishing. */
  failures: Record<number, string>
  reload: () => void
  /**
   * Re-read every selected receipt and report which ones moved since they were loaded.
   * Run immediately before posting — see the stale-record check in readiness.ts.
   */
  checkForChanges: () => Promise<number[]>
}

/**
 * The full detail of the selected receipts, fetched in parallel and cached by id.
 *
 * Cached because selection is a checkbox: ticking a fourth receipt must not re-read the three
 * already on screen, and un-ticking then re-ticking one must not either. The cache is keyed by
 * document id and cleared by `reload`.
 */
export function useSelectedReceipts(ids: number[], warehouseName: (id: number | null | undefined) => string): SelectedReceiptsState {
  const key = ids.join(',')
  const [cache, setCache] = useState<Record<number, InventoryDocument>>({})
  const [failures, setFailures] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  // Read in the effect but never a reason to re-run it: the effect's job is to fetch what is
  // missing, and what is missing is recomputed from the ref each time it runs.
  const cacheRef = useRef(cache)
  cacheRef.current = cache

  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)
    const missing = wanted.filter((id) => cacheRef.current[id] === undefined)
    if (missing.length === 0) {
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    Promise.all(
      missing.map(async (id) => {
        try {
          return { id, doc: await documentsApi.get(id, controller.signal), error: null as string | null }
        } catch (err) {
          if (isAbortError(err)) throw err
          return { id, doc: null, error: errorMessage(err) }
        }
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return
        const docs: Record<number, InventoryDocument> = {}
        const errs: Record<number, string> = {}
        for (const r of results) {
          if (r.doc) docs[r.id] = r.doc
          else if (r.error) errs[r.id] = r.error
        }
        setCache((prev) => ({ ...prev, ...docs }))
        setFailures((prev) => ({ ...prev, ...errs }))
        setLoading(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [key, nonce])

  const reload = useCallback(() => {
    setCache({})
    setFailures({})
    setNonce((n) => n + 1)
  }, [])

  const receipts = useMemo<LoadedReceipt[]>(() => {
    const wanted = key === '' ? [] : key.split(',').map(Number)
    const out: LoadedReceipt[] = []
    for (const id of wanted) {
      const doc = cache[id]
      if (!doc) continue
      out.push({
        document_id: id,
        document: doc,
        lines: allocationLinesFrom(doc, warehouseName),
        loadedVersion: Number(doc.version ?? 0),
        loadedStatus: String(doc.status),
      })
    }
    return out
  }, [key, cache, warehouseName])

  const lines = useMemo(() => receipts.flatMap((r) => r.lines), [receipts])

  const checkForChanges = useCallback(async (): Promise<number[]> => {
    const loaded = Object.values(cacheRef.current)
    const wanted = key === '' ? [] : key.split(',').map(Number)
    const changed: number[] = []
    await Promise.all(
      wanted.map(async (id) => {
        const before = loaded.find((d) => d.document_id === id)
        if (!before) return
        try {
          const now = await documentsApi.get(id)
          if (Number(now.version ?? 0) !== Number(before.version ?? 0) || String(now.status) !== String(before.status)) {
            changed.push(id)
          }
        } catch {
          // A receipt that cannot be re-read is treated as changed: posting against figures that
          // could not be confirmed is exactly what this check exists to stop.
          changed.push(id)
        }
      }),
    )
    return changed
  }, [key])

  return { receipts, lines, loading, failures, reload, checkForChanges }
}

/** The picker's rows, with the ones already chosen marked. */
export function mergeSelection(rows: DocumentListRow[], selectedIds: number[]): { row: DocumentListRow; selected: boolean }[] {
  return rows.map((row) => ({ row, selected: selectedIds.includes(row.document_id) }))
}
