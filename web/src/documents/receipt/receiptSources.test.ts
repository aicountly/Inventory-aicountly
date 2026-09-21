import { describe, expect, it } from 'vitest'
import { specForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import type { ExtractedReceipt, PurchaseOrderReceivable } from './integrations'
import {
  clampReceiptQty,
  defaultSelection,
  extractionToPatch,
  looksLikeHeaderRow,
  parseBulkRows,
  parseDelimited,
  poLinesToDrafts,
} from './receiptSources'

const spec = specForCode('MATERIAL_RECEIPT') as DocumentTypeSpec
const options = { spec, defaultWarehouseId: 3 }

const receivable: PurchaseOrderReceivable = {
  order: { po_id: 'PO-77', po_no: 'PO-2026-0077', po_date: '2026-09-01', supplier_ref: 1042, supplier_name: 'Shree Cement', status: 'open' },
  lines: [
    { po_line_id: 1, item_id: 11, item_name: 'Cement OPC 53', item_sku: 'CEM-001', unit_id: 5, unit_symbol: 'Bags', ordered_qty: 200, received_qty: 150, pending_qty: 50, rate: 420 },
    { po_line_id: 2, item_id: 12, item_name: 'TMT Steel 12mm', item_sku: 'STL-012', unit_id: 6, unit_symbol: 'Kg', ordered_qty: 500, received_qty: 500, pending_qty: 0, rate: 62.5 },
    { po_line_id: 3, item_id: null, item_name: 'Pallet charge', item_sku: null, unit_id: null, unit_symbol: null, ordered_qty: 1, received_qty: 0, pending_qty: 1, rate: 100 },
  ],
}

describe('receiving against a purchase order', () => {
  it('never receives more than is pending', () => {
    expect(clampReceiptQty('80', 50)).toBe(50)
    expect(clampReceiptQty('20', 50)).toBe(20)
    expect(clampReceiptQty('-4', 50)).toBe(0)
    expect(clampReceiptQty('', 50)).toBe(0)
    expect(clampReceiptQty('5', 0)).toBe(0)
  })

  it('offers the pending quantity as the default', () => {
    expect(defaultSelection(receivable.lines)).toEqual({ '1': '50', '2': '', '3': '1' })
  })

  it('builds lines only for the order lines that resolve to an item and a quantity', () => {
    const drafts = poLinesToDrafts(receivable, { '1': '50', '2': '10', '3': '1' }, options)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].item_id).toBe(11)
    expect(drafts[0].qty).toBe('50')
    expect(drafts[0].rate).toBe('420')
    expect(drafts[0].amount).toBe('21000')
    expect(drafts[0].warehouse_id).toBe(3)
  })

  it('keeps a reference back to the order without copying the order itself', () => {
    const [draft] = poLinesToDrafts(receivable, { '1': '50' }, options)
    expect(draft.metadata).toEqual({
      source: 'purchase_order',
      purchase_order_id: 'PO-77',
      purchase_order_no: 'PO-2026-0077',
      purchase_order_line_id: 1,
    })
  })

  it('clamps an over-entered quantity rather than refusing the whole order', () => {
    const [draft] = poLinesToDrafts(receivable, { '1': '999' }, options)
    expect(draft.qty).toBe('50')
  })
})

describe('applying a read invoice', () => {
  const extraction: ExtractedReceipt = {
    supplier_name: 'Shree Cement',
    supplier_ref: 1042,
    reference_no: 'INV-4421',
    reference_date: '2026-09-17',
    document_date: '2026-09-17',
    lines: [
      { item_id: 11, item_name: 'Cement OPC 53', item_sku: 'CEM-001', batch_no: 'B00124', unit_id: 5, qty: 100, rate: 420, confidence: 0.92 },
      { item_id: null, item_name: 'Unloading charges', item_sku: null, qty: 1, rate: 1500 },
    ],
    confidence: 0.88,
  }

  it('proposes the header the invoice carries', () => {
    const patch = extractionToPatch(extraction, options)
    expect(patch.header.party_name).toBe('Shree Cement')
    expect(patch.header.party_ref).toBe('1042')
    expect(patch.header.reference).toBe('INV-4421')
    expect(patch.header.reference_date).toBe('2026-09-17')
  })

  it('never moves the receipt date to the invoice date', () => {
    const patch = extractionToPatch(extraction, options)
    expect('document_date' in patch.header).toBe(false)
  })

  it('reports the lines it could not match instead of guessing an item', () => {
    const patch = extractionToPatch(extraction, options)
    expect(patch.lines).toHaveLength(1)
    expect(patch.lines[0].item_id).toBe(11)
    expect(patch.lines[0].amount).toBe('42000')
    expect(patch.unmatched).toEqual([{ label: 'Unloading charges', qty: 1, rate: 1500 }])
    expect(patch.notes.join(' ')).toContain('1 line could not be matched')
  })

  it('says a read batch number still has to be picked', () => {
    const patch = extractionToPatch(extraction, options)
    expect(patch.lines[0].batch_id).toBeNull()
    expect(patch.notes.join(' ')).toContain('Batch numbers were read')
  })

  it('leaves a field alone when the reader found nothing', () => {
    const patch = extractionToPatch({ lines: [] }, options)
    expect(patch.header).toEqual({})
    expect(patch.lines).toEqual([])
  })
})

describe('parsing a pasted list', () => {
  it('reads a comma separated list', () => {
    expect(parseDelimited('CEM-001,100,420\nSTL-012,500,62.5')).toEqual([
      ['CEM-001', '100', '420'],
      ['STL-012', '500', '62.5'],
    ])
  })

  it('reads a block copied straight out of a spreadsheet', () => {
    expect(parseDelimited('CEM-001\t100\t420\r\nSTL-012\t500\t62.5')).toEqual([
      ['CEM-001', '100', '420'],
      ['STL-012', '500', '62.5'],
    ])
  })

  it('keeps a comma that is inside a quoted cell', () => {
    expect(parseDelimited('"Cement, grey",100,420')).toEqual([['Cement, grey', '100', '420']])
  })

  it('reads an escaped quote', () => {
    expect(parseDelimited('"12"" pipe",5')).toEqual([['12" pipe', '5']])
  })

  it('skips empty rows', () => {
    expect(parseDelimited('CEM-001,1\n\n \nSTL-012,2')).toEqual([
      ['CEM-001', '1'],
      ['STL-012', '2'],
    ])
  })

  it('knows column titles from data', () => {
    expect(looksLikeHeaderRow(['SKU / barcode', 'Qty', 'Rate', 'Batch'])).toBe(true)
    expect(looksLikeHeaderRow(['CEM-001', '100', '420', 'B00124'])).toBe(false)
  })

  it('drops the header row and numbers the rest as the user sees them', () => {
    const rows = parseBulkRows('SKU,Qty,Rate,Batch\nCEM-001,100,420,B00124')
    expect(rows).toEqual([{ code: 'CEM-001', qty: '100', rate: '420', batch: 'B00124', sourceRow: 2 }])
  })

  it('numbers from one when there is no header row', () => {
    const rows = parseBulkRows('CEM-001,100')
    expect(rows).toEqual([{ code: 'CEM-001', qty: '100', rate: '', batch: '', sourceRow: 1 }])
  })
})
