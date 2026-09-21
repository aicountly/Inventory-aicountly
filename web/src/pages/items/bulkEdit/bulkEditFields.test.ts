import { describe, expect, it } from 'vitest'
import type { ItemFormOptions, ItemListRow } from '../../../services/items'
import {
  BULK_EDIT_FIELDS,
  checkNewValue,
  currentValueKey,
  fieldChoices,
  findBulkField,
  formatCurrentValue,
  isReadOnlyField,
  suggestNormalizedValue,
  toPayloadValue,
} from './bulkEditFields'

/**
 * The field allowlist and the rules around a typed value.
 *
 * Two of these matter more than the rest: HSN / SAC must stay unwritable from
 * Inventory (Books owns it, and the API refuses the write), and the "tidy up"
 * suggestion must stay a suggestion — it may never rewrite what was typed on
 * its own, because a code carries legal weight.
 */

function item(partial: Partial<ItemListRow> = {}): ItemListRow {
  return {
    item_id: 1,
    item_name: 'Copper Wire',
    item_alias: null,
    print_name: null,
    item_type: 'stock',
    item_sku: null,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    stock_cat_id: null,
    item_grp_id: null,
    brand_id: null,
    valuation_method: 'FIFO',
    track_batch: 0,
    track_serial: 0,
    track_expiry: 0,
    is_active: 1,
    updated_at: '2026-06-12 09:12:00',
    created_at: '2026-01-01 10:00:00',
    unit_symbol: 'Pcs',
    unit_name: 'Pieces',
    grp_name: null,
    cat_name: null,
    brand_name: null,
    ...partial,
  }
}

