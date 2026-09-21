/**
 * The reads behind the Physical Stock Count workspace.
 *
 * Every one of them is an endpoint Inventory already serves — stock balances,
 * the item bulk lookup, valuation unit costs, serials, batches and the document
 * list. Nothing here was added to the backend for this screen, and nothing here
 * reaches past the API into another Aicountly product's database: company,
 * branch and financial year ride on the request scope that `services/api` sets
 * from the Manage-backed CompanyContext.
 *
 * The one rule this file exists to enforce is BATCHING. A count sheet is
 * hundreds to thousands of rows, and a naive screen would ask for the item, the
 * cost, the serials and the batch of each row one at a time. Items and costs go
 * out in bulk; serials and batches — which have no bulk endpoint — are fetched
 * only for the rows that actually track them, with a bounded number in flight
 * and a hard cap, and the caller is told when the cap was hit rather than shown
 * a silently incomplete sheet.
 */

import { isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { availabilityApi } from '../../services/stockApi'
import type { StockBalanceRow } from '../../services/stockApi'
import { valuationApi } from '../../services/valuationApi'
import { toNumber } from '../../utils/format'
import { newLine, round4 } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { unitOptionsFrom } from '../LineEditor'
import { EMPTY_SNAPSHOT } from './countModel'
import type { LineSnapshot } from './countModel'

/** One page of `/v1/stock-balances`. The server caps `limit` at 1000. */
const BALANCE_PAGE = 500
/** Above this the sheet stops loading and says so — the browser is not a warehouse. */
const MAX_LINES = 5000
/** `/v1/items/bulk-lookup` and `/v1/valuation/unit-costs` both take lists. */
const ITEM_CHUNK = 200
const COST_CHUNK = 500
/** Per-item reads (serials, batches) have no bulk endpoint; keep the pipe narrow. */
const DETAIL_CONCURRENCY = 6
const MAX_DETAIL_ITEMS = 250

export interface LoadCountSheetOptions {
  spec: DocumentTypeSpec
  warehouseId: number | null
  includeZeroBookQty: boolean
  loadBatchWise: boolean
  loadSerialWise: boolean
  /** False when the reader may not see cost — then no cost read is made at all. */
  withCost: boolean
  /** Names the warehouse on each line without a second lookup. */
  warehouseName: (id: number | null | undefined) => string
  signal?: AbortSignal
}

export interface LoadCountSheetResult {
  lines: LineDraft[]
  snapshots: Record<string, LineSnapshot>
  /** Non-fatal notes: a cap was hit, a secondary read failed. */
  notes: string[]
  /** Balance rows matching the filter, which may exceed what was loaded. */
  totalAvailable: number
}

/** Run `work` over `items` with at most `limit` promises in flight. */
async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      out[i] = await work(items[i])
    }
  })
  await Promise.all(runners)
  return out
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The identity of a count line: item + warehouse, and batch only when counting batch-wise. */
function groupKey(row: StockBalanceRow, batchWise: boolean): string {
  return `${row.item_id}|${row.warehouse_id ?? ''}|${batchWise ? (row.batch_id ?? '') : ''}`
}

/**
 * Collapse balance rows into count lines.
 *
 * `/v1/stock-balances` is one row per item, warehouse AND batch. Counting
 * batch-wise keeps that grain; counting item-wise must ADD the batches up,
 * because a clerk who counts 30 boxes on a shelf is counting the item, and a
 * sheet that listed three batch rows of 10 would ask them to count it thrice.
 */
export function collapseBalances(rows: readonly StockBalanceRow[], batchWise: boolean): StockBalanceRow[] {
  if (batchWise) return [...rows]
  const byKey = new Map<string, StockBalanceRow>()
  for (const row of rows) {
    const key = groupKey(row, false)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...row, batch_id: null, batch_no: null })
      continue
    }
    existing.on_hand_qty = round4((toNumber(existing.on_hand_qty) ?? 0) + (toNumber(row.on_hand_qty) ?? 0))
    existing.available_qty = round4((toNumber(existing.available_qty) ?? 0) + (toNumber(row.available_qty) ?? 0))
  }
  return [...byKey.values()]
}

