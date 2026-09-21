import { describe, expect, it } from 'vitest'
import type { Bom, BomLine } from '../../../services/masters'
import { formatDateTime } from '../../../utils/format'
import { BOM_LINE_EXPORT_COLUMNS, BOM_LIST_EXPORT_COLUMNS, bomSheetMetaLines } from './bomExportColumns'

/**
 * The same guard `masters/realMasterExports.test.tsx` applies to the
 * config-driven masters, applied to the bill-of-materials sheet.
 *
 * Bills no longer render through `MasterPage`, so that file cannot reach them.
 * The defect it exists to catch is unchanged: a column whose cell is assembled
 * in React — the component chips, the status badge, the derived gross quantity
 * — exports a blank unless it resolves its own value, and a letterheaded PDF
 * with an empty column under a header promising a figure is a document that
 * contradicts the screen it was printed from.
 */

const BOM: Bom = {
  bom_id: 7,
  bom_code: 'BOM-007',
  bom_name: 'Office chair - standard',
  finished_item_id: 900,
  yield_qty: 1,
  yield_unit_id: 1,
  is_active: 1,
  finished_item_name: 'Office chair',
  finished_item_sku: 'ITM-CH-001',
  finished_item_group_name: 'Furniture',
  yield_unit_symbol: 'pc',
  line_count: 4,
  component_count: 3,
  updated_at: '2026-09-16 11:02:30',
  updated_by: 'u-1',
  updated_by_name: 'Rahul Gupta',
}

const LINE: BomLine = {
  bom_line_id: 1,
  item_id: 2,
  qty: 4,
  unit_id: 1,
  line_kind: 'component',
  scrap_percent: 2.5,
  sort_order: 0,
  item_name: 'Metal leg',
  item_sku: 'ITM-ML-001',
  unit_symbol: 'pc',
}

describe('the bill-of-materials sheet', () => {
  it('writes something for every column of a populated row', () => {
    const blanks = BOM_LIST_EXPORT_COLUMNS.filter((c) => {
      const value = c.csv?.(BOM)
      return value === undefined || value === null || value === ''
    })
    expect(blanks.map((c) => c.key)).toEqual([])
  })

  it('writes something for every column of a component line', () => {
    const blanks = BOM_LINE_EXPORT_COLUMNS.filter((c) => {
      const value = c.csv?.(LINE)
      return value === undefined || value === null || value === ''
    })
    expect(blanks.map((c) => c.key)).toEqual([])
  })

  it('reproduces what the screen shows for the computed cells', () => {
    const value = (key: string) => BOM_LIST_EXPORT_COLUMNS.find((c) => c.key === key)?.csv?.(BOM)
    expect(value('bom_code')).toBe('BOM-007')
    expect(value('component_count')).toBe(3)
    expect(value('is_active')).toBe('Active')
    expect(value('updated_by')).toBe('Rahul Gupta')
  })

  it('writes the yield as a number a spreadsheet can total, with the unit beside it', () => {
    const yieldCol = BOM_LIST_EXPORT_COLUMNS.find((c) => c.key === 'yield_qty')
    expect(yieldCol?.csv?.(BOM)).toBe(1)
    expect(yieldCol?.format).toBe('qty')
    expect(BOM_LIST_EXPORT_COLUMNS.find((c) => c.key === 'yield_unit_symbol')?.csv?.(BOM)).toBe('pc')
  })

  it('derives the gross quantity rather than exporting an empty column', () => {
    // 4 x (1 + 2.5%) = 4.1
    expect(BOM_LINE_EXPORT_COLUMNS.find((c) => c.key === 'gross_qty')?.csv?.(LINE)).toBe(4.1)
  })

  it('falls back to an id when a name is absent, never to a blank', () => {
    const nameless = { ...BOM, finished_item_name: null, updated_by_name: null }
    expect(BOM_LIST_EXPORT_COLUMNS.find((c) => c.key === 'finished_item_name')?.csv?.(nameless)).toBe('#900')
    expect(BOM_LIST_EXPORT_COLUMNS.find((c) => c.key === 'updated_by')?.csv?.(nameless)).toBe('u-1')
  })
})

describe('the printed BOM report header', () => {
  it('carries the reference, the finished item, the yield and who touched it last', () => {
    expect(bomSheetMetaLines(BOM)).toEqual([
      'BOM code: BOM-007',
      'Finished item: Office chair (ITM-CH-001)',
      'Yield: 1 pc',
      'Status: Active',
      // Built from the shared formatter, not spelled out: the month
      // abbreviation is the runtime's, and pinning it here would fail on an
      // ICU update without anything being wrong.
      `Last updated: ${formatDateTime(BOM.updated_at)} by Rahul Gupta`,
    ])
  })
})
