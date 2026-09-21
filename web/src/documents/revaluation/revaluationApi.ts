/**
 * The reads the Stock Revaluation screen needs, composed from endpoints that already exist.
 *
 * Nothing here is a new API surface: it batches and reshapes
 *   GET /v1/valuation/unit-costs   (ValuationController::unitCosts)   — the cost being replaced
 *   GET /v1/availability           (AvailabilityController::index)    — the quantity it is replaced over
 *   GET /v1/stock-movements        (StockMovementsController::index)  — the last purchase rate
 *   GET /v1/items/by-barcode/{c}   (ItemsController::byBarcode)       — scan / import resolution
 *
 * The screen writes through `documentsApi` exactly as every other document editor does.
 */

import { isAbortError } from '../../services/api'
import { availabilityApi } from '../../services/stockApi'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { stockMovementsApi } from '../../services/stockViewsApi'
import { valuationApi } from '../../services/valuationApi'
import type { ReportMethod } from '../../services/valuationApi'
import { round4 } from '../formModel'
import { contextKey } from './revaluationModel'
import type { StockContext } from './revaluationModel'

/** One (item, valuation scope) pair to read. `warehouseId` null means company-wide. */
export interface StockContextRequest {
  itemId: number
  warehouseId: number | null
}

export interface StockContextResult {
  contexts: Record<string, StockContext>
  /** Set when the cost read failed for every scope — usually a missing reports.valuation.read. */
  costError: string | null
}

const now = () => Date.now()

/**
 * On-hand quantity and current unit cost for every requested (item, scope), in two calls per
 * distinct scope rather than two per line.
 *
 * A failure on one half does not discard the other: a user without `reports.valuation.read` still
 * sees what is on hand, and the line simply says the cost is unavailable instead of showing a
 * fabricated zero.
 */
export async function loadStockContexts(
  requests: readonly StockContextRequest[],
  options: { asOf?: string; signal?: AbortSignal } = {},
): Promise<StockContextResult> {
  const byScope = new Map<string, { warehouseId: number | null; itemIds: number[] }>()
  for (const req of requests) {
    if (!req.itemId) continue
    const key = req.warehouseId === null ? 'all' : String(req.warehouseId)
    const bucket = byScope.get(key) ?? { warehouseId: req.warehouseId, itemIds: [] }
    if (!bucket.itemIds.includes(req.itemId)) bucket.itemIds.push(req.itemId)
    byScope.set(key, bucket)
  }

  const contexts: Record<string, StockContext> = {}
  const costErrors: string[] = []
  let costAttempts = 0

  await Promise.all(
    [...byScope.values()].map(async ({ warehouseId, itemIds }) => {
      const stamp = now()
      const [quantities, costs] = await Promise.all([
        availabilityApi
          .forItems(itemIds, warehouseId, false, options.signal)
          .then((rows) => {
            // With no warehouse filter the endpoint answers one row per warehouse, so the
            // company-wide quantity is their sum, not the first row.
            const totals = new Map<number, number>()
            for (const row of rows) totals.set(row.item_id, round4((totals.get(row.item_id) ?? 0) + Number(row.on_hand ?? 0)))
            return { ok: true as const, totals }
          })
          .catch((err: unknown) => (isAbortError(err) ? { ok: false as const, message: null } : { ok: false as const, message: messageOf(err, 'Stock could not be read.') })),
        (() => {
          costAttempts += 1
          return valuationApi
            .unitCosts(itemIds, { warehouseId, asOf: options.asOf }, options.signal)
            .then((rows) => ({ ok: true as const, rows }))
            .catch((err: unknown) => (isAbortError(err) ? { ok: false as const, message: null } : { ok: false as const, message: messageOf(err, 'The current cost could not be read.') }))
        })(),
      ])

      if (!costs.ok && costs.message) costErrors.push(costs.message)
      const costByItem = new Map<number, { unit_cost: number; method: string | null }>()
      if (costs.ok) for (const row of costs.rows) costByItem.set(row.item_id, { unit_cost: Number(row.unit_cost ?? 0), method: row.valuation_method_applied })

      for (const itemId of itemIds) {
        const cost = costByItem.get(itemId)
        const errors = [quantities.ok ? null : quantities.message, costs.ok ? null : costs.message].filter(Boolean) as string[]
        contexts[contextKey(itemId, warehouseId)] = {
          itemId,
          warehouseId,
          // A quantity of zero is an answer; an unreadable quantity is not.
          onHandQty: quantities.ok ? (quantities.totals.get(itemId) ?? 0) : null,
          currentUnitCost: cost ? cost.unit_cost : null,
          method: cost?.method ?? null,
          loading: false,
          error: errors.length ? errors.join(' ') : null,
          fetchedAt: quantities.ok || costs.ok ? stamp : null,
        }
      }
    }),
  )

  return { contexts, costError: costAttempts > 0 && costErrors.length === costAttempts ? costErrors[0] : null }
}