function lineFromBalance(spec: DocumentTypeSpec, row: StockBalanceRow, batchWise: boolean): LineDraft {
  return newLine(spec, {
    key: `count-${groupKey(row, batchWise)}`,
    item_id: row.item_id,
    item_name: row.item_name ?? `Item #${row.item_id}`,
    item_sku: row.item_sku,
    track_batch: batchWise && row.batch_id !== null,
    warehouse_id: row.warehouse_id,
    batch_id: batchWise ? row.batch_id : null,
    batch_no: batchWise ? row.batch_no : null,
    book_qty: String(toNumber(row.on_hand_qty) ?? 0),
    physical_qty: '',
    origin: 'count',
  })
}

/**
 * Load the book-quantity snapshot the count is measured against.
 *
 * The figures are the server's, read once; nothing is computed client-side. The
 * document itself stores `book_qty` per line, so what is posted is the snapshot
 * the operator actually counted against, not a re-read taken at posting time.
 */
export async function loadCountSheet(options: LoadCountSheetOptions): Promise<LoadCountSheetResult> {
  const { spec, warehouseId, includeZeroBookQty, loadBatchWise, loadSerialWise, withCost, warehouseName, signal } = options
  const notes: string[] = []

  const rows: StockBalanceRow[] = []
  let total = 0
  for (let offset = 0; ; offset += BALANCE_PAGE) {
    const res = await availabilityApi.balances(
      {
        warehouse_id: warehouseId ?? undefined,
        nonzero: includeZeroBookQty ? undefined : true,
        limit: BALANCE_PAGE,
        offset,
      },
      signal,
    )
    rows.push(...res.data)
    total = res.meta.total ?? rows.length
    if (res.data.length < BALANCE_PAGE || rows.length >= total || rows.length >= MAX_LINES) break
  }

  const usable = rows.filter((r) => r.item_id)
  const collapsed = collapseBalances(usable, loadBatchWise)
  const capped = collapsed.slice(0, MAX_LINES)
  if (collapsed.length > capped.length) {
    notes.push(`Loaded the first ${MAX_LINES.toLocaleString()} of ${collapsed.length.toLocaleString()} lines. Narrow the warehouse to count the rest.`)
  }

  const lines = capped.map((row) => lineFromBalance(spec, row, loadBatchWise))
  const snapshots: Record<string, LineSnapshot> = {}
  capped.forEach((row, i) => {
    snapshots[lines[i].key] = {
      ...EMPTY_SNAPSHOT,
      onHandQty: toNumber(row.on_hand_qty),
      availableQty: toNumber(row.available_qty),
      warehouseName: row.warehouse_name ?? warehouseName(row.warehouse_id) ?? null,
    }
  })

  const itemIds = [...new Set(capped.map((r) => r.item_id))]

  // --- item master: tracking flags, units, sku. One call per 200 items. ---
  const items = new Map<number, ItemSearchRow>()
  try {
    const pages = await Promise.all(chunk(itemIds, ITEM_CHUNK).map((ids) => lookupApi.itemsByIds(ids, signal)))
    for (const page of pages) for (const item of page) items.set(item.item_id, item)
  } catch (err) {
    if (isAbortError(err)) throw err
    notes.push('Item details could not be loaded; units and tracking flags may be incomplete.')
  }

  for (const line of lines) {
    const item = line.item_id !== null ? items.get(line.item_id) : undefined
    if (!item) continue
    const units = unitOptionsFrom(item)
    const def = units.find((u) => u.is_default) ?? units[0]
    line.item_sku = line.item_sku ?? item.item_sku
    line.item_name = item.print_name || item.item_name || line.item_name
    line.track_batch = Number(item.track_batch) === 1
    line.track_serial = Number(item.track_serial) === 1
    line.units = units
    line.unit_id = def?.unit_id ?? item.unit_id ?? null
    const snapshot = snapshots[line.key]
    if (snapshot) snapshot.unitSymbol = def?.unit_symbol ?? item.unit_symbol ?? null
  }

  // --- unit cost: only when the reader may see it, and only in bulk. ---
  if (withCost && itemIds.length) {
    try {
      const pages = await Promise.all(
        chunk(itemIds, COST_CHUNK).map((ids) => valuationApi.unitCosts(ids, { warehouseId: warehouseId ?? undefined }, signal)),
      )
      const costs = new Map<number, number>()
      for (const page of pages) for (const row of page) costs.set(row.item_id, Number(row.unit_cost) || 0)
      for (const line of lines) {
        const snapshot = snapshots[line.key]
        if (snapshot && line.item_id !== null) snapshot.unitCost = costs.get(line.item_id) ?? null
      }
    } catch (err) {
      if (isAbortError(err)) throw err
      // A count is still a count without costs; the value columns simply stay blank.
      notes.push('Unit costs could not be loaded, so variance value is not shown.')
    }
  }

  // --- serials: per item, only for serial-tracked rows, bounded. ---
  if (loadSerialWise) {
    const serialLines = lines.filter((l) => l.track_serial && l.item_id !== null)
    const targets = serialLines.slice(0, MAX_DETAIL_ITEMS)
    if (serialLines.length > targets.length) {
      notes.push(`Serial counts were read for the first ${MAX_DETAIL_ITEMS} serial-tracked lines.`)
    }
    let failed = 0
    await mapLimit(targets, DETAIL_CONCURRENCY, async (line) => {
      try {
        const res = await lookupApi.serials(line.item_id as number, {
          status: 'in_stock',
          warehouseId: line.warehouse_id,
          batchId: line.batch_id,
          limit: 1,
          signal,
        })
        const snapshot = snapshots[line.key]
        if (snapshot) snapshot.bookSerialCount = res.meta.total ?? res.data.length
      } catch (err) {
        if (isAbortError(err)) throw err
        failed += 1
      }
    })
    if (failed) notes.push(`Serial numbers could not be validated for ${failed} line${failed === 1 ? '' : 's'}.`)
  }

  // --- batch expiry: only for batch-wise loads, bounded the same way. ---
  if (loadBatchWise) {
    const batchLines = lines.filter((l) => l.batch_id !== null && l.item_id !== null)
    const byItem = new Map<number, LineDraft[]>()
    for (const line of batchLines) byItem.set(line.item_id as number, [...(byItem.get(line.item_id as number) ?? []), line])
    const itemsToRead = [...byItem.keys()].slice(0, MAX_DETAIL_ITEMS)
    if (byItem.size > itemsToRead.length) {
      notes.push(`Batch details were read for the first ${MAX_DETAIL_ITEMS} batch-tracked items.`)
    }
    let failed = 0
    await mapLimit(itemsToRead, DETAIL_CONCURRENCY, async (itemId) => {
      try {
        const res = await lookupApi.batches(itemId, { status: 'active', signal })
        const expiry = new Map<number, BatchRow>()
        for (const b of res.data) expiry.set(b.batch_id, b)
        for (const line of byItem.get(itemId) ?? []) {
          const batch = line.batch_id !== null ? expiry.get(line.batch_id) : undefined
          const snapshot = snapshots[line.key]
          if (snapshot && batch) snapshot.batchExpiry = batch.expiry_date ?? null
        }
      } catch (err) {
        if (isAbortError(err)) throw err
        failed += 1
      }
    })
    if (failed) notes.push(`Batch information could not be loaded for ${failed} item${failed === 1 ? '' : 's'}.`)
  }

  return { lines, snapshots, notes, totalAvailable: total }
}

