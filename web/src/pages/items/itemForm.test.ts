import { describe, expect, it } from 'vitest'
import { emptyItemForm, itemPayload, itemToForm, openingValue, openingsPayload, unitLinesPayload, validateItemForm } from './itemForm'
import type { Item } from '../../services/items'

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
    expect(f).toMatchObject({ item_name: 'Bolt', unit_id: '1', purchase_unit_id: '2', valuation_method: 'FIFO', track_batch: true, mrp: '12.5000', min_stock_qty: '10.0000', item_grp_id: '3' })
    expect(f.unitLines).toHaveLength(1)
    expect(f.unitLines[0]).toMatchObject({ unit_id: '2', conversion_factor: '100', uom_role: 'purchase' })
    expect(f.openings).toHaveLength(1)
    expect(f.openings[0]).toMatchObject({ warehouse_id: '4', unit_id: '1', opening_qty: '60.0000', opening_valuation_rate: '2.1000' })
  })
})