// ---------------------------------------------------------------------------------------------
// Rate sources (Copy rates / templates)
// ---------------------------------------------------------------------------------------------

export type RateSourceId = 'current' | 'fifo' | 'lifo' | 'wac' | 'last_purchase'

export interface RateSource {
  id: RateSourceId
  label: string
  description: string
}

/**
 * Where a new cost can honestly be copied from. Every one of these is a figure the API already
 * serves — there is no "standard cost" master in Inventory, so none is offered.
 */
export const RATE_SOURCES: readonly RateSource[] = [
  { id: 'current', label: 'Current cost', description: 'The cost on hand now, under each item’s own valuation method. Copies a rate that changes nothing — useful as a starting point to edit.' },
  { id: 'fifo', label: 'FIFO cost', description: 'What the stock on hand would cost valued first-in, first-out.' },
  { id: 'lifo', label: 'LIFO cost', description: 'What the stock on hand would cost valued last-in, first-out.' },
  { id: 'wac', label: 'Weighted average cost', description: 'The running weighted average of the stock on hand.' },
  { id: 'last_purchase', label: 'Last purchase rate', description: 'The unit cost of the most recent posted purchase receipt. Items never purchased are left alone.' },
]

const METHOD_BY_SOURCE: Partial<Record<RateSourceId, ReportMethod>> = {
  current: 'AS_PER_MASTER',
  fifo: 'FIFO',
  lifo: 'LIFO',
  wac: 'WAC',
}

export interface RateLookup {
  /** itemId → rate, for the items the source could answer for. */
  rates: Map<number, number>
  /** Items the source had nothing for. */
  missing: number[]
}

/** Rates from one source for one valuation scope. */
export async function ratesFromSource(
  source: RateSourceId,
  requests: readonly StockContextRequest[],
  options: { asOf?: string; signal?: AbortSignal } = {},
): Promise<RateLookup> {
  const rates = new Map<number, number>()
  const method = METHOD_BY_SOURCE[source]

  if (method) {
    const byScope = new Map<string, { warehouseId: number | null; itemIds: number[] }>()
    for (const req of requests) {
      const key = req.warehouseId === null ? 'all' : String(req.warehouseId)
      const bucket = byScope.get(key) ?? { warehouseId: req.warehouseId, itemIds: [] }
      if (!bucket.itemIds.includes(req.itemId)) bucket.itemIds.push(req.itemId)
      byScope.set(key, bucket)
    }
    await Promise.all(
      [...byScope.values()].map(async ({ warehouseId, itemIds }) => {
        const rows = await valuationApi.unitCosts(itemIds, { warehouseId, asOf: options.asOf, method }, options.signal)
        for (const row of rows) {
          const value = Number(row.unit_cost ?? 0)
          if (value > 0) rates.set(row.item_id, round4(value))
        }
      }),
    )
  } else {
    const itemIds = [...new Set(requests.map((r) => r.itemId))]
    const found = await mapWithConcurrency(itemIds, 4, async (itemId) => ({ itemId, rate: await lastPurchaseRate(itemId, options.signal) }))
    for (const { itemId, rate } of found) if (rate !== null && rate > 0) rates.set(itemId, rate)
  }

  const missing = [...new Set(requests.map((r) => r.itemId))].filter((id) => !rates.has(id))
  return { rates, missing }
}

