import { describe, expect, it } from 'vitest'
import { emptyItemForm } from '../itemForm'
import type { ItemFormState } from '../itemForm'
import type { ItemFormOptions, ItemSearchRow } from '../../../services/items'
import {
  buildSuggestions,
  classifyDuplicates,
  computeCompleteness,
  deriveInsights,
  generateSku,
  hasBlockingDuplicate,
  skuToken,
  stepOfFieldKey,
  stepsWithErrors,
  suggestAlias,
} from './itemIntelligence'

const OPTIONS: ItemFormOptions = {
  item_groups: [
    { item_grp_id: 3, grp_name: 'Medicines', grp_alias: null, is_primary: 1, parent_grp_id: null },
    { item_grp_id: 4, grp_name: 'Stationery', grp_alias: null, is_primary: 1, parent_grp_id: null },
  ],
  stock_categories: [{ stock_cat_id: 7, cat_name: 'Tablet', cat_alias: null }],
  brands: [{ brand_id: 9, brand_name: 'Sunfeast' }],
  units: [
    { unit_id: 1, unit_name: 'Pieces', unit_symbol: 'Pcs', print_name: null, uqc_gst: null },
    { unit_id: 2, unit_name: 'Box', unit_symbol: 'Box', print_name: null, uqc_gst: null },
  ],
  warehouses: [],
  valuation_methods: ['FIFO', 'LIFO', 'WAC'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: ['allow', 'warn', 'block'],
  itc_eligibility_options: ['inherit', 'claim', 'block'],
}

const searchRow = (over: Partial<ItemSearchRow> = {}): ItemSearchRow => ({
  item_id: 1,
  item_name: 'Bolt M8',
  item_alias: null,
  print_name: null,
  item_sku: null,
  item_upc: null,
  hsn_sac: null,
  unit_id: 1,
  unit_symbol: 'Pcs',
  track_batch: 0,
  track_serial: 0,
  valuation_method: 'FIFO',
  default_warehouse_id: null,
  ...over,
})

const draft = (over: Partial<ItemFormState> = {}): ItemFormState => ({ ...emptyItemForm(), ...over })

describe('stepOfFieldKey', () => {
  it('routes plain fields, unit lines and openings to their step', () => {
    expect(stepOfFieldKey('item_name')).toBe('identity')
    expect(stepOfFieldKey('brand_id')).toBe('classification')
    expect(stepOfFieldKey('unit_id')).toBe('units')
    expect(stepOfFieldKey('unitLines.u4')).toBe('units')
    expect(stepOfFieldKey('openings.o2')).toBe('valuation')
    expect(stepOfFieldKey('shelf_life_days')).toBe('valuation')
    expect(stepOfFieldKey('nothing_known')).toBeNull()
  })

  it('collects the steps that carry an error', () => {
    expect([...stepsWithErrors({ item_name: 'Required', 'unitLines.u1': 'Bad' })].sort()).toEqual(['identity', 'units'])
  })
})

describe('computeCompleteness', () => {
  it('lets the two fields the API requires dominate the score', () => {
    expect(computeCompleteness(draft()).percent).toBe(0)
    // Name and base unit alone — every optional field still blank.
    expect(computeCompleteness(draft({ item_name: 'Bolt', unit_id: '1' })).percent).toBe(70)
  })

  it('never lets optional detail drag a saveable item below the mandatory score', () => {
    const minimal = computeCompleteness(draft({ item_name: 'Bolt', unit_id: '1', item_type: 'service' }))
    expect(minimal.percent).toBeGreaterThanOrEqual(70)
  })

  it('reaches 100 when the optional detail is filled too', () => {
    const full = draft({
      item_name: 'Bolt',
      unit_id: '1',
      item_grp_id: '3',
      item_sku: 'BLT-1',
      hsn_sac: '7318',
      mrp: '12',
      reorder_point_qty: '5',
    })
    expect(computeCompleteness(full).percent).toBe(100)
  })

  it('marks a group in error rather than merely incomplete', () => {
    const groups = computeCompleteness(draft({ item_name: 'Bolt' }), { unit_id: 'Pick the base unit' }).groups
    expect(groups.find((g) => g.id === 'units')?.state).toBe('error')
  })
})

describe('deriveInsights', () => {
  const ctx = { itemUnitIds: new Set(['1']), defaultValuationMethod: 'FIFO' }

  it('flags a shelf life with no batch tracking', () => {
    const ids = deriveInsights(draft({ shelf_life_days: '365' }), ctx).map((i) => i.id)
    expect(ids).toContain('shelf-no-batch')
  })

  it('flags expiry tracking without batches', () => {
    expect(deriveInsights(draft({ track_expiry: true }), ctx).map((i) => i.id)).toContain('expiry-no-batch')
  })

  it('flags an MRP below the standard cost', () => {
    expect(deriveInsights(draft({ mrp: '10', standard_cost: '25' }), ctx).map((i) => i.id)).toContain('mrp-below-cost')
    expect(deriveInsights(draft({ mrp: '30', standard_cost: '25' }), ctx).map((i) => i.id)).not.toContain('mrp-below-cost')
  })

  it('flags a purchase unit that the item has no conversion for', () => {
    const ids = deriveInsights(draft({ unit_id: '1', purchase_unit_id: '2' }), ctx).map((i) => i.id)
    expect(ids).toContain('purchase_unit_id-unconverted')
  })

  it('says nothing about tracking that is only used on stock items', () => {
    const ids = deriveInsights(draft({ item_type: 'service', track_batch: true }), ctx).map((i) => i.id)
    expect(ids).toContain('tracking-non-stock')
    // A service item has no reorder point to miss.
    expect(ids).not.toContain('no-reorder')
  })

  it('makes no claim about other businesses', () => {
    const texts = deriveInsights(draft({ item_name: 'Bolt', unit_id: '1', track_batch: true }), ctx).map((i) => i.text.toLowerCase())
    for (const text of texts) {
      expect(text).not.toMatch(/most (businesses|companies)|industry|sector|average|similar businesses/)
    }
  })
})

describe('suggestAlias / generateSku', () => {
  it('shortens a two-word name to its opening letters and its number', () => {
    expect(suggestAlias('Paracetamol 500mg')).toBe('PARA 500')
  })

  it('uses initials once a name runs to three words or more', () => {
    expect(suggestAlias('Blue Ink Pen')).toBe('BIP')
    expect(suggestAlias('')).toBe('')
  })

  it('strips a token to letters and digits', () => {
    expect(skuToken('Para-cetamol!', 4)).toBe('PARA')
  })

  it('builds a SKU from the classification, the name and the clock', () => {
    const form = draft({ item_name: 'Paracetamol 500mg', item_grp_id: '3' })
    expect(generateSku(form, OPTIONS, 0)).toBe('MED-PARA500-0000')
  })

  it('falls back to the brand, then to the name alone', () => {
    expect(generateSku(draft({ item_name: 'Bolt', brand_id: '9' }), OPTIONS, 0)).toBe('SUN-BOLT-0000')
    expect(generateSku(draft({ item_name: 'Bolt' }), OPTIONS, 0)).toBe('BOLT-0000')
  })
})

describe('buildSuggestions', () => {
  it('says nothing until the item has a name', () => {
    expect(buildSuggestions(draft(), { options: OPTIONS, similar: [] })).toEqual([])
  })

  it('proposes the masters this company already has whose name the item names', () => {
    const list = buildSuggestions(draft({ item_name: 'Sunfeast Medicines pack' }), { options: OPTIONS, similar: [], now: 0 })
    const byField = Object.fromEntries(list.map((s) => [s.field, s]))
    expect(byField.item_grp_id?.value).toBe('3')
    expect(byField.brand_id?.value).toBe('9')
    expect(byField.item_grp_id?.source).toContain('Medicines')
  })

  it('carries the current value so the drawer can show current → proposed', () => {
    const list = buildSuggestions(draft({ item_name: 'Medicines box', item_grp_id: '4' }), { options: OPTIONS, similar: [], now: 0 })
    const group = list.find((s) => s.field === 'item_grp_id')
    expect(group?.current).toBe('4')
    expect(group?.currentDisplay).toBe('Stationery')
    expect(group?.value).toBe('3')
  })

  it('borrows an HSN only from a real item in this company, and only into a blank field', () => {
    const similar = [searchRow({ item_id: 5, item_name: 'Bolt M8 galvanised', hsn_sac: '7318' })]
    const suggested = buildSuggestions(draft({ item_name: 'Bolt M8' }), { options: OPTIONS, similar, now: 0 })
    const hsn = suggested.find((s) => s.field === 'hsn_sac')
    expect(hsn?.value).toBe('7318')
    expect(hsn?.source).toContain('Bolt M8 galvanised')

    const alreadyFilled = buildSuggestions(draft({ item_name: 'Bolt M8', hsn_sac: '9999' }), { options: OPTIONS, similar, now: 0 })
    expect(alreadyFilled.find((s) => s.field === 'hsn_sac')).toBeUndefined()
  })

  it('never invents an HSN when no neighbour carries one', () => {
    const suggested = buildSuggestions(draft({ item_name: 'Bolt M8' }), { options: OPTIONS, similar: [searchRow()], now: 0 })
    expect(suggested.find((s) => s.field === 'hsn_sac')).toBeUndefined()
  })

  it('offers no SKU once the user has typed one', () => {
    const suggested = buildSuggestions(draft({ item_name: 'Bolt', item_sku: 'MINE-1' }), { options: OPTIONS, similar: [], now: 0 })
    expect(suggested.find((s) => s.field === 'item_sku')).toBeUndefined()
  })
})

describe('classifyDuplicates', () => {
  it('treats an exact name and an exact SKU as conflicts the API will refuse', () => {
    const rows = [searchRow({ item_id: 2, item_name: 'Bolt M8' }), searchRow({ item_id: 3, item_name: 'Nut M8', item_sku: 'NUT-8' })]
    const matches = classifyDuplicates(draft({ item_name: 'bolt m8', item_sku: 'nut-8' }), rows)
    expect(matches.map((m) => m.reason)).toEqual(['name', 'sku'])
    expect(hasBlockingDuplicate(matches)).toBe(true)
  })

  it('reports a shared barcode as a warning, not a conflict', () => {
    const rows = [searchRow({ item_id: 4, item_name: 'Something else', item_upc: '890123' })]
    const matches = classifyDuplicates(draft({ item_name: 'Fresh item', item_upc: '890123' }), rows)
    expect(matches[0].reason).toBe('barcode')
    expect(hasBlockingDuplicate(matches)).toBe(false)
  })

  it('never blocks on a merely similar name', () => {
    const rows = [searchRow({ item_id: 6, item_name: 'Bolt M8 galvanised' })]
    const matches = classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows)
    expect(matches[0].reason).toBe('similar')
    expect(hasBlockingDuplicate(matches)).toBe(false)
  })

  it('ignores the item being edited', () => {
    const rows = [searchRow({ item_id: 8, item_name: 'Bolt M8' })]
    expect(classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows, 8)).toEqual([])
  })
})
