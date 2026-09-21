import { describe, expect, it } from 'vitest'
import {
  buildItemSuggestions,
  evaluateItemInsights,
  summariseInsights,
  worstLevel,
} from './inventoryAiService'
import type { ItemInsightInput, ItemSuggestionInput } from './inventoryAiService'

/** A draft that passes every rule, so each test can break exactly one thing. */
function healthy(over: Partial<ItemInsightInput> = {}): ItemInsightInput {
  return {
    itemId: 17859,
    itemName: 'Ballpoint Pens',
    itemType: 'stock',
    sku: 'BP-001',
    barcode: '8901234567890',
    hsnSac: '960810',
    mrp: 15,
    standardCost: 9,
    itemGroupId: '1',
    stockCategoryId: '2',
    brandId: '',
    baseUnitId: '3',
    alternateUnits: [{ unitId: '4', factor: 0.0833 }],
    valuationMethod: 'FIFO',
    trackBatch: false,
    trackSerial: false,
    trackExpiry: false,
    shelfLifeDays: null,
    negativeStockPolicy: 'block',
    minStockQty: 10,
    maxStockQty: 100,
    reorderPointQty: 25,
    defaultWarehouseId: '7',
    activeWarehouseIds: [7, 8],
    openings: [{ unitId: '3', qty: 5, rate: 9 }],
    hasDescription: true,
    ...over,
  }
}

const ids = (input: ItemInsightInput) => evaluateItemInsights(input).map((i) => i.id)

describe('evaluateItemInsights', () => {
  it('reports only passed checks for a well-configured item', () => {
    const result = evaluateItemInsights(healthy())
    expect(result.every((i) => i.level === 'ok')).toBe(true)
    expect(ids(healthy())).toEqual(['hsn-ok', 'classification-ok', 'base-unit-ok', 'valuation-ok'])
  })

  /**
   * Shape only. A code that is 4-8 alphanumerics passes whatever it means, because what it means
   * is Books' question — the rule that would "validate" an HSN against a product is the one this
   * service must never grow.
   */
  it('checks HSN for shape, not for meaning', () => {
    expect(ids(healthy({ hsnSac: '12' }))).toContain('hsn-shape')
    expect(ids(healthy({ hsnSac: '' }))).toContain('hsn-missing')
    // A perfectly-shaped code for an unrelated commodity is still accepted.
    expect(ids(healthy({ hsnSac: '0101' }))).toContain('hsn-ok')
  })

  it('flags an expiry tracked without batches as critical', () => {
    const found = evaluateItemInsights(healthy({ trackExpiry: true, trackBatch: false }))
    expect(found.find((i) => i.id === 'expiry-without-batch')?.level).toBe('critical')
  })

  it('asks for a shelf life when expiry is tracked on batches', () => {
    expect(ids(healthy({ trackExpiry: true, trackBatch: true, shelfLifeDays: null }))).toContain('shelf-life-missing')
    expect(ids(healthy({ trackExpiry: true, trackBatch: true, shelfLifeDays: 180 }))).not.toContain('shelf-life-missing')
  })

  it('flags MRP below standard cost, and a thin margin above it', () => {
    expect(ids(healthy({ mrp: 5, standardCost: 9 }))).toContain('mrp-below-cost')
    expect(ids(healthy({ mrp: 10, standardCost: 9.7 }))).toContain('margin-thin')
    expect(ids(healthy({ mrp: 15, standardCost: 9 }))).not.toContain('margin-thin')
  })

  it('says nothing about price when either figure is absent', () => {
    const none = ids(healthy({ mrp: null, standardCost: null }))
    expect(none).not.toContain('mrp-below-cost')
    expect(none).not.toContain('margin-thin')
  })

  it('catches a default warehouse that is not in the company', () => {
    expect(ids(healthy({ defaultWarehouseId: '99' }))).toContain('warehouse-inactive')
    // With no warehouse list loaded yet, it accuses nothing.
    expect(ids(healthy({ defaultWarehouseId: '99', activeWarehouseIds: [] }))).not.toContain('warehouse-inactive')
  })

  it('catches duplicate, base-repeating and unusable alternate units', () => {
    expect(ids(healthy({ alternateUnits: [{ unitId: '4', factor: 0 }] }))).toContain('conversion-invalid')
    expect(
      ids(healthy({ alternateUnits: [{ unitId: '4', factor: 2 }, { unitId: '4', factor: 3 }] })),
    ).toContain('conversion-duplicate')
    expect(ids(healthy({ alternateUnits: [{ unitId: '3', factor: 2 }] }))).toContain('conversion-base')
  })

  it('holds stock rules back for service and non-stock items', () => {
    const service = ids(healthy({ itemType: 'service', trackExpiry: true, trackBatch: false, negativeStockPolicy: 'allow' }))
    expect(service).not.toContain('expiry-without-batch')
    expect(service).not.toContain('negative-allowed')
  })

  it('flags min above max', () => {
    expect(ids(healthy({ minStockQty: 100, maxStockQty: 10 }))).toContain('min-above-max')
  })
})

