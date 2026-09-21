import { describe, expect, it } from 'vitest'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { DEFAULT_COLUMN_ORDER, itemKey, itemTokensOf, parseDirection, parseGrid, resolveRows, splitRows } from './excelPaste'

const WAREHOUSES: FormOptionWarehouse[] = [
  { warehouse_id: 5, warehouse_name: 'Main', warehouse_code: 'WH-MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 6, warehouse_name: 'Store 2', warehouse_code: 'WH2', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

function item(partial: Partial<ItemSearchRow> = {}): ItemSearchRow {
  return {
    item_id: 1,
    item_name: 'Widget',
    item_alias: null,
    print_name: null,
    item_sku: 'ITEM-001',
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: null,
    units: [],
    ...partial,
  }
}

const ctx = (items: [string, ItemSearchRow][] = [['item-001', item()]], defaultWarehouseId: number | null = 5) => ({
  warehouses: WAREHOUSES,
  defaultWarehouseId,
  items: new Map(items),
})

describe('splitRows', () => {
  it('prefers tabs, which is what a spreadsheet puts on the clipboard', () => {
    expect(splitRows('a\tb\tc')).toEqual([['a', 'b', 'c']])
  })

  it('falls back to commas and honours quoted fields', () => {
    expect(splitRows('ITEM-001,Main,"Damaged, badly"')).toEqual([['ITEM-001', 'Main', 'Damaged, badly']])
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(splitRows('a,"say ""hi""",b')).toEqual([['a', 'say "hi"', 'b']])
  })

  it('drops blank lines and normalises CRLF', () => {
    expect(splitRows('a\tb\r\n\r\nc\td')).toEqual([['a', 'b'], ['c', 'd']])
  })
})

describe('parseGrid', () => {
  it('recognises a header row and maps its columns by name', () => {
    const grid = parseGrid('Item Code\tWarehouse\tQty\tDirection\nITEM-001\tMain\t10\tOut')
    expect(grid.hadHeader).toBe(true)
    expect(grid.rows).toEqual([['ITEM-001', 'Main', '10', 'Out']])
    expect(grid.columns.item).toBe(0)
    expect(grid.columns.qty).toBe(2)
    expect(grid.columns.direction).toBe(3)
  })

  it('falls back to the documented column order without a header', () => {
    const grid = parseGrid('ITEM-001\tMain\t\tOut\t10\t120\tDamaged')
    expect(grid.hadHeader).toBe(false)
    DEFAULT_COLUMN_ORDER.forEach((col, i) => expect(grid.columns[col]).toBe(i))
  })

  it('does not mistake a single recognisable word for a header', () => {
    expect(parseGrid('Qty\nITEM-001').hadHeader).toBe(false)
  })

  it('collects each distinct item token once', () => {
    const grid = parseGrid('ITEM-001\tMain\t\tOut\t1\nITEM-001\tMain\t\tIn\t2\nITEM-002\tMain\t\tIn\t3')
    expect(itemTokensOf(grid)).toEqual(['ITEM-001', 'ITEM-002'])
  })
})

describe('parseDirection', () => {
  it('reads the words people actually type', () => {
    expect(parseDirection('Out')).toBe('out')
    expect(parseDirection('ISSUE')).toBe('out')
    expect(parseDirection('in')).toBe('in')
    expect(parseDirection('receipt')).toBe('in')
    expect(parseDirection('sideways')).toBeNull()
    expect(parseDirection('')).toBeNull()
  })
})

describe('resolveRows', () => {
  it('resolves a complete row', () => {
    const result = resolveRows(parseGrid('ITEM-001\tMain\t\tOut\t10\t120\tDamaged'), ctx())
    expect(result.errorCount).toBe(0)
    const row = result.rows[0]
    expect(row.item?.item_id).toBe(1)
    expect(row.warehouseId).toBe(5)
    expect(row.direction).toBe('out')
    expect(row.qty).toBe('10')
    expect(row.rate).toBe('120')
    expect(row.remarks).toBe('Damaged')
  })

  it('matches a warehouse by code as well as by name', () => {
    expect(resolveRows(parseGrid('ITEM-001\tWH2\t\tOut\t1'), ctx()).rows[0].warehouseId).toBe(6)
  })

  it('reports — and never silently drops — a row it cannot resolve', () => {
    const result = resolveRows(parseGrid('NOPE\tMain\t\tOut\t1\nITEM-001\tMain\t\tOut\t2'), ctx())
    expect(result.rows).toHaveLength(2)
    expect(result.okCount).toBe(1)
    expect(result.errorCount).toBe(1)
    expect(result.rows[0].errors[0]).toContain('No item matches "NOPE"')
  })

  it('rejects a non-numeric or non-positive quantity', () => {
    const rows = resolveRows(parseGrid('ITEM-001\tMain\t\tOut\tlots\nITEM-001\tMain\t\tOut\t0'), ctx()).rows
    expect(rows[0].errors[0]).toContain('not a number')
    expect(rows[1].errors[0]).toContain('greater than zero')
  })

  it('rejects an unknown warehouse rather than quietly using the default', () => {
    const row = resolveRows(parseGrid('ITEM-001\tNowhere\t\tOut\t1'), ctx()).rows[0]
    expect(row.warehouseId).toBeNull()
    expect(row.errors[0]).toContain('No warehouse matches "Nowhere"')
  })

  it('falls back to the header warehouse and says so', () => {
    const row = resolveRows(parseGrid('ITEM-001\t\t\tOut\t1'), ctx()).rows[0]
    expect(row.warehouseId).toBe(5)
    expect(row.notes.join(' ')).toContain('header default')
  })

  it('refuses a blank warehouse when there is no default either', () => {
    const row = resolveRows(parseGrid('ITEM-001\t\t\tOut\t1'), ctx([['item-001', item()]], null)).rows[0]
    expect(row.errors[0]).toContain('no default warehouse')
  })

  it('defaults a missing direction to Out and flags it as an assumption', () => {
    const row = resolveRows(parseGrid('ITEM-001\tMain\t\t\t5'), ctx()).rows[0]
    expect(row.direction).toBe('out')
    expect(row.notes.join(' ')).toContain('defaulted to Out')
  })

  it('rejects a direction it cannot read instead of guessing', () => {
    const row = resolveRows(parseGrid('ITEM-001\tMain\t\tmaybe\t5'), ctx()).rows[0]
    expect(row.errors.join(' ')).toContain('is not a direction')
  })

  it('tells the user a tracked item still needs its batch or serials picked', () => {
    const tracked = item({ track_batch: 1 })
    const row = resolveRows(parseGrid('ITEM-001\tMain\t\tOut\t5'), ctx([['item-001', tracked]])).rows[0]
    expect(row.errors).toEqual([])
    expect(row.notes.join(' ')).toContain('Batch tracked')
  })

  it('numbers rows against the sheet, counting the header', () => {
    const withHeader = resolveRows(parseGrid('Item\tQty\nITEM-001\t5'), ctx())
    expect(withHeader.rows[0].rowNumber).toBe(2)
    const without = resolveRows(parseGrid('ITEM-001\tMain\t\tOut\t5'), ctx())
    expect(without.rows[0].rowNumber).toBe(1)
  })

  it('strips thousands separators and a currency symbol from the numbers', () => {
    const row = resolveRows(parseGrid('ITEM-001\tMain\t\tOut\t1,250\t₹1,200.50'), ctx()).rows[0]
    expect(row.qty).toBe('1250')
    expect(row.rate).toBe('1200.5')
  })
})

describe('itemKey', () => {
  it('ignores case and collapses whitespace', () => {
    expect(itemKey('  Blue  Widget ')).toBe('blue widget')
    expect(itemKey('ITEM-001')).toBe(itemKey('item-001'))
  })
})
