import { describe, expect, it } from 'vitest'
import { lineBaseQty, newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import type { BomHeader } from '../bom'
import type { CreateDocumentLine } from '../types'
import { draftsFromExplosion, hydrateDrafts, mergeAllocations, unitOptionsFor } from './productionLines'

const SPEC = specForCode('PRODUCTION')!

const BOM: BomHeader = {
  bom_id: 7,
  bom_name: 'Office chair - standard',
  finished_item_id: 99,
  finished_item_name: 'Office chair',
  finished_item_sku: 'CH-001',
  yield_qty: 1,
  yield_unit_id: 5,
  yield_unit_symbol: 'Nos',
  is_active: 1,
  lines: [
    { bom_line_id: 1, item_id: 1, qty: 4, unit_id: 5, line_kind: 'component', item_name: 'Screw M6', item_sku: 'SC-6', unit_symbol: 'Nos' },
    { bom_line_id: 2, item_id: 2, qty: 1.25, unit_id: 5, line_kind: 'component', item_name: 'Wooden panel', item_sku: 'WP-1', unit_symbol: 'Nos' },
  ],
}

function exploded(qty: number): CreateDocumentLine[] {
  return [
    { item_id: 1, unit_id: 5, warehouse_id: 1, qty: 4 * qty, rate: 0, amount: 0, direction: 'out', metadata: { bom_line_id: 1, line_kind: 'component' } },
    { item_id: 2, unit_id: 5, warehouse_id: 1, qty: 1.25 * qty, rate: 0, amount: 0, direction: 'out', metadata: { bom_line_id: 2, line_kind: 'component' } },
    { item_id: 99, unit_id: 5, warehouse_id: 1, qty, rate: 0, amount: 0, direction: 'in', metadata: { line_kind: 'finished', bom_id: 7 } },
  ]
}

describe('draftsFromExplosion', () => {
  it('names every line from the BOM the server exploded', () => {
    const drafts = draftsFromExplosion(exploded(4), BOM, SPEC)
    expect(drafts.map((d) => d.item_name)).toEqual(['Screw M6', 'Wooden panel', 'Office chair'])
    expect(drafts.map((d) => d.direction)).toEqual(['out', 'out', 'in'])
    expect(drafts[2].item_sku).toBe('CH-001')
  })

  it('keeps the server quantities verbatim', () => {
    expect(draftsFromExplosion(exploded(4), BOM, SPEC).map((d) => d.qty)).toEqual(['16', '5', '4'])
  })
})

describe('mergeAllocations', () => {
  const first = hydrateDrafts(draftsFromExplosion(exploded(4), BOM, SPEC), [
    { item_id: 1, item_name: 'Screw M6', item_alias: null, print_name: null, item_sku: 'SC-6', item_upc: null, hsn_sac: null, mrp: null, unit_id: 5, unit_symbol: 'Nos', track_batch: 1, track_serial: 0, valuation_method: null, default_warehouse_id: null, units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }] },
  ])

  function allocate(lines: LineDraft[]): LineDraft[] {
    return lines.map((l) =>
      l.item_id === 1
        ? { ...l, warehouse_id: 9, batch_id: 44, batch_no: 'B-44', serials: [{ serial_id: 1, serial_no: 'SN-1' }] }
        : l,
    )
  }

  it('keeps the warehouse and batch a person chose when the run is re-scaled', () => {
    const merged = mergeAllocations(allocate(first), draftsFromExplosion(exploded(8), BOM, SPEC))
    const screw = merged.find((l) => l.item_id === 1)!
    expect(screw.qty).toBe('32')
    expect(screw.warehouse_id).toBe(9)
    expect(screw.batch_id).toBe(44)
    expect(screw.batch_no).toBe('B-44')
  })

  it('drops serial numbers when the quantity changed, because the server refuses a partial set', () => {
    const merged = mergeAllocations(allocate(first), draftsFromExplosion(exploded(8), BOM, SPEC))
    expect(merged.find((l) => l.item_id === 1)!.serials).toEqual([])
  })

  it('keeps serial numbers when the same quantity is exploded again', () => {
    const merged = mergeAllocations(allocate(first), draftsFromExplosion(exploded(4), BOM, SPEC))
    expect(merged.find((l) => l.item_id === 1)!.serials).toEqual([{ serial_id: 1, serial_no: 'SN-1' }])
  })

  it('keeps the draft key, so an open row is not remounted under the user', () => {
    const before = allocate(first)
    const merged = mergeAllocations(before, draftsFromExplosion(exploded(8), BOM, SPEC))
    expect(merged.map((l) => l.key)).toEqual(before.map((l) => l.key))
  })

  it('carries the hydrated unit set forward, so base quantities stay comparable', () => {
    const boxed = hydrateDrafts(draftsFromExplosion(exploded(4), BOM, SPEC), [
      { item_id: 2, item_name: 'Wooden panel', item_alias: null, print_name: null, item_sku: 'WP-1', item_upc: null, hsn_sac: null, mrp: null, unit_id: 5, unit_symbol: 'Box', track_batch: 0, track_serial: 0, valuation_method: null, default_warehouse_id: null, units: [{ unit_id: 5, is_default: 1, conversion_factor: 12, uom_role: null, unit_symbol: 'Box', unit_name: 'Box' }] },
    ])
    const merged = mergeAllocations(boxed, draftsFromExplosion(exploded(4), BOM, SPEC))
    const panel = merged.find((l) => l.item_id === 2)!
    expect(lineBaseQty(panel)).toBe(60)
  })

  it('returns the fresh lines untouched when there was nothing before', () => {
    const fresh = draftsFromExplosion(exploded(4), BOM, SPEC)
    expect(mergeAllocations([], fresh)).toBe(fresh)
  })
})

describe('hydrateDrafts / unitOptionsFor', () => {
  it('teaches a line that its item is batch or serial controlled', () => {
    const lines = draftsFromExplosion(exploded(4), BOM, SPEC)
    expect(lines[0].track_batch).toBe(false)
    const hydrated = hydrateDrafts(lines, [
      { item_id: 1, item_name: 'Screw M6', item_alias: null, print_name: null, item_sku: 'SC-6', item_upc: null, hsn_sac: null, mrp: null, unit_id: 5, unit_symbol: 'Nos', track_batch: 1, track_serial: 1, valuation_method: null, default_warehouse_id: null, units: [] },
    ])
    expect(hydrated[0].track_batch).toBe(true)
    expect(hydrated[0].track_serial).toBe(true)
    // Untouched items keep what they had.
    expect(hydrated[1].track_batch).toBe(false)
  })

  it('falls back to the item’s own unit when it lists none', () => {
    expect(unitOptionsFor({ units: [], unit_id: 5, unit_symbol: 'Nos' })).toEqual([
      { unit_id: 5, unit_symbol: 'Nos', unit_name: null, conversion_factor: 1, is_default: true },
    ])
  })

  it('leaves a draft alone when nothing was read back', () => {
    const lines = [newLine(SPEC, { item_id: 1 })]
    expect(hydrateDrafts(lines, [])).toBe(lines)
  })
})
