import { describe, expect, it } from 'vitest'
import { countDifference, draftFromDocument, draftTotals, lineAmount, lineBaseQty, newHeader, newLine, round4, toPayload, validateDraft } from './formModel'
import { specForCode } from './registry'
import type { InventoryDocument, DocumentLine } from './types'

const TRANSFER = specForCode('STOCK_TRANSFER')!
const JOURNAL = specForCode('STOCK_JOURNAL')!
const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!
const WRITE_OFF = specForCode('WRITE_OFF')!
const INWARD = specForCode('INWARD_CHALLAN')!
const REVAL = specForCode('REVALUATION')!

const units = [{ unit_id: 1, unit_symbol: 'pcs', conversion_factor: 1, is_default: true }, { unit_id: 2, unit_symbol: 'box', conversion_factor: 12, is_default: false }]

describe('arithmetic', () => {
  it('rounds to 4 places like PHP round()', () => {
    expect(round4(1.00005)).toBe(1.0001)
    expect(round4(2.675 * 100)).toBe(267.5)
    expect(lineAmount('3', '2.5')).toBe(7.5)
    expect(lineAmount('', '2.5')).toBeNull()
    expect(countDifference('10', '7.5')).toBe(-2.5)
    expect(countDifference('10', '')).toBeNull()
  })

  it('converts entered quantity to base units through the unit factor', () => {
    expect(lineBaseQty({ units, unit_id: 2, qty: '2' })).toBe(24)
    expect(lineBaseQty({ units, unit_id: 1, qty: '2' })).toBe(2)
    expect(lineBaseQty({ units: [], unit_id: null, qty: '2' })).toBe(2)
  })
})

describe('toPayload', () => {
  it('builds a transfer with header warehouses and per-line overrides', () => {
    const header = { ...newHeader(TRANSFER, '2026-04-01'), from_warehouse_id: 1, to_warehouse_id: 2, document_no: 'TR-1' }
    const lines = [
      newLine(TRANSFER, { item_id: 10, qty: '5', units, unit_id: 1 }),
      newLine(TRANSFER, { item_id: 11, qty: '1', units, unit_id: 2, from_warehouse_id: 3, warehouse_id: 4 }),
      newLine(TRANSFER),
    ]
    const p = toPayload(header, lines, TRANSFER)
    expect(p.document_type).toBe('STOCK_TRANSFER')
    expect(p.from_warehouse_id).toBe(1)
    expect(p.to_warehouse_id).toBe(2)
    expect(p.document_no).toBe('TR-1')
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0]).toMatchObject({ item_id: 10, qty: 5, unit_id: 1, warehouse_id: 2, from_warehouse_id: 1 })
    expect(p.lines[1]).toMatchObject({ item_id: 11, qty: 1, unit_id: 2, warehouse_id: 4, from_warehouse_id: 3 })
    expect(p.lines[0].direction).toBeUndefined()
  })

  it('sends direction for by-line types and derives amount from rate', () => {
    const header = { ...newHeader(JOURNAL, '2026-04-01'), reason_code: 'ADJ', default_warehouse_id: 7 }
    const lines = [newLine(JOURNAL, { item_id: 1, qty: '2', rate: '10', direction: 'in' }), newLine(JOURNAL, { item_id: 2, qty: '1', direction: 'out', warehouse_id: 9 })]
    const p = toPayload(header, lines, JOURNAL)
    expect(p.reason_code).toBe('ADJ')
    expect(p.lines[0]).toMatchObject({ direction: 'in', rate: 10, amount: 20, warehouse_id: 7 })
    expect(p.lines[1]).toMatchObject({ direction: 'out', warehouse_id: 9 })
    expect(p.lines[1].rate).toBeUndefined()
  })

  it('sends book and counted quantities with qty 0 for a physical count', () => {
    const header = newHeader(COUNT, '2026-04-01')
    const lines = [newLine(COUNT, { item_id: 1, warehouse_id: 2, book_qty: '10', physical_qty: '8', valuation_rate: '5' })]
    const p = toPayload(header, lines, COUNT)
    expect(p.lines[0]).toMatchObject({ item_id: 1, warehouse_id: 2, qty: 0, book_qty: 10, physical_qty: 8, valuation_rate: 5 })
    expect(p.lines[0].direction).toBeUndefined()
  })

  it('carries party, stock effect and settlement metadata for an inward challan', () => {
    const header = { ...newHeader(INWARD, '2026-04-01'), party_ref: '55', party_name: 'Acme', stock_effect: 'settle_deferred', metadata: { linked_source_document_id: 900, box_marks: [] } }
    const lines = [newLine(INWARD, { item_id: 1, qty: '3', warehouse_id: 2 })]
    const p = toPayload(header, lines, INWARD)
    expect(p.party_ref).toBe(55)
    expect(p.party_name).toBe('Acme')
    expect(p.stock_effect).toBe('settle_deferred')
    expect(p.metadata).toEqual({ linked_source_document_id: 900 })
  })

  it('defaults the stock effect and drops empty metadata', () => {
    const header = newHeader(INWARD, '2026-04-01')
    const p = toPayload(header, [newLine(INWARD, { item_id: 1, qty: '3' })], INWARD)
    expect(p.stock_effect).toBe('challan_only')
    expect(p.metadata).toBeUndefined()
    expect(p.negative_override).toBeUndefined()
  })

  it('adds negative_override only when asked', () => {
    const header = newHeader(WRITE_OFF, '2026-04-01')
    const p = toPayload(header, [newLine(WRITE_OFF, { item_id: 1, qty: '3', serials: [{ serial_id: 5, serial_no: 'S5' }] })], WRITE_OFF, { negativeOverride: true })
    expect(p.negative_override).toBe(true)
    expect(p.lines[0].serials).toEqual([5])
  })
})

