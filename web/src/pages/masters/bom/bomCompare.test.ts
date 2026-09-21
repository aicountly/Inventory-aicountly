import { describe, expect, it } from 'vitest'
import type { Bom, BomLine } from '../../../services/masters'
import { diffBoms } from './bomCompare'

function line(over: Partial<BomLine> = {}): BomLine {
  return {
    item_id: 1,
    qty: 1,
    unit_id: 1,
    line_kind: 'component',
    scrap_percent: 0,
    sort_order: 0,
    item_name: 'Wooden seat',
    item_sku: 'WS-1',
    unit_symbol: 'pc',
    ...over,
  }
}

function bom(lines: BomLine[], over: Partial<Bom> = {}): Bom {
  return {
    bom_id: 1,
    bom_name: 'Chair v1',
    finished_item_id: 900,
    yield_qty: 1,
    yield_unit_id: 1,
    is_active: 1,
    finished_item_name: 'Office chair',
    finished_item_sku: 'CH-1',
    yield_unit_symbol: 'pc',
    line_count: lines.length,
    lines,
    ...over,
  }
}

describe('diffBoms', () => {
  it('reports added, removed, changed and unchanged lines', () => {
    const left = bom([
      line({ item_id: 1, qty: 1 }),
      line({ item_id: 2, item_name: 'Metal leg', qty: 4 }),
      line({ item_id: 3, item_name: 'Screw', qty: 16 }),
    ])
    const right = bom([
      line({ item_id: 1, qty: 1 }),
      line({ item_id: 2, item_name: 'Metal leg', qty: 5 }),
      line({ item_id: 4, item_name: 'Castor', qty: 5 }),
    ])

    const diff = diffBoms(left, right)
    expect({ added: diff.added, removed: diff.removed, changed: diff.changed, unchanged: diff.unchanged }).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
    })
    // Added, removed, changed, then the rest: the answer first, context after.
    expect(diff.rows.map((r) => r.kind)).toEqual(['added', 'removed', 'changed', 'unchanged'])
    expect(diff.rows[2].fields).toEqual([{ label: 'Quantity', left: '4 pc', right: '5 pc' }])
  })

  it('reports a scrap change on its own', () => {
    const diff = diffBoms(bom([line({ scrap_percent: 0 })]), bom([line({ scrap_percent: 2.5 })]))
    expect(diff.rows[0].kind).toBe('changed')
    expect(diff.rows[0].fields).toEqual([{ label: 'Scrap %', left: '0%', right: '2.5%' }])
  })

  /*
   * The same item appearing as a component in one bill and as a by-product in
   * the other is two different facts about the run. Matching on the item alone
   * would report a quantity change that never happened and hide a real
   * structural one.
   */
  it('does not match a component against a by-product of the same item', () => {
    const diff = diffBoms(
      bom([line({ item_id: 5, line_kind: 'component', qty: 2 })]),
      bom([line({ item_id: 5, line_kind: 'by_product', qty: 2 })]),
    )
    expect(diff.changed).toBe(0)
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(1)
  })

  it('ignores differences below the four decimals the API stores', () => {
    const diff = diffBoms(bom([line({ qty: 1 })]), bom([line({ qty: 1.000001 })]))
    expect(diff.rows[0].kind).toBe('unchanged')
  })

  it('reports header differences separately from the lines', () => {
    const diff = diffBoms(
      bom([line()], { yield_qty: 1, is_active: 1 }),
      bom([line()], { yield_qty: 10, is_active: 0, finished_item_id: 901, finished_item_name: 'Visitor chair' }),
    )
    expect(diff.header).toEqual([
      { label: 'Finished item', left: 'Office chair', right: 'Visitor chair' },
      { label: 'Yield', left: '1 pc', right: '10 pc' },
      { label: 'Status', left: 'Active', right: 'Inactive' },
    ])
  })

  it('copes with a bill that has no lines at all', () => {
    const diff = diffBoms(bom([]), bom([line()]))
    expect(diff.added).toBe(1)
    expect(diff.rows[0].itemName).toBe('Wooden seat')
  })

  it('names an item by its id when the API sent no name', () => {
    const diff = diffBoms(bom([line({ item_name: null })]), bom([]))
    expect(diff.rows[0].itemName).toBe('#1')
  })
})