export interface LastPurchase {
  rate: number
  date: string | null
  documentNo: string | null
}

/**
 * The newest posted purchase receipt of an item, across financial years.
 *
 * One request per item — there is no endpoint that answers for a set — so callers run it through
 * the bounded pool above rather than firing a request per line at once.
 */
export async function lastPurchase(itemId: number, signal?: AbortSignal): Promise<LastPurchase | null> {
  const res = await stockMovementsApi.list(
    { item_id: itemId, direction: 'in', document_type: 'PURCHASE_RECEIPT', movement_kind: 'physical', sort: 'movement_date', order: 'desc', limit: 1, all_fy: 1 },
    signal,
  )
  const row = res.data[0]
  if (!row || row.unit_cost === null || row.unit_cost === undefined) return null
  const rate = round4(Number(row.unit_cost))
  return rate > 0 ? { rate, date: row.movement_date ?? null, documentNo: row.document_no ?? null } : null
}

export async function lastPurchaseRate(itemId: number, signal?: AbortSignal): Promise<number | null> {
  return (await lastPurchase(itemId, signal))?.rate ?? null
}

/** When an item last moved in any direction — what "slow moving" is measured from. */
export async function lastMovementAt(itemId: number, signal?: AbortSignal): Promise<string | null> {
  const res = await stockMovementsApi.list({ item_id: itemId, movement_kind: 'physical', sort: 'movement_date', order: 'desc', limit: 1, all_fy: 1 }, signal)
  return res.data[0]?.movement_date ?? null
}

// ---------------------------------------------------------------------------------------------
// Item resolution (scan, paste, import)
// ---------------------------------------------------------------------------------------------

export interface ResolvedCode {
  code: string
  item: ItemSearchRow | null
  reason: string | null
}

/**
 * Resolve a barcode / SKU to an item, exactly as the scanner endpoint does (it matches
 * `item_upc` or `item_sku`), falling back to the typeahead for a single unambiguous name match.
 *
 * `itemByBarcode` answers null for "not one of ours" and throws for anything else, which is the
 * distinction this needs: a code that does not exist is a row to report, and a network failure is
 * not — reporting 200 rows as "no such item" because the request never landed would be a lie.
 */
export async function resolveItemCode(code: string, warehouseId: number | null, signal?: AbortSignal): Promise<ResolvedCode> {
  const trimmed = code.trim()
  if (!trimmed) return { code, item: null, reason: 'Empty code.' }
  const scanned = await lookupApi.itemByBarcode(trimmed, { warehouseId, signal })
  if (scanned) return { code: trimmed, item: scanned, reason: null }
  // Not a barcode or a SKU — try the name typeahead, but only accept it when it is unambiguous.
  const rows = await lookupApi.searchItems(trimmed, { warehouseId, limit: 5, signal })
  const exact = rows.filter((r) => [r.item_name, r.print_name, r.item_alias, r.item_sku, r.item_upc].some((v) => typeof v === 'string' && v.trim().toLowerCase() === trimmed.toLowerCase()))
  if (exact.length === 1) return { code: trimmed, item: exact[0], reason: null }
  if (rows.length === 1) return { code: trimmed, item: rows[0], reason: null }
  if (rows.length > 1) return { code: trimmed, item: null, reason: 'Matches more than one item.' }
  return { code: trimmed, item: null, reason: 'No item with that SKU or barcode.' }
}

/** Resolve many codes without opening one connection per row. */
export function resolveItemCodes(codes: readonly string[], warehouseId: number | null, signal?: AbortSignal): Promise<ResolvedCode[]> {
  return mapWithConcurrency(codes, 4, (code) => resolveItemCode(code, warehouseId, signal))
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Run `worker` over `items`, at most `limit` in flight, preserving input order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return out
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
