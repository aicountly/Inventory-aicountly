import { describe, expect, it } from 'vitest'
import { baseUnitRate, componentQty, productionPayload, scaleBomLines, scaleFactor } from './bom'
import type { BomHeader } from './bom'

const bom: BomHeader = {
  bom_id: 7,
  bom_name: 'Chair',
  finished_item_id: 100,
  yield_qty: 2,
  yield_unit_id: 5,
  is_active: 1,
  lines: [
    { bom_line_id: 1, item_id: 1, qty: 4, unit_id: 3, line_kind: 'component', scrap_percent: 0 },
    { bom_line_id: 2, item_id: 2, qty: 1, unit_id: 3, line_kind: 'component', scrap_percent: 10 },
    { bom_line_id: 3, item_id: 3, qty: 0.5, unit_id: 3, line_kind: 'by_product' },
    { bom_line_id: 4, item_id: 4, qty: 1, unit_id: 3, line_kind: 'scrap' },
    { bom_line_id: 5, item_id: 5, qty: 0, unit_id: 3, line_kind: 'component' },
  ],
}

describe('BomService arithmetic mirror', () => {
  it('scales by production / yield with a floor on yield', () => {
    expect(scaleFactor(10, 2)).toBe(5)
    expect(scaleFactor(1, 0)).toBe(1 / 0.0001)
  })

  it('uplifts component quantity by scrap percent, rounded to 4 places', () => {
    expect(componentQty(4, 5)).toBe(20)
    expect(componentQty(1, 5, 10)).toBe(5.5)
    expect(componentQty(1, 1 / 3)).toBe(0.3333)
  })

  it('expresses the finished rate per base unit', () => {
    expect(baseUnitRate(120, 12)).toBe(10)
    expect(baseUnitRate(120, 0)).toBe(120)
  })

  it('explodes a BOM into component OUT lines, by-product IN lines and the finished IN line', () => {
    const lines = scaleBomLines(bom, 10, 9, 50)
    expect(lines.map((l) => [l.item_id, l.direction, l.qty])).toEqual([
      [1, 'out', 20],
      [2, 'out', 5.5],
      [3, 'in', 2.5],
      [100, 'in', 10],
    ])
    expect(lines[0].metadata).toMatchObject({ bom_line_id: 1, line_kind: 'component', bom_qty: 4, scale: 5 })
    const finished = lines[lines.length - 1]
    expect(finished).toMatchObject({ item_id: 100, unit_id: 5, warehouse_id: 9, rate: 50, amount: 500, valuation_rate: 50 })
    expect(finished.metadata).toMatchObject({ line_kind: 'finished', bom_id: 7 })
  })

  it('leaves valuation_rate null when the finished rate is zero and drops a missing warehouse', () => {
    const lines = scaleBomLines(bom, 2, 0, 0)
    const finished = lines[lines.length - 1]
    expect(finished.valuation_rate).toBeNull()
    expect(finished.warehouse_id).toBeNull()
  })

  it('builds the same payload shape as BomService::productionPayload', () => {
    const p = productionPayload(bom, 4, 9, 25, { document_date: '2026-04-01', narration: 'run 1' }, 2)
    expect(p.document_type).toBe('PRODUCTION')
    expect(p.document_date).toBe('2026-04-01')
    expect(p.narration).toBe('run 1')
    expect(p.metadata).toEqual({ bom_id: 7, production_qty: 4, finished_rate: 25, warehouse_id: 9 })
    expect(p.lines[p.lines.length - 1].valuation_rate).toBe(12.5)
  })
})
