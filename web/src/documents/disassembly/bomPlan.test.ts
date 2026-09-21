import { describe, expect, it } from 'vitest'
import type { BomHeader } from '../bom'
import { planFromBom, recoverableLines, skippedNotice } from './bomPlan'

const bom: BomHeader = {
  bom_id: 7,
  bom_name: 'Laptop Pro build',
  finished_item_id: 1,
  finished_item_name: 'Laptop - Pro Model',
  finished_item_sku: 'LP-PRO-001',
  yield_qty: 1,
  yield_unit_id: 9,
  yield_unit_symbol: 'Nos',
  is_active: 1,
  lines: [
    { bom_line_id: 11, item_id: 2, qty: 1, unit_id: 9, line_kind: 'component', item_name: 'Motherboard', item_sku: 'MB-001', unit_symbol: 'Nos' },
    { bom_line_id: 12, item_id: 3, qty: 2, unit_id: 9, line_kind: 'component', scrap_percent: 5, item_name: 'Keyboard', item_sku: 'KB-001', unit_symbol: 'Nos' },
    { bom_line_id: 13, item_id: 4, qty: 1, unit_id: 9, line_kind: 'by_product', item_name: 'Offcut' },
    { bom_line_id: 14, item_id: 5, qty: 1, unit_id: 9, line_kind: 'scrap', item_name: 'Swarf' },
  ],
}

describe('planFromBom', () => {
  it('scales the components to the quantity being torn down', () => {
    const plan = planFromBom(bom, 5)
    expect(plan.scale).toBe(5)
    expect(plan.components.map((c) => [c.item_id, c.qty])).toEqual([
      [2, 5],
      [3, 10],
    ])
  })

  it('does not add the forward run’s scrap allowance to what is recovered', () => {
    // Keyboard is 2 per yield with 5% scrap. Production issues 2.1; a teardown recovers 2.
    expect(planFromBom(bom, 1).components[1].qty).toBe(2)
  })

  it('leaves by-products and scrap out — a teardown recovers neither', () => {
    const plan = planFromBom(bom, 1)
    expect(plan.components.map((c) => c.item_id)).not.toContain(4)
    expect(plan.components.map((c) => c.item_id)).not.toContain(5)
    expect(plan.skipped).toEqual({ by_product: 1, scrap: 1, zero: 0 })
    expect(skippedNotice(plan)).toContain('not recovered by a disassembly')
  })

  it('handles a BOM whose yield is more than one', () => {
    const plan = planFromBom({ ...bom, yield_qty: 4 }, 2)
    expect(plan.components[0].qty).toBe(0.5)
  })

  it('says nothing when there is nothing to leave out', () => {
    const clean = { ...bom, lines: bom.lines.slice(0, 2) }
    expect(skippedNotice(planFromBom(clean, 1))).toBeNull()
  })

  it('lists only the component lines as recoverable', () => {
    expect(recoverableLines(bom).map((l) => l.item_id)).toEqual([2, 3])
  })
})