describe('summariseInsights', () => {
  it('takes the worst level and puts it first', () => {
    const insights = evaluateItemInsights(healthy({ hsnSac: '12', sku: '' }))
    const result = summariseInsights(insights)
    expect(result.status).toBe('critical')
    expect(result.insights[0].level).toBe('critical')
    expect(result.headline).toBe('Configuration issue detected')
    expect(result.source).toBe('rules')
  })

  it('reads as healthy only when nothing else is present', () => {
    expect(worstLevel([{ id: 'a', level: 'ok', message: '' }])).toBe('ok')
    expect(worstLevel([{ id: 'a', level: 'ok', message: '' }, { id: 'b', level: 'warn', message: '' }])).toBe('warn')
    expect(summariseInsights(evaluateItemInsights(healthy())).headline).toBe('Looks good!')
  })
})

function draft(over: Partial<ItemSuggestionInput> = {}): ItemSuggestionInput {
  return {
    itemName: 'Ballpoint Pens',
    printName: '',
    alias: '',
    sku: '',
    description: '',
    tags: [],
    groupName: 'General',
    categoryName: 'Raw Material',
    brandName: null,
    unitName: 'Dozen',
    itemType: 'stock',
    minStockQty: 10,
    safetyStockQty: null,
    reorderPointQty: null,
    ...over,
  }
}

describe('buildItemSuggestions', () => {
  it('derives every empty field from what the item already says', () => {
    const found = buildItemSuggestions(draft())
    const byField = Object.fromEntries(found.map((s) => [s.field, s.suggested]))
    expect(byField.print_name).toBe('Ballpoint Pens')
    expect(byField.item_alias).toBe('Pens')
    expect(byField.item_sku).toBe('BAL-PEN')
    expect(byField.tags).toBe('General, Raw Material')
    expect(byField.description).toContain('Ballpoint Pens')
    expect(byField.reorder_point_qty).toBe('12')
  })

  /** Suggesting over a value a person typed is the one thing "suggest" must never mean. */
  it('leaves a field alone once it holds a value', () => {
    const found = buildItemSuggestions(
      draft({ printName: 'Pen', alias: 'BP', sku: 'X-1', description: 'Mine', tags: ['Office'], reorderPointQty: 5 }),
    )
    expect(found).toEqual([])
  })

  it('never proposes an HSN or any other tax classification', () => {
    const fields = buildItemSuggestions(draft()).map((s) => s.field)
    expect(fields).not.toContain('hsn_sac')
    expect(fields.every((f) => !f.includes('hsn') && !f.includes('tax') && !f.includes('itc'))).toBe(true)
  })

  it('suggests nothing at all without a name to work from', () => {
    expect(buildItemSuggestions(draft({ itemName: '   ' }))).toEqual([])
  })

  it('falls back to safety stock when there is no minimum', () => {
    const found = buildItemSuggestions(draft({ minStockQty: null, safetyStockQty: 50 }))
    expect(found.find((s) => s.field === 'reorder_point_qty')?.suggested).toBe('60')
  })
})
