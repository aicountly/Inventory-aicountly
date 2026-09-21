import { describe, expect, it } from 'vitest'
import { duplicateDraft, duplicateItemForm, emptyItemForm, itemPayload, itemToForm, openingValue, openingsPayload, unitLinesPayload, validateItemForm } from './itemForm'
import type { Item } from '../../services/items'
import type { ItemFormState } from './itemForm'

describe('unitLinesPayload', () => {
  it('puts the base unit first and drops blank, repeated and invalid lines', () => {
    const lines = [
      { key: 'a', unit_id: '2', conversion_factor: '12', uom_role: 'purchase' },
      { key: 'b', unit_id: '', conversion_factor: '1', uom_role: '' },
      { key: 'c', unit_id: '2', conversion_factor: '24', uom_role: '' },
      { key: 'd', unit_id: '1', conversion_factor: '5', uom_role: '' },
      { key: 'e', unit_id: '3', conversion_factor: '0', uom_role: '' },
    ]
    expect(unitLinesPayload(lines, 1)).toEqual([
      { unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: 'base' },
      { unit_id: 2, is_default: 0, conversion_factor: 12, uom_role: 'purchase' },
    ])
  })
})

describe('openingsPayload', () => {
  it('keeps only rows with a unit and a non-zero quantity', () => {
    const rows = [
      { key: 'a', warehouse_id: '4', unit_id: '1', batch_id: '', opening_qty: '10', opening_valuation_rate: '2.5' },
      { key: 'b', warehouse_id: '', unit_id: '1', batch_id: '9', opening_qty: '0', opening_valuation_rate: '2.5' },
      { key: 'c', warehouse_id: '', unit_id: '', batch_id: '', opening_qty: '3', opening_valuation_rate: '' },
      { key: 'd', warehouse_id: '', unit_id: '2', batch_id: '', opening_qty: '-1', opening_valuation_rate: '' },
    ]
    expect(openingsPayload(rows)).toEqual([
      { warehouse_id: 4, unit_id: 1, batch_id: null, opening_qty: 10, opening_valuation_rate: 2.5 },
      { warehouse_id: null, unit_id: 2, batch_id: null, opening_qty: -1, opening_valuation_rate: 0 },
    ])
  })

  it('computes the row value to 4 decimals', () => {
    expect(openingValue('3', '1.33333')).toBe(4)
    expect(openingValue('', '5')).toBe(0)
  })
})

describe('itemPayload', () => {
  it('serialises a minimal item with its base unit line', () => {
    const f = { ...emptyItemForm('WAC'), item_name: ' Bolt ', unit_id: '1', hsn_sac: '7318ab', track_batch: true }
    const body = itemPayload(f)
    expect(body).toMatchObject({ item_name: 'Bolt', item_type: 'stock', unit_id: 1, hsn_sac: '7318AB', valuation_method: 'WAC', track_batch: 1, track_serial: 0, is_active: 1, item_grp_id: null, mrp: null })
    expect(body.unit_lines).toEqual([{ unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: 'base' }])
  })

  /**
   * The ITC attribute is a fact about the goods that Books resolves; Inventory only carries it. It
   * has to survive the form round trip exactly, and a new item has to say nothing rather than pick
   * a side — every item that predates the attribute reads as 'inherit', so Books decides as before.
   */
  it('carries the item ITC attribute, defaulting to saying nothing', () => {
    expect(emptyItemForm().itc_eligibility).toBe('inherit')
    expect(itemPayload({ ...emptyItemForm(), item_name: 'Bolt', unit_id: '1' }).itc_eligibility).toBe('inherit')
    expect(itemPayload({ ...emptyItemForm(), item_name: 'Company car', unit_id: '1', itc_eligibility: 'block' }).itc_eligibility).toBe('block')
    expect(itemPayload({ ...emptyItemForm(), item_name: 'Raw material', unit_id: '1', itc_eligibility: 'claim' }).itc_eligibility).toBe('claim')
  })
})