describe('validateDraft', () => {
  it('requires warehouses that differ on a transfer', () => {
    const header = { ...newHeader(TRANSFER, '2026-04-01'), from_warehouse_id: 1, to_warehouse_id: 1 }
    const errors = validateDraft(header, [newLine(TRANSFER, { item_id: 1, qty: '1' })], TRANSFER)
    expect(errors).toContain('Source and destination warehouses must be different.')
  })

  it('requires a positive quantity, an item and a direction', () => {
    const header = newHeader(JOURNAL, '2026-04-01')
    const errors = validateDraft(header, [newLine(JOURNAL, { qty: '0', direction: null })], JOURNAL)
    expect(errors).toEqual(['Line 1: pick an item.', 'Line 1: quantity must be greater than zero.', 'Line 1: choose in or out.'])
  })

  it('needs at least one counted difference on a physical count', () => {
    const header = newHeader(COUNT, '2026-04-01')
    const same = [newLine(COUNT, { item_id: 1, book_qty: '4', physical_qty: '4' })]
    expect(validateDraft(header, same, COUNT)).toEqual(['Every counted quantity equals the book quantity — there is nothing to adjust.'])
    const diff = [newLine(COUNT, { item_id: 1, book_qty: '4', physical_qty: '3' })]
    expect(validateDraft(header, diff, COUNT)).toEqual([])
  })

  it('requires a new unit cost on revaluation lines and the deferred purchase on settle_deferred', () => {
    expect(validateDraft(newHeader(REVAL, '2026-04-01'), [newLine(REVAL, { item_id: 1, qty: '1' })], REVAL)).toEqual(['Line 1: enter the new unit cost.'])
    const header = { ...newHeader(INWARD, '2026-04-01'), stock_effect: 'settle_deferred' }
    expect(validateDraft(header, [newLine(INWARD, { item_id: 1, qty: '1' })], INWARD)).toEqual(['Pick the deferred purchase this inward challan settles.'])
  })

  it('flags a serial count that does not match the base quantity', () => {
    const header = newHeader(WRITE_OFF, '2026-04-01')
    const line = newLine(WRITE_OFF, { item_id: 1, qty: '2', units, unit_id: 1, track_serial: true, serials: [{ serial_id: 1, serial_no: 'A' }] })
    expect(validateDraft(header, [line], WRITE_OFF)).toEqual(['Line 1: 1 serial number(s) picked for a base quantity of 2.'])
  })
})

