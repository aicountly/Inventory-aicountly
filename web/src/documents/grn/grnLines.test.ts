import { describe, expect, it } from 'vitest'
import { itemPatch, lineFromItem, lineFromPurchaseOrder, mergeScannedItem, parseBulkEntries } from './grnLines'
import { newLine } from '../formModel'
import { specForCode } from '../registry'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { PurchaseOrderLine, PurchaseOrderRow } from '../../services/purchaseOrdersApi'

const GRN = specForCode('INWARD_CHALLAN')!

function item(partial: Partial<ItemSearchRow> = {}): ItemSearchRow {
  return {
    item_id: 10,
    item_name: 'UltraTech Cement 50kg',
    item_alias: null,
    print_name: null,
    item_sku: 'UTC-50',
    item_upc: '8901234567890',
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    unit_symbol: 'Bags',
    track_batch: 1,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: null,
    units: [
      { unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Bags', unit_name: 'Bags' },
      { unit_id: 2, is_default: 0, conversion_factor: 40, uom_role: null, unit_symbol: 'Pallet', unit_name: 'Pallet' },
    ],
    ...partial,
  }
}

describe('itemPatch', () => {
  it('takes the item’s default unit and its tracking flags', () => {
    const patch = itemPatch(item(), { warehouseId: 3 })
    expect(patch.unit_id).toBe(1)
    expect(patch.track_batch).toBe(true)
    expect(patch.track_serial).toBe(false)
    expect(patch.units).toHaveLength(2)
    expect(patch.warehouse_id).toBe(3)
  })

  it('prefers the item’s own default warehouse over the document default', () => {
    expect(itemPatch(item({ default_warehouse_id: 9 }), { warehouseId: 3 }).warehouse_id).toBe(9)
  })

  it('keeps the warehouse a line already has', () => {
    const existing = newLine(GRN, { warehouse_id: 7 })
    expect(itemPatch(item({ default_warehouse_id: 9 }), { warehouseId: 3 }, existing).warehouse_id).toBe(7)
  })

  it('clears the batch, expiry and serials of whatever was on the line before', () => {
    const patch = itemPatch(item(), { warehouseId: 1 })
    expect(patch.batch_id).toBeNull()
    expect(patch.expiry_date).toBeNull()
    expect(patch.serials).toEqual([])
  })
})

describe('lineFromItem', () => {
  it('defaults to one unit and computes the amount when a rate is given', () => {
    const line = lineFromItem(GRN, item(), { warehouseId: 1, qty: '200', rate: '450' })
    expect(line.qty).toBe('200')
    expect(line.amount).toBe('90000')
    expect(lineFromItem(GRN, item(), { warehouseId: 1 }).qty).toBe('1')
  })
})

describe('lineFromPurchaseOrder', () => {
  const order: PurchaseOrderRow = {
    po_id: 'PO-77',
    po_no: 'PO-2026-077',
    po_date: '2026-09-01',
    party_ref: 1042,
    party_name: 'Adani Enterprises Limited',
    status: 'open',
    warehouse_id: 2,
    qty_open: 40,
    origin: 'purchases',
    lines: [],
  }
  const poLine: PurchaseOrderLine = {
    po_line_id: 'PO-77/1',
    item_id: 10,
    item_name: 'UltraTech Cement 50kg',
    item_sku: 'UTC-50',
    unit_id: 1,
    unit_symbol: 'Bags',
    warehouse_id: null,
    qty_ordered: 100,
    qty_received: 60,
    qty_open: 40,
    rate: 450,
  }

  it('proposes the OPEN quantity, not the ordered one', () => {
    const line = lineFromPurchaseOrder(GRN, order, poLine, { warehouseId: 5 })
    expect(line.qty).toBe('40')
    expect(line.amount).toBe('18000')
  })

  it('records the link the match status is read from', () => {
    const line = lineFromPurchaseOrder(GRN, order, poLine, { warehouseId: 5 })
    expect(line.metadata).toMatchObject({ po_line_id: 'PO-77/1', po_no: 'PO-2026-077', po_qty_open: 40 })
  })

  it('falls back to the order warehouse, then the document default', () => {
    expect(lineFromPurchaseOrder(GRN, order, poLine, { warehouseId: 5 }).warehouse_id).toBe(2)
    expect(lineFromPurchaseOrder(GRN, { ...order, warehouse_id: null }, poLine, { warehouseId: 5 }).warehouse_id).toBe(5)
  })

  it('carries the pending row a deferred purchase settles', () => {
    const deferred: PurchaseOrderRow = { ...order, origin: 'inventory_deferred' }
    const line = lineFromPurchaseOrder(GRN, deferred, { ...poLine, pending_id: 501 }, { warehouseId: 5 })
    expect(line.origin).toBe('deferred')
    expect(line.metadata).toMatchObject({ settlement_pending_id: 501 })
  })
})

describe('mergeScannedItem', () => {
  it('increments the line a repeated scan is already on', () => {
    const first = mergeScannedItem([], GRN, item(), { warehouseId: 1, qty: '1' })
    expect(first.merged).toBe(false)
    const second = mergeScannedItem(first.lines, GRN, item(), { warehouseId: 1, qty: '3' })
    expect(second.merged).toBe(true)
    expect(second.lines).toHaveLength(1)
    expect(second.lines[0].qty).toBe('4')
  })

  it('never merges a serialised item — each unit owns its serial', () => {
    const serialised = item({ track_serial: 1 })
    const first = mergeScannedItem([], GRN, serialised, { warehouseId: 1, qty: '1' })
    const second = mergeScannedItem(first.lines, GRN, serialised, { warehouseId: 1, qty: '1' })
    expect(second.merged).toBe(false)
    expect(second.lines).toHaveLength(2)
  })

  it('drops the empty starter line rather than leaving a gap above the scan', () => {
    const blank = newLine(GRN)
    const result = mergeScannedItem([blank], GRN, item(), { warehouseId: 1, qty: '2' })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].item_id).toBe(10)
  })

  it('keeps the amount in step when the line already has a rate', () => {
    const priced = [{ ...newLine(GRN, { item_id: 10, qty: '2', rate: '450', amount: '900' }) }]
    const result = mergeScannedItem(priced, GRN, item(), { warehouseId: null, qty: '1' })
    expect(result.lines[0].qty).toBe('3')
    expect(result.lines[0].amount).toBe('1350')
  })
})

describe('parseBulkEntries', () => {
  it('reads a code with a quantity after a comma, a tab or spaces', () => {
    expect(parseBulkEntries('TS-12MM, 10\nUTC-50\t200\n8901234567890 50')).toEqual([
      { code: 'TS-12MM', qty: 10 },
      { code: 'UTC-50', qty: 200 },
      { code: '8901234567890', qty: 50 },
    ])
  })

  it('treats a bare code as one unit and skips blank lines', () => {
    expect(parseBulkEntries('FIN-2\n\n  \nCROM-18')).toEqual([
      { code: 'FIN-2', qty: 1 },
      { code: 'CROM-18', qty: 1 },
    ])
  })

  it('never returns a zero or negative quantity', () => {
    expect(parseBulkEntries('FIN-2, 0\nCROM-18, -5')).toEqual([
      { code: 'FIN-2', qty: 1 },
      { code: 'CROM-18', qty: 1 },
    ])
  })
})