describe('validateItemForm', () => {
  it('requires a name and base unit and checks HSN and numbers', () => {
    const f = { ...emptyItemForm(), hsn_sac: '12', mrp: '-5', shelf_life_days: 'x' }
    expect(validateItemForm(f)).toEqual({ item_name: 'Item name is required', unit_id: 'Pick the base unit', hsn_sac: 'HSN/SAC must be 4 to 8 letters or digits', mrp: 'Cannot be negative', shelf_life_days: 'Must be a number' })
  })

  it('checks alternate units and opening rows', () => {
    const f = {
      ...emptyItemForm(),
      item_name: 'Bolt',
      unit_id: '1',
      unitLines: [
        { key: 'u1', unit_id: '1', conversion_factor: '2', uom_role: '' },
        { key: 'u2', unit_id: '2', conversion_factor: '0', uom_role: '' },
      ],
      openings: [{ key: 'o1', warehouse_id: '', unit_id: '', batch_id: '', opening_qty: '5', opening_valuation_rate: '' }],
    }
    expect(validateItemForm(f)).toEqual({
      'unitLines.u1': 'Alternate unit 1: same as the base unit',
      'unitLines.u2': 'Alternate unit 2: conversion must be greater than zero',
      'openings.o1': 'Opening 1: pick a unit',
    })
  })
})

describe('itemToForm', () => {
  it('maps an API item, its alternate units and the effective FY openings', () => {
    const item = {
      item_id: 1,
      item_name: 'Bolt',
      item_alias: null,
      print_name: 'Bolt',
      item_type: 'stock',
      item_sku: 'B-1',
      item_upc: null,
      hsn_sac: '7318',
      mrp: '12.5000',
      unit_id: 1,
      stock_cat_id: null,
      item_grp_id: 3,
      brand_id: null,
      valuation_method: 'fifo',
      track_batch: 1,
      track_serial: 0,
      track_expiry: 0,
      is_active: 1,
      updated_at: null,
      created_at: null,
      unit_symbol: 'Pcs',
      unit_name: 'Pieces',
      grp_name: 'Fasteners',
      cat_name: null,
      brand_name: null,
      purchase_unit_id: 2,
      sales_unit_id: null,
      parent_item_id: null,
      books_sales_acc_id: null,
      books_purchase_acc_id: null,
      books_tax_cat_id: null,
      shelf_life_days: null,
      negative_stock_policy: null,
      min_stock_qty: '10.0000',
      max_stock_qty: null,
      reorder_point_qty: null,
      reorder_qty: null,
      safety_stock_qty: null,
      lead_time_days: null,
      default_warehouse_id: null,
      standard_cost: null,
      itc_eligibility: 'block',
      attributes: null,
      variant_attributes: null,
      unit_lines: [
        { unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: 'base' },
        { unit_id: 2, is_default: 0, conversion_factor: 100, uom_role: 'purchase' },
      ],
      openings: [],
    } satisfies Item
    const openings = [
      { fy_id: 0, warehouse_id: 4, unit_id: 1, batch_id: null, opening_qty: '50.0000', opening_valuation_rate: '2.0000' },
      { fy_id: 31, warehouse_id: 4, unit_id: 1, batch_id: null, opening_qty: '60.0000', opening_valuation_rate: '2.1000' },
    ]
    const f = itemToForm(item, openings, 31)
    // The decimals are trimmed for the box the user types in: PostgreSQL returns all four of
    // NUMERIC(18,4), and `12.5000` is noise to edit around. `toNumber` reads either spelling, so
    // the payload is unchanged — see the `num` helper in itemForm.ts.
    expect(f).toMatchObject({ item_name: 'Bolt', unit_id: '1', purchase_unit_id: '2', valuation_method: 'FIFO', track_batch: true, mrp: '12.5', min_stock_qty: '10', item_grp_id: '3', itc_eligibility: 'block' })
    expect(f.unitLines).toHaveLength(1)
    expect(f.unitLines[0]).toMatchObject({ unit_id: '2', conversion_factor: '100', uom_role: 'purchase' })
    expect(f.openings).toHaveLength(1)
    expect(f.openings[0]).toMatchObject({ warehouse_id: '4', unit_id: '1', opening_qty: '60', opening_valuation_rate: '2.1' })
  })

  it('trims stored decimals without touching anything that is not one', () => {
    const base = {
      item_id: 1,
      item_name: 'Bolt',
      item_type: 'stock',
      unit_id: 1,
      is_active: 1,
      valuation_method: 'FIFO',
      itc_eligibility: 'inherit',
      unit_lines: [],
      openings: [],
      attributes: null,
    } as unknown as Item

    const trimmed = itemToForm({ ...base, mrp: '15.0000', standard_cost: '0.0833', safety_stock_qty: '100' } as Item, [], 0)
    expect(trimmed.mrp).toBe('15')
    // A real decimal keeps every digit that is not a trailing zero.
    expect(trimmed.standard_cost).toBe('0.0833')
    expect(trimmed.safety_stock_qty).toBe('100')

    // Null stays empty, and the round trip still reads as the same number.
    const empty = itemToForm({ ...base, mrp: null } as Item, [], 0)
    expect(empty.mrp).toBe('')
    expect(itemPayload(trimmed).mrp).toBe(15)
  })
})