function storedLine(partial: Partial<DocumentLine>): DocumentLine {
  return {
    line_id: 1, document_id: 1, item_id: 1, item_name: 'Widget', item_label: 'Widget', warehouse_id: 1, dest_warehouse_id: null, location_id: null, batch_id: null, unit_id: 1, unit_symbol: 'pcs',
    direction: 'in', qty: 1, conversion_factor: 1, base_qty: 1, source_transaction_rate: null, source_transaction_amount: null, valuation_rate: null, valuation_amount: null,
    valuation_method_applied: null, landed_cost_amount: 0, book_qty: null, physical_qty: null, sort_order: 0, metadata: null, serials: [],
    ...partial,
  }
}

function storedDoc(partial: Partial<InventoryDocument>): InventoryDocument {
  return {
    document_id: 1, document_uuid: 'u', cmp_id: 1, bo_id: 0, fy_id: 1, document_type: 'STOCK_TRANSFER', document_no: 'TR-9', series_id: null, document_date: '2026-04-02', status: 'DRAFT', source_app: 'inventory',
    source_document_type: null, source_document_id: null, source_document_uuid: null, source_document_no: null, source_document_date: null, party_ref: null, party_name: null, dest_party_ref: null,
    from_warehouse_id: 1, to_warehouse_id: 2, dest_bo_id: null, stock_effect: null, returnable: null, expected_return_date: null, movement_reason: null, reason_code: null, narration: 'moved', currency_code: 'INR', exchange_rate: 1,
    metadata: null, accounting_effects: [], reverses_document_id: null, reversed_by_document_id: null, approved_by: null, approved_at: null, posted_by: null, posted_at: null, cancelled_by: null, cancelled_at: null, cancel_reason: null,
    failure_reason: null, version: 1, created_by: null, created_at: null, updated_by: null, updated_at: null, lines: [],
    ...partial,
  }
}

describe('draftFromDocument', () => {
  it('collapses transfer pairs back into one editable line', () => {
    const doc = storedDoc({
      lines: [
        storedLine({ line_id: 1, direction: 'out', warehouse_id: 1, dest_warehouse_id: 2, qty: 5, metadata: { transfer_pair: 'tp-0', side: 'out' } }),
        storedLine({ line_id: 2, direction: 'in', warehouse_id: 2, dest_warehouse_id: null, qty: 5, metadata: { transfer_pair: 'tp-0', side: 'in' } }),
      ],
    })
    const { header, lines } = draftFromDocument(doc, TRANSFER)
    expect(header.document_no).toBe('TR-9')
    expect(header.narration).toBe('moved')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_id: 1, qty: '5', from_warehouse_id: 1, warehouse_id: 2, metadata: null })
  })

  it('keeps direction, rates and counts for by-line documents', () => {
    const doc = storedDoc({ document_type: 'PHYSICAL_ADJUSTMENT', lines: [storedLine({ direction: 'out', book_qty: 10, physical_qty: 8, valuation_rate: 3.5 })] })
    const { lines } = draftFromDocument(doc, COUNT)
    expect(lines[0]).toMatchObject({ direction: 'out', book_qty: '10', physical_qty: '8', valuation_rate: '3.5' })
  })
})

describe('draftTotals', () => {
  it('sums in / out quantities and amounts, ignoring blank lines', () => {
    const lines = [newLine(JOURNAL, { item_id: 1, qty: '2', rate: '5', direction: 'in' }), newLine(JOURNAL, { item_id: 2, qty: '3', amount: '9', direction: 'out' }), newLine(JOURNAL)]
    expect(draftTotals(lines, JOURNAL)).toEqual({ lines: 2, qtyIn: 2, qtyOut: 3, amount: 19 })
  })

  it('uses the counted difference for a physical count', () => {
    const lines = [newLine(COUNT, { item_id: 1, book_qty: '10', physical_qty: '12' }), newLine(COUNT, { item_id: 2, book_qty: '5', physical_qty: '1' })]
    expect(draftTotals(lines, COUNT)).toMatchObject({ lines: 2, qtyIn: 2, qtyOut: 4 })
  })
})
