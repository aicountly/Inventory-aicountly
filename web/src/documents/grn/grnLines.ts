/**
 * Building a receipt line from whatever the clerk had to hand: a typeahead pick, a scanned
 * barcode, a pasted SKU, a purchase-order line or an AI extraction.
 *
 * All five paths land here so a line built by a scanner is identical to one typed by hand —
 * same unit default, same warehouse fallback, same batch / serial flags. Pure, so the barcode
 * dialog and the bulk drawer can be tested without rendering either.
 */

import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import type { DocumentTypeSpec } from '../registry'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { PurchaseOrderLine, PurchaseOrderRow } from '../../services/purchaseOrdersApi'
import { lineAmount } from '../formModel'
import { toNumber } from '../../utils/format'

export interface LineDefaults {
  /** The document's default warehouse; the line falls back to it. */
  warehouseId: number | null
  qty?: string
  rate?: string
}

/** The fields an item choice sets on a line, leaving the rest of the row alone. */
export function itemPatch(row: ItemSearchRow, defaults: LineDefaults, current?: LineDraft): Partial<LineDraft> {
  const units = unitOptionsFrom(row)
  const preferred = units.find((u) => u.is_default) ?? units[0]
  return {
    item_id: row.item_id,
    item_name: row.print_name || row.item_name,
    item_sku: row.item_sku,
    track_batch: Number(row.track_batch) === 1,
    track_serial: Number(row.track_serial) === 1,
    units,
    unit_id: preferred?.unit_id ?? row.unit_id ?? null,
    warehouse_id: current?.warehouse_id ?? row.default_warehouse_id ?? defaults.warehouseId ?? null,
    batch_id: null,
    batch_no: null,
    expiry_date: null,
    serials: [],
  }
}

export function lineFromItem(spec: DocumentTypeSpec, row: ItemSearchRow, defaults: LineDefaults): LineDraft {
  const qty = defaults.qty ?? '1'
  const rate = defaults.rate ?? ''
  return newLine(spec, {
    ...itemPatch(row, defaults),
    qty,
    rate,
    amount: rate ? String(lineAmount(qty, rate) ?? '') : '',
  })
}

/**
 * A line for one purchase-order line.
 *
 * The order's OPEN quantity is what is proposed, never the ordered quantity: a second delivery
 * against a half-received order must not start by claiming the whole order arrived. The link
 * (`po_line_id`, `po_no`, `po_qty_open`) rides in the line metadata, which is what
 * `grnModel.poMatchStatus` reads to colour the row and what reaches the server unchanged.
 */
export function lineFromPurchaseOrder(
  spec: DocumentTypeSpec,
  order: PurchaseOrderRow,
  poLine: PurchaseOrderLine,
  defaults: LineDefaults,
): LineDraft {
  const qty = poLine.qty_open > 0 ? String(poLine.qty_open) : ''
  const rate = poLine.rate !== null ? String(poLine.rate) : ''
  const metadata: Record<string, unknown> = {
    po_line_id: poLine.po_line_id,
    po_no: order.po_no,
    po_qty_open: poLine.qty_open,
  }
  // A deferred purchase settles an Inventory pending row, which the server matches on this key.
  if (poLine.pending_id) metadata.settlement_pending_id = poLine.pending_id
  return newLine(spec, {
    item_id: poLine.item_id,
    item_name: poLine.item_name,
    item_sku: poLine.item_sku,
    units: poLine.unit_id ? [{ unit_id: poLine.unit_id, unit_symbol: poLine.unit_symbol, conversion_factor: 1, is_default: true }] : [],
    unit_id: poLine.unit_id,
    warehouse_id: poLine.warehouse_id ?? order.warehouse_id ?? defaults.warehouseId ?? null,
    qty,
    rate,
    amount: rate && qty ? String(lineAmount(qty, rate) ?? '') : '',
    description: `Against ${order.po_no} · open ${poLine.qty_open}`,
    origin: order.origin === 'inventory_deferred' ? 'deferred' : 'manual',
    metadata,
  })
}

/**
 * Merge a scanned / pasted item into the draft: an existing line for the same item, warehouse and
 * batch has its quantity incremented, otherwise a line is appended.
 *
 * Incrementing is what a receiving bench expects from a scanner — twenty passes of the same
 * carton is one line of twenty, not twenty lines of one. A serialised item is never merged:
 * each unit carries its own serial and belongs on its own row.
 */
export function mergeScannedItem(
  lines: LineDraft[],
  spec: DocumentTypeSpec,
  row: ItemSearchRow,
  defaults: LineDefaults,
): { lines: LineDraft[]; key: string; merged: boolean } {
  const qty = toNumber(defaults.qty ?? '1') ?? 1
  const serialised = Number(row.track_serial) === 1
  const existing = serialised
    ? undefined
    : lines.find((l) => l.item_id === row.item_id && (l.warehouse_id ?? null) === (defaults.warehouseId ?? l.warehouse_id ?? null))
  if (existing) {
    const next = String((toNumber(existing.qty) ?? 0) + qty)
    return {
      lines: lines.map((l) => (l.key === existing.key ? { ...l, qty: next, amount: l.rate ? String(lineAmount(next, l.rate) ?? '') : l.amount } : l)),
      key: existing.key,
      merged: true,
    }
  }
  const created = lineFromItem(spec, row, { ...defaults, qty: String(qty) })
  return { lines: [...lines.filter((l) => l.item_id !== null || l.qty.trim() !== ''), created], key: created.key, merged: false }
}

/** One pasted line of the bulk-add box: `SKU`, `SKU 12`, `SKU,12` or `SKU<TAB>12`. */
export interface BulkEntry {
  code: string
  qty: number
}

export function parseBulkEntries(text: string): BulkEntry[] {
  const out: BulkEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim()
    if (!row) continue
    const parts = row.split(/[\t,;]+|\s{2,}|\s+(?=[\d.]+$)/).map((p) => p.trim()).filter(Boolean)
    const code = parts[0]
    if (!code) continue
    const qty = parts.length > 1 ? (toNumber(parts[parts.length - 1]) ?? 1) : 1
    out.push({ code, qty: qty > 0 ? qty : 1 })
  }
  return out
}
