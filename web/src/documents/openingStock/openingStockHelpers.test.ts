import { describe, expect, it } from 'vitest'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import { parseCsv, csvRecords } from '../../utils/csv'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import {
  IMPORT_TEMPLATE_COLUMNS,
  buildImportRow,
  buildImportTemplateCsv,
  buildValidationReport,
  duplicateSignatureIndexes,
  findDuplicateLineKeys,
  importRowNotes,
  importRowStatus,
  lineFromImportRow,
  lineFromItemRow,
  lineFromStockBalance,
  matchItemFromSearch,
  matchWarehouseByName,
} from './openingStockHelpers'

const SPEC = specForCode('OPENING_STOCK')!

function item(overrides: Partial<ItemSearchRow> = {}): ItemSearchRow {
  return {
    item_id: 1,
    item_name: 'Bolt 8mm',
    item_alias: null,
    print_name: null,
    item_sku: 'BOLT-8',
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 10,
    unit_symbol: 'PCS',
    track_batch: 0,
    track_serial: 0,
    valuation_method: 'FIFO',
    default_warehouse_id: null,
    units: [],
    ...overrides,
  }
}

function warehouse(overrides: Partial<FormOptionWarehouse> = {}): FormOptionWarehouse {
  return {
    warehouse_id: 1,
    warehouse_name: 'Main',
    warehouse_code: 'MAIN',
    warehouse_type: 'general',
    is_default: 1,
    bo_id: 0,
    ...overrides,
  }
}

function balanceRow(overrides: Partial<StockBalanceGridRow> = {}): StockBalanceGridRow {
  return {
    balance_id: 1,
    cmp_id: 1,
    item_id: 1,
    warehouse_id: 1,
    batch_id: null,
    on_hand_qty: 10,
    reserved_qty: 0,
    committed_qty: 0,
    packed_qty: 0,
    in_transit_qty: 0,
    job_worker_qty: 0,
    quality_hold_qty: 0,
    damaged_qty: 0,
    blocked_qty: 0,
    expected_qty: 0,
    last_movement_at: null,
    item_name: 'Bolt 8mm',
    item_sku: 'BOLT-8',
    warehouse_name: 'Main',
    batch_no: null,
    available_qty: 10,
    ...overrides,
  }
}

describe('buildImportTemplateCsv', () => {
  it('writes exactly the documented header columns and no data rows', () => {
    const parsed = parseCsv(buildImportTemplateCsv())
    expect(parsed.headers).toEqual([...IMPORT_TEMPLATE_COLUMNS])
    expect(parsed.rows).toEqual([])
  })
})

describe('matchWarehouseByName', () => {
  const warehouses = [warehouse({ warehouse_id: 1, warehouse_name: 'Main', warehouse_code: 'MAIN' }), warehouse({ warehouse_id: 2, warehouse_name: 'Depot B', warehouse_code: 'DEP-B' })]

  it('matches by name or code, case-insensitively', () => {
    expect(matchWarehouseByName('main', warehouses)).toBe(1)
    expect(matchWarehouseByName('DEP-B', warehouses)).toBe(2)
  })

  it('returns null for a blank name or no match', () => {
    expect(matchWarehouseByName('', warehouses)).toBeNull()
    expect(matchWarehouseByName('Nowhere', warehouses)).toBeNull()
  })
})

describe('matchItemFromSearch', () => {
  const rows = [item({ item_id: 1, item_sku: 'BOLT-8', item_name: 'Bolt 8mm' }), item({ item_id: 2, item_sku: 'BOLT-10', item_name: 'Bolt 10mm' })]

  it('prefers an exact SKU match', () => {
    expect(matchItemFromSearch(rows, 'bolt-10', 'whatever')?.item_id).toBe(2)
  })

  it('falls back to an exact name match when the code misses', () => {
    expect(matchItemFromSearch(rows, 'nope', 'Bolt 8mm')?.item_id).toBe(1)
  })

  it('accepts a lone search hit when neither matches exactly', () => {
    expect(matchItemFromSearch([rows[0]], 'nope', 'nope')?.item_id).toBe(1)
  })

  it('gives up when nothing matches and more than one row came back', () => {
    expect(matchItemFromSearch(rows, 'nope', 'nope')).toBeNull()
  })
})

