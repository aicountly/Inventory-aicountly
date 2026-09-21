import { describe, expect, it } from 'vitest'
import type { ValuationSnapshotRow } from '../../../services/valuationApi'
import { buildVarianceBreakdown } from './varianceDetail'

function row(
  item_id: number,
  stock_value: number,
  extra: Partial<ValuationSnapshotRow> = {},
): ValuationSnapshotRow {
  return {
    item_id,
    item_name: `Widget ${item_id}`,
    item_alias: null,
    item_sku: `W-${item_id}`,
    closing_qty: 10,
    unit_cost: stock_value / 10,
    stock_value,
    valuation_method_applied: 'FIFO',
    ...extra,
  }
}

describe('buildVarianceBreakdown', () => {
  it('ranks by the money that moved, not by the percentage', () => {
    const basis = [row(1, 80000), row(2, 40)]
    // #2 doubled — 100% — but #1 is why the totals differ.
    const method = [row(1, 81600), row(2, 80)]

    const out = buildVarianceBreakdown(basis, method)

    expect(out.items.map((i) => i.itemId)).toEqual([1, 2])
    expect(out.items[0].difference).toBe(1600)
    expect(out.items[1].variancePercent).toBe(100)
  })

  it('totals to the difference the comparison row reports', () => {
    const out = buildVarianceBreakdown(
      [row(1, 8465220), row(2, 1000)],
      [row(1, 8512940), row(2, 1000)],
    )
    expect(out.total).toBe(47720)
  })

  it('counts the items that did not move instead of listing them', () => {
    const out = buildVarianceBreakdown([row(1, 500), row(2, 700)], [row(1, 500), row(2, 900)])

    expect(out.unchanged).toBe(1)
    expect(out.items).toHaveLength(1)
    expect(out.items[0].itemId).toBe(2)
  })

  it('rounds away the float tail so the detail reconciles with the header', () => {
    const out = buildVarianceBreakdown([row(1, 0.3)], [row(1, 0.1 + 0.2)])
    expect(out.items).toHaveLength(0)
    expect(out.unchanged).toBe(1)
    expect(out.total).toBe(0)
  })

  it('treats an item missing from one side as zero there', () => {
    const out = buildVarianceBreakdown([row(1, 500)], [])
    expect(out.items[0].difference).toBe(-500)
    expect(out.items[0].methodValue).toBe(0)

    const added = buildVarianceBreakdown([], [row(9, 250)])
    expect(added.items[0].difference).toBe(250)
    expect(added.items[0].basisValue).toBe(0)
    expect(added.items[0].variancePercent).toBeNull()
  })

  it('falls back through alias to an id when an item has no name', () => {
    const out = buildVarianceBreakdown(
      [row(7, 100, { item_name: null, item_alias: null, item_sku: null })],
      [row(7, 200, { item_name: null, item_alias: null, item_sku: null })],
    )
    expect(out.items[0].name).toBe('Item #7')
    expect(out.items[0].sku).toBeNull()
  })

  it('measures each item against its own basis, using the magnitude', () => {
    // A negative-stock line: the value is below zero, and a difference that
    // makes it more negative must not read as a positive percentage.
    const out = buildVarianceBreakdown([row(1, -1000)], [row(1, -1200)])
    expect(out.items[0].difference).toBe(-200)
    expect(out.items[0].variancePercent).toBe(-20)
  })
})
