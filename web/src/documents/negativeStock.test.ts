import { describe, expect, it } from 'vitest'
import { ApiError } from '../services/api'
import { offendingDraftKeys, offendingLineIds, parseNegativeStock } from './negativeStock'
import { newLine } from './formModel'
import { specForCode } from './registry'
import type { DocumentLine } from './types'

const detail = { item_id: 5, item_name: 'Bolt', warehouse_id: 2, on_hand: 3, required: 10, short_by: 7 }

describe('parseNegativeStock', () => {
  it('returns null for anything but a negative-stock block', () => {
    expect(parseNegativeStock(new Error('x'))).toBeNull()
    expect(parseNegativeStock(new ApiError(422, 'validation_failed', 'bad', detail))).toBeNull()
  })

  it('reads the single-object details shape the server sends today', () => {
    const out = parseNegativeStock(new ApiError(422, 'negative_stock_blocked', 'short', detail))
    expect(out).toEqual([{ item_id: 5, item_name: 'Bolt', warehouse_id: 2, on_hand: 3, required: 10, short_by: 7 }])
  })

  it('accepts a list under details.lines and the contract name shortfall', () => {
    const err = new ApiError(422, 'negative_stock_blocked', 'short', { lines: [{ ...detail, short_by: undefined, shortfall: 7 }, { item_id: 6, warehouse_id: null }] })
    const out = parseNegativeStock(err)!
    expect(out).toHaveLength(2)
    expect(out[0].short_by).toBe(7)
    expect(out[1]).toMatchObject({ item_id: 6, warehouse_id: null })
  })
})

describe('offending line matching', () => {
  const spec = specForCode('MATERIAL_ISSUE')!

  it('matches draft out-lines by item and warehouse (warehouse-less details match any warehouse)', () => {
    const a = newLine(spec, { item_id: 5, warehouse_id: 2 })
    const b = newLine(spec, { item_id: 5, warehouse_id: 3 })
    const c = newLine(spec, { item_id: 5, warehouse_id: 2, direction: 'in' })
    expect(offendingDraftKeys([a, b, c], [detail])).toEqual([a.key])
    expect(offendingDraftKeys([a, b], [{ ...detail, warehouse_id: null }])).toEqual([a.key, b.key])
  })

  it('matches stored lines by id', () => {
    const base: DocumentLine = {
      line_id: 1, document_id: 1, item_id: 5, warehouse_id: 2, dest_warehouse_id: null, location_id: null, batch_id: null, unit_id: 1, direction: 'out', qty: 10, conversion_factor: 1, base_qty: 10,
      source_transaction_rate: null, source_transaction_amount: null, valuation_rate: null, valuation_amount: null, valuation_method_applied: null, landed_cost_amount: 0, book_qty: null, physical_qty: null, sort_order: 0, metadata: null, serials: [],
    }
    expect(offendingLineIds([base, { ...base, line_id: 2, item_id: 9 }], [detail])).toEqual([1])
  })
})