describe('buildImportRow', () => {
  const warehouses = [warehouse({ warehouse_id: 1, warehouse_name: 'Main' }), warehouse({ warehouse_id: 2, warehouse_name: 'Depot' })]

  it('reads a well-formed row and resolves its named warehouse', () => {
    const [record] = csvRecords(parseCsv('Item Code,Warehouse,Quantity,Rate\nBOLT-8,Depot,10,25.5\n'))
    const row = buildImportRow(record, 1, warehouses, 1)
    expect(row).toMatchObject({ itemCode: 'BOLT-8', warehouseId: 2, quantity: 10, rate: 25.5, errors: [], warnings: [] })
  })

  it('falls back to the default warehouse and warns when the named one is unknown', () => {
    const [record] = csvRecords(parseCsv('Item Code,Warehouse,Quantity\nBOLT-8,Nowhere,10\n'))
    const row = buildImportRow(record, 1, warehouses, 1)
    expect(row.warehouseId).toBe(1)
    expect(row.warnings).toEqual(['Warehouse "Nowhere" was not found — using the default warehouse.'])
  })

  it('flags a row with neither item code nor name, and a non-positive quantity', () => {
    const [record] = csvRecords(parseCsv('Item Code,Quantity\n,0\n'))
    const row = buildImportRow(record, 1, warehouses, 1)
    expect(row.errors).toEqual(expect.arrayContaining(['No item code or item name.', 'Quantity must be greater than zero.']))
  })

  it('warns when no warehouse can be resolved at all', () => {
    const [record] = csvRecords(parseCsv('Item Code,Quantity\nBOLT-8,10\n'))
    const row = buildImportRow(record, 1, warehouses, null)
    expect(row.warehouseId).toBeNull()
    expect(row.warnings).toContain('No warehouse resolved — set a Default Warehouse or add one to the file.')
  })
})

describe('importRowStatus', () => {
  it('is error, then unresolved, then ok, in that priority', () => {
    expect(importRowStatus({ errors: ['x'], item: item() })).toBe('error')
    expect(importRowStatus({ errors: [], item: null })).toBe('unresolved')
    expect(importRowStatus({ errors: [], item: item() })).toBe('ok')
  })
})

describe('importRowNotes', () => {
  it('names what a batch/serial/expiry column could not apply automatically', () => {
    const notes = importRowNotes({ batchNo: 'B1', serialNumbers: 'SN1,SN2', expiryDate: '2027-01-01', item: item({ track_batch: 1, track_serial: 1 }) })
    expect(notes).toHaveLength(3)
  })

  it('says nothing when the item does not track what the column named', () => {
    expect(importRowNotes({ batchNo: 'B1', serialNumbers: '', expiryDate: '', item: item({ track_batch: 0 }) })).toEqual([])
  })
})

