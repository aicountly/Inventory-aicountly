/**
 * Purchase orders a goods receipt can be raised against.
 *
 * Two live sources, neither of them a copy:
 *
 *  1. **Aicountly Purchases** — the product that owns purchase orders and their open balances.
 *     Read through the Inventory API's read-only relay (`v1/purchases/purchase-orders`), the same
 *     shape as the Manage relay. The relay is not deployed everywhere yet, so the call degrades
 *     to `available: false` rather than throwing (see `crossProduct.ts`). Nothing is cached and
 *     nothing is written into an Inventory table: a PO balance is only ever true in Purchases.
 *
 *  2. **Inventory's own deferred purchases** — a purchase Books invoiced with `defer_inward`
 *     leaves an open pending quantity here (`GET /v1/pending-quantities?kind=deferred_purchase`).
 *     That IS Inventory's data, it is live today, and it is what an inward challan with
 *     `stock_effect = settle_deferred` receives against. It is listed beside the purchase orders
 *     so the receiving clerk has one place to look.
 *
 * TODO(purchases-relay): implement `GET /v1/purchases/purchase-orders` in server-php as a
 * read-only proxy onto the Purchases API (mirror `ManageProxyController`), forwarding cmp_id /
 * fy_id / bo_id and the caller's identity. Until it exists this module returns
 * `{ available: false }` and the picker shows only deferred purchases.
 */

import { api } from './api'
import type { ItemResponse, ListResponse } from './api'
import { relayCall } from './crossProduct'
import type { RelayResult } from './crossProduct'
import { pendingApi } from './stockApi'
import type { PendingRow } from './stockApi'
import { toNumber } from '../utils/format'

/** Where a receivable order came from. Drives the badge in the picker. */
export type PurchaseOrderOrigin = 'purchases' | 'inventory_deferred'

export interface PurchaseOrderLine {
  /** Stable within the order. String because Purchases may key lines by uuid. */
  po_line_id: string
  item_id: number | null
  item_name: string
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  warehouse_id: number | null
  qty_ordered: number
  qty_received: number
  qty_open: number
  rate: number | null
  /** Inventory pending row this line settles, for `settle_deferred`. */
  pending_id?: number
}

export interface PurchaseOrderRow {
  po_id: string
  po_no: string
  po_date: string | null
  party_ref: number | null
  party_name: string | null
  status: string
  warehouse_id: number | null
  qty_open: number
  origin: PurchaseOrderOrigin
  /** Deferred purchases only: the Inventory document the receipt links to. */
  source_document_id?: number
  lines: PurchaseOrderLine[]
}

export interface PurchaseOrderQuery {
  /** Books ledger id of the supplier. */
  partyRef?: number | null
  q?: string
  warehouseId?: number | null
  limit?: number
}