describe('duplicateItemForm', () => {
  const source = {
    item_id: 7214,
    item_name: 'Steel Rod 12mm',
    item_alias: 'SR12',
    print_name: 'Steel Rod 12mm',
    item_type: 'stock',
    item_sku: 'SR-12',
    item_upc: '8901234567890',
    hsn_sac: '7214',
    mrp: '1234.5000',
    unit_id: 1,
    stock_cat_id: 2,
    item_grp_id: 3,
    brand_id: 4,
    valuation_method: 'fifo',
    track_batch: 1,
    track_serial: 0,
    track_expiry: 1,
    is_active: 0,
    updated_at: null,
    created_at: null,
    unit_symbol: 'Nos',
    unit_name: 'Numbers',
    grp_name: 'Raw material',
    cat_name: 'Metals',
    brand_name: 'Tata',
    purchase_unit_id: null,
    sales_unit_id: null,
    parent_item_id: null,
    books_sales_acc_id: null,
    books_purchase_acc_id: null,
    books_tax_cat_id: null,
    shelf_life_days: null,
    negative_stock_policy: null,
    min_stock_qty: '10.0000',
    max_stock_qty: null,
    reorder_point_qty: '20.0000',
    reorder_qty: null,
    safety_stock_qty: null,
    lead_time_days: null,
    default_warehouse_id: null,
    standard_cost: null,
    itc_eligibility: 'block',
    attributes: null,
    variant_attributes: null,
    unit_lines: [
      { unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: 'base' },
      { unit_id: 2, is_default: 0, conversion_factor: 100, uom_role: 'purchase' },
    ],
    openings: [],
  } satisfies Item

  it('keeps everything that makes two items alike', () => {
    const f = duplicateItemForm(source)
    expect(f).toMatchObject({
      item_type: 'stock',
      hsn_sac: '7214',
      mrp: '1234.5',
      item_grp_id: '3',
      stock_cat_id: '2',
      brand_id: '4',
      unit_id: '1',
      valuation_method: 'FIFO',
      track_batch: true,
      track_expiry: true,
      itc_eligibility: 'block',
      // itemToForm normalises the API's NUMERIC strings, so the copy carries
      // "10", not "10.0000".
      min_stock_qty: '10',
      reorder_point_qty: '20',
    })
    expect(f.unitLines).toHaveLength(1)
  })

  it('drops the identifiers, which belong to exactly one item', () => {
    // Copying them would either be refused by the API or, worse, accepted —
    // leaving two items answering the same scan.
    const f = duplicateItemForm(source)
    expect(f.item_sku).toBe('')
    expect(f.item_upc).toBe('')
  })

  it('never copies opening stock', () => {
    // Opening quantity is a statement about physical goods on a date. A copied
    // opening is stock that was never received, and the valuation engine would
    // faithfully cost it.
    expect(duplicateItemForm(source).openings).toEqual([])
  })

  it('renames the copy so it cannot be saved under the original name by accident', () => {
    expect(duplicateItemForm(source).item_name).toBe('Steel Rod 12mm (copy)')
  })

  it('is the same rule the item form\u2019s own Duplicate action applies', () => {
    /*
     * Two ways in — the form\u2019s Duplicate, which copies the draft on screen,
     * and the list\u2019s, which copies a saved record — and exactly one rule
     * behind them. Two copies of "what a duplicate drops" would drift, and the
     * thing that drifts is which fields are safe to carry.
     */
    // `key` is a render identity from a module counter, so it differs between
    // any two calls by design. Everything that reaches the API must not.
    const withoutKeys = (f: ItemFormState) => ({
      ...f,
      unitLines: f.unitLines.map(({ key: _k, ...rest }) => rest),
      openings: f.openings.map(({ key: _k, ...rest }) => rest),
    })
    const viaItem = duplicateItemForm(source)
    const viaDraft = duplicateDraft(itemToForm(source, [], 0))
    expect(withoutKeys(viaDraft)).toEqual(withoutKeys(viaItem))
  })

  it('gives the copy its own unit lines rather than the source\u2019s objects', () => {
    // Editing the copy must not reach back into the draft it came from.
    const form = itemToForm(source, [], 0)
    const copy = duplicateDraft(form)
    expect(copy.unitLines).toEqual(form.unitLines)
    copy.unitLines.forEach((line, i) => expect(line).not.toBe(form.unitLines[i]))
  })
})
