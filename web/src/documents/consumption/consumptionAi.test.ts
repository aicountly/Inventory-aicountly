import { describe, expect, it } from 'vitest'
import { aggregateLines } from './consumptionAi'
import type { DocumentLine } from '../types'

function line(overrides: Partial<DocumentLine> & Pick<DocumentLine, 'item_id' | 'qty'>): DocumentLine {
  return {
    line_id: 0,
    document_id: 0,
    item_name: null,
    item_print_name: null,
    item_label: null,
    item_sku: null,
    warehouse_id: null,
    warehouse_name: null,
    dest_warehouse_id: null,
    dest_warehouse_name: null,
    location_id: null,
    batch_id: null,
    batch_no: null,
    expiry_date: null,
    unit_id: null,
    unit_symbol: null,
    unit_name: null,
    direction: 'out',
    conversion_factor: 1,
    base_qty: overrides.qty,
    source_transaction_rate: null,
    source_transaction_amount: null,
    valuation_rate: null,
    valuation_amount: null,
    valuation_method_applied: null,
    landed_cost_amount: null,
    book_qty: null,
    physical_qty: null,
    hsn_sac: null,
    description: null,
    sort_order: 0,
    metadata: null,
    serials: [],
    ...overrides,
  }
}

describe('aggregateLines', () => {
  it('keeps only outward lines and folds repeats of the same item into one row', () => {
    const linesByDoc = {
      1: [line({ item_id: 10, qty: 5, item_name: 'Steel Sheet', direction: 'out' }), line({ item_id: 11, qty: 2, direction: 'in' })],
      2: [line({ item_id: 10, qty: 8, item_name: 'Steel Sheet' })],
    }
    const dates = new Map([
      [1, '2026-09-01'],
      [2, '2026-09-10'],
    ])
    const rows = aggregateLines(linesByDoc, dates)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ item_id: 10, item_name: 'Steel Sheet', occurrences: 2, last_qty: 8, last_document_date: '2026-09-10' })
  })

  it('ignores inward lines entirely', () => {
    const rows = aggregateLines({ 1: [line({ item_id: 1, qty: 5, direction: 'in' })] }, new Map([[1, '2026-09-01']]))
    expect(rows).toEqual([])
  })

  it('sorts by most recent document date, tie-breaking on how often the item appears', () => {
    const linesByDoc = {
      1: [line({ item_id: 1, qty: 1 })],
      2: [line({ item_id: 2, qty: 1 })],
      3: [line({ item_id: 3, qty: 1 }), line({ item_id: 3, qty: 1 })],
    }
    const dates = new Map([
      [1, '2026-09-01'],
      [2, '2026-09-15'],
      [3, '2026-09-15'],
    ])
    const rows = aggregateLines(linesByDoc, dates)
    expect(rows.map((r) => r.item_id)).toEqual([3, 2, 1])
  })

  it('falls back to a generated name when the line carries none', () => {
    const rows = aggregateLines({ 1: [line({ item_id: 42, qty: 1 })] }, new Map([[1, '2026-09-01']]))
    expect(rows[0].item_name).toBe('Item #42')
  })
})