function num(value: unknown, fallback = 0): number {
  return toNumber(value) ?? fallback
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * Normalise one order from the Purchases relay.
 *
 * Deliberately tolerant about field names: the relay contract is not frozen yet, and a picker
 * that renders "—" for a column Purchases happens to call something else is far better than one
 * that throws on the first unrecognised key.
 */
export function normalisePurchaseOrder(raw: Record<string, unknown>): PurchaseOrderRow | null {
  const id = str(raw.po_id ?? raw.purchase_order_id ?? raw.id ?? raw.document_id)
  if (!id) return null
  const rawLines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : []
  const lines = rawLines.map<PurchaseOrderLine>((l, i) => {
    const ordered = num(l.qty_ordered ?? l.qty)
    const received = num(l.qty_received ?? l.qty_settled)
    const open = l.qty_open !== undefined ? num(l.qty_open) : Math.max(0, ordered - received)
    return {
      po_line_id: str(l.po_line_id ?? l.line_id ?? l.id) ?? `${id}-${i + 1}`,
      item_id: toNumber(l.item_id),
      item_name: str(l.item_name ?? l.item_label) ?? 'Item',
      item_sku: str(l.item_sku),
      unit_id: toNumber(l.unit_id),
      unit_symbol: str(l.unit_symbol),
      warehouse_id: toNumber(l.warehouse_id),
      qty_ordered: ordered,
      qty_received: received,
      qty_open: open,
      rate: toNumber(l.rate ?? l.unit_rate ?? l.price),
    }
  })
  return {
    po_id: id,
    po_no: str(raw.po_no ?? raw.document_no ?? raw.order_no) ?? `#${id}`,
    po_date: str(raw.po_date ?? raw.document_date ?? raw.order_date),
    party_ref: toNumber(raw.party_ref ?? raw.acc_id ?? raw.supplier_ref),
    party_name: str(raw.party_name ?? raw.acc_name ?? raw.supplier_name),
    status: str(raw.status) ?? 'open',
    warehouse_id: toNumber(raw.warehouse_id),
    qty_open: raw.qty_open !== undefined ? num(raw.qty_open) : lines.reduce((t, l) => t + l.qty_open, 0),
    origin: 'purchases',
    lines,
  }
}

/** Group open deferred-purchase pending rows into one "order" per source document. */
export function deferredPurchaseOrders(rows: PendingRow[]): PurchaseOrderRow[] {
  const byDocument = new Map<number, PurchaseOrderRow>()
  for (const row of rows) {
    const existing = byDocument.get(row.document_id)
    const order: PurchaseOrderRow =
      existing ??
      {
        po_id: `deferred:${row.document_id}`,
        po_no: row.document_no ?? `Purchase #${row.document_id}`,
        po_date: row.document_date,
        party_ref: row.party_ref,
        party_name: null,
        status: row.status,
        warehouse_id: row.warehouse_id,
        qty_open: 0,
        origin: 'inventory_deferred',
        source_document_id: row.document_id,
        lines: [],
      }
    order.lines.push({
      po_line_id: `pending:${row.pending_id}`,
      item_id: row.item_id,
      item_name: row.item_name ?? `Item #${row.item_id}`,
      item_sku: null,
      unit_id: row.unit_id,
      unit_symbol: row.unit_symbol,
      warehouse_id: row.warehouse_id,
      qty_ordered: num(row.qty_original),
      qty_received: num(row.qty_settled),
      qty_open: num(row.qty_open),
      rate: null,
      pending_id: row.pending_id,
    })
    order.qty_open += num(row.qty_open)
    byDocument.set(row.document_id, order)
  }
  return [...byDocument.values()]
}

export const purchaseOrdersApi = {
  /** Open purchase orders from Aicountly Purchases, or why they could not be read. */
  async openOrders(query: PurchaseOrderQuery = {}, signal?: AbortSignal): Promise<RelayResult<PurchaseOrderRow[]>> {
    const result = await relayCall(
      () =>
        api.get<ItemResponse<unknown[]> | ListResponse<unknown>>('v1/purchases/purchase-orders', {
          query: {
            status: 'open',
            party_ref: query.partyRef ?? undefined,
            warehouse_id: query.warehouseId ?? undefined,
            q: query.q || undefined,
            limit: query.limit ?? 50,
            with_lines: 1,
          },
          signal,
        }),
      'Aicountly Purchases',
    )
    if (!result.available) return result
    const rows = Array.isArray(result.data?.data) ? (result.data.data as Record<string, unknown>[]) : []
    return { available: true, data: rows.map(normalisePurchaseOrder).filter((r): r is PurchaseOrderRow => r !== null) }
  },

  /** Purchases invoiced with deferred inward that still have stock to receive (Inventory's own). */
  async deferredPurchases(query: PurchaseOrderQuery = {}, signal?: AbortSignal): Promise<PurchaseOrderRow[]> {
    const res = await pendingApi.list(
      { kind: 'deferred_purchase', direction: 'in', party_ref: query.partyRef ?? undefined, limit: 500 },
      signal,
    )
    return deferredPurchaseOrders(res.data ?? [])
  },
}