describe('lineFromItemRow / lineFromImportRow / lineFromStockBalance', () => {
  it('builds a draft line from a picked item, defaulting to the header warehouse', () => {
    const line = lineFromItemRow(SPEC, 7, item())
    expect(line.item_id).toBe(1)
    expect(line.warehouse_id).toBe(7)
    expect(line.direction).toBe('in')
  })

  it('prefers the item default warehouse over the header one', () => {
    const line = lineFromItemRow(SPEC, 7, item({ default_warehouse_id: 3 }))
    expect(line.warehouse_id).toBe(3)
  })

  it('returns null for an import row with no resolved item', () => {
    expect(lineFromImportRow(SPEC, null, { rowNumber: 1, itemCode: 'X', itemName: '', warehouseName: '', batchNo: '', serialNumbers: '', unitSymbol: '', expiryDate: '', narration: '', quantity: 1, rate: 1, warehouseId: null, item: null, errors: [], warnings: [] })).toBeNull()
  })

  it('carries quantity, rate and amount from the file onto the line', () => {
    const line = lineFromImportRow(SPEC, null, {
      rowNumber: 1,
      itemCode: 'BOLT-8',
      itemName: '',
      warehouseName: '',
      batchNo: '',
      serialNumbers: '',
      unitSymbol: '',
      expiryDate: '',
      narration: 'from CSV',
      quantity: 4,
      rate: 12.5,
      warehouseId: 2,
      item: item(),
      errors: [],
      warnings: [],
    })
    expect(line).toMatchObject({ qty: '4', rate: '12.5', amount: '50', warehouse_id: 2, description: 'from CSV' })
  })

  it('maps a stock-balance row using the resolved item for units, and its own qty/warehouse/batch', () => {
    const line = lineFromStockBalance(SPEC, balanceRow({ on_hand_qty: 42, batch_id: 9, batch_no: 'B-9' }), item({ item_id: 1 }))
    expect(line).toMatchObject({ item_id: 1, qty: '42', warehouse_id: 1, batch_id: 9, batch_no: 'B-9' })
  })
})

describe('duplicateSignatureIndexes / findDuplicateLineKeys', () => {
  it('flags every index sharing a signature, first occurrence included', () => {
    const dups = duplicateSignatureIndexes(['a', 'b', 'a', 'c'], (v) => v)
    expect(dups).toEqual(new Set([0, 2]))
  })

  it('never matches null signatures against each other', () => {
    expect(duplicateSignatureIndexes([null, null], (v) => v)).toEqual(new Set())
  })

  it('flags draft lines sharing item + warehouse + batch', () => {
    const l1 = newLine(SPEC, { item_id: 1, warehouse_id: 1, qty: '5' })
    const l2 = newLine(SPEC, { item_id: 1, warehouse_id: 1, qty: '3' })
    const l3 = newLine(SPEC, { item_id: 2, warehouse_id: 1, qty: '1' })
    const keys = findDuplicateLineKeys([l1, l2, l3])
    expect(keys).toEqual(new Set([l1.key, l2.key]))
  })
})

describe('buildValidationReport', () => {
  const warehouses = [warehouse({ warehouse_id: 1 }), warehouse({ warehouse_id: 2 })]

  it('surfaces validateDraft errors untouched when the draft is empty', () => {
    const header = newHeader(SPEC, '2026-04-01')
    const report = buildValidationReport(header, [], SPEC, warehouses)
    expect(report.errors.length).toBeGreaterThan(0)
  })

  it('warns about a duplicate combination and a zero-rate line, and suggests a default warehouse', () => {
    const header = { ...newHeader(SPEC, '2026-04-01'), default_warehouse_id: null }
    const l1 = newLine(SPEC, { item_id: 1, warehouse_id: 1, qty: '5', rate: '0' })
    const l2 = newLine(SPEC, { item_id: 1, warehouse_id: 1, qty: '3', rate: '10' })
    const report = buildValidationReport(header, [l1, l2], SPEC, warehouses)
    expect(report.warnings.some((w) => w.includes('Duplicate item'))).toBe(true)
    expect(report.warnings.some((w) => w.includes('rate is 0'))).toBe(true)
    expect(report.suggestions.some((s) => s.includes('Default Warehouse'))).toBe(true)
  })

  it('is quiet on a clean, fully-priced, unique draft', () => {
    const header = { ...newHeader(SPEC, '2026-04-01'), default_warehouse_id: 1 }
    const line = newLine(SPEC, { item_id: 1, warehouse_id: 1, qty: '5', rate: '10' })
    const report = buildValidationReport(header, [line], SPEC, warehouses)
    expect(report).toEqual({ errors: [], warnings: [], suggestions: [] })
  })
})