// ---------------------------------------------------------------------------
// Variance history
// ---------------------------------------------------------------------------

export interface VarianceHistoryPoint {
  documentId: number
  documentNo: string | null
  documentDate: string
  /** Σ valuation_amount of the posted adjustment lines — what the count cost. */
  varianceValue: number
  lineCount: number
}

/**
 * The last few posted physical counts, for the trend card.
 *
 * Read from the document register the register screen already reads, scoped to
 * the selected company / branch / FY by the same request scope. There is no
 * separate history endpoint and none was invented: when nothing comes back the
 * card renders its empty state rather than a drawn line with no measurements
 * behind it.
 */
export async function loadVarianceHistory(limit = 5, signal?: AbortSignal): Promise<VarianceHistoryPoint[]> {
  const res = await documentsApi.list(
    {
      document_type: 'PHYSICAL_ADJUSTMENT',
      status: 'POSTED,COMPLETED',
      limit,
      sort: 'document_date',
      order: 'desc',
      all_fy: true,
    },
    signal,
  )
  return res.data
    .map((row) => ({
      documentId: row.document_id,
      documentNo: row.document_no,
      documentDate: row.document_date?.slice(0, 10) ?? '',
      varianceValue: Number(row.valuation_total) || 0,
      lineCount: Number(row.line_count) || 0,
    }))
    .reverse()
}