const options: ItemFormOptions = {
  item_groups: [{ item_grp_id: 5, grp_name: 'Raw Materials', grp_alias: null, is_primary: 1, parent_grp_id: null }],
  stock_categories: [{ stock_cat_id: 2, cat_name: 'Metals', cat_alias: null }],
  brands: [{ brand_id: 8, brand_name: 'Finolex' }],
  units: [],
  warehouses: [],
  valuation_methods: ['FIFO'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: ['allow'],
  itc_eligibility_options: [],
}

describe('the allowlist', () => {
  it('offers nothing the API would refuse', () => {
    // ItemsController::BULK_EDITABLE, minus the ones this screen deliberately withholds.
    const serverSide = new Set([
      'hsn_sac', 'mrp', 'item_alias', 'print_name', 'item_grp_id', 'stock_cat_id', 'brand_id',
      'books_tax_cat_id', 'books_sales_acc_id', 'books_purchase_acc_id',
      'min_stock_qty', 'max_stock_qty', 'reorder_point_qty', 'reorder_qty', 'is_active',
    ])
    for (const field of BULK_EDIT_FIELDS) expect(serverSide.has(field.key)).toBe(true)
  })

  it('keeps the valuation method, units and tracking out of reach', () => {
    const keys = BULK_EDIT_FIELDS.map((f) => f.key) as string[]
    for (const forbidden of ['valuation_method', 'unit_id', 'track_batch', 'track_serial']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('falls back to a real field when the URL names one that does not exist', () => {
    expect(findBulkField('nonsense').key).toBe('hsn_sac')
    expect(findBulkField(undefined).key).toBe('hsn_sac')
    expect(findBulkField('brand_id').key).toBe('brand_id')
  })
})

describe('HSN / SAC is read-only in Inventory', () => {
  it('is marked as owned by Books', () => {
    const hsn = findBulkField('hsn_sac')
    expect(isReadOnlyField(hsn)).toBe(true)
    expect(hsn.ownerNote).toMatch(/Smart Books/)
  })

  it('refuses any value, including one that is perfectly well formed', () => {
    const check = checkNewValue(findBulkField('hsn_sac'), '12345678')
    expect(check.blocking).toBe(true)
    expect(check.message).toMatch(/Smart Books/)
  })

  it('does not mark the other fields as owned', () => {
    for (const field of BULK_EDIT_FIELDS.filter((f) => f.key !== 'hsn_sac')) {
      expect(isReadOnlyField(field)).toBe(false)
    }
  })
})

describe('checking a value', () => {
  const group = findBulkField('item_grp_id')
  const mrp = findBulkField('mrp')
  const status = findBulkField('is_active')

  it('lets a clearable field be blanked, and says what blanking does', () => {
    const check = checkNewValue(mrp, '   ')
    expect(check.blocking).toBe(false)
    expect(check.level).toBe('empty')
    expect(check.message).toMatch(/clears mrp/i)
  })

  it('will not let status be left unset — there is no empty status', () => {
    expect(checkNewValue(status, '').blocking).toBe(true)
  })

  it('rejects a number that is not one, and a negative quantity', () => {
    expect(checkNewValue(mrp, 'abc').blocking).toBe(true)
    expect(checkNewValue(findBulkField('min_stock_qty'), '-2').blocking).toBe(true)
    expect(checkNewValue(mrp, '249.50').blocking).toBe(false)
  })

  it('needs a real option for a picker', () => {
    expect(checkNewValue(group, '0').blocking).toBe(true)
    expect(checkNewValue(group, '5').blocking).toBe(false)
  })
})

describe('the tidy-up suggestion', () => {
  it('offers the separator-free form of a code without applying it', () => {
    // The field is read-only, but the rule itself is the one the mock asks for.
    const hsn = findBulkField('hsn_sac')
    expect(suggestNormalizedValue(hsn, '1234 5678')).toBe('12345678')
    expect(suggestNormalizedValue(hsn, '1234-5678')).toBe('12345678')
  })

  it('offers nothing when there is nothing to tidy', () => {
    expect(suggestNormalizedValue(findBulkField('hsn_sac'), '12345678')).toBeNull()
    expect(suggestNormalizedValue(findBulkField('mrp'), '249')).toBeNull()
  })

  it('strips what a spreadsheet adds to a number', () => {
    expect(suggestNormalizedValue(findBulkField('mrp'), '₹ 1,250.00')).toBe('1250.00')
  })

  it('never invents a value for an empty box', () => {
    expect(suggestNormalizedValue(findBulkField('hsn_sac'), '')).toBeNull()
    expect(suggestNormalizedValue(findBulkField('hsn_sac'), '   ')).toBeNull()
  })
})

describe('reading what an item holds', () => {
  it('reads an id as an id and a name as a name', () => {
    const row = item({ item_grp_id: 5, grp_name: 'Raw Materials' })
    const field = findBulkField('item_grp_id')
    expect(currentValueKey(row, field)).toBe('5')
    expect(formatCurrentValue(row, field, options)).toBe('Raw Materials')
  })

  it('shows a dangling reference rather than pretending the item has nothing', () => {
    const row = item({ item_grp_id: 99 })
    expect(formatCurrentValue(row, findBulkField('item_grp_id'), options)).toBe('#99')
  })

  it('renders a missing value as an em dash, never a blank cell', () => {
    expect(formatCurrentValue(item(), findBulkField('mrp'), options)).toBe('—')
    expect(currentValueKey(item(), findBulkField('mrp'))).toBe('')
  })

  it('reads status off the is_active flag', () => {
    expect(formatCurrentValue(item({ is_active: 0 }), findBulkField('is_active'), options)).toBe('Inactive')
    expect(currentValueKey(item({ is_active: 0 }), findBulkField('is_active'))).toBe('0')
  })
})

describe('what goes on the wire', () => {
  it('sends null to clear an optional field', () => {
    expect(toPayloadValue(findBulkField('mrp'), '')).toBeNull()
    expect(toPayloadValue(findBulkField('brand_id'), '')).toBeNull()
  })

  it('sends numbers as numbers and status as the API 1 / 0', () => {
    expect(toPayloadValue(findBulkField('mrp'), ' 249.5 ')).toBe(249.5)
    expect(toPayloadValue(findBulkField('brand_id'), '8')).toBe(8)
    expect(toPayloadValue(findBulkField('is_active'), '0')).toBe(0)
    expect(toPayloadValue(findBulkField('is_active'), '1')).toBe(1)
  })
})

describe('picker choices', () => {
  it('comes from the live form options, not a hardcoded list', () => {
    expect(fieldChoices(findBulkField('brand_id'), options)).toEqual([{ value: '8', label: 'Finolex' }])
    expect(fieldChoices(findBulkField('brand_id'), null)).toEqual([])
  })

  it('offers exactly two statuses', () => {
    expect(fieldChoices(findBulkField('is_active'), null).map((c) => c.label)).toEqual(['Active', 'Inactive'])
  })
})
