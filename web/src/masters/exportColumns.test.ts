import { describe, expect, it } from 'vitest'
import { cellText, toCsvColumns } from '../registers/registerCells'
import { toCsv } from '../utils/csv'
import { masterExportColumns } from './exportColumns'
import type { MasterColumn } from './types'

/**
 * These assert the text a sheet actually ends up holding — `cellText` is the
 * same resolver the print sheet and the Excel writer call — rather than the
 * shape of the column objects. A column list that looks right and prints `1`
 * under "Status" is the failure this file exists to catch.
 */

interface Row {
  warehouse_id: number
  warehouse_name: string
  warehouse_type: string
  is_active: number
  is_default: number
  allow_negative: number | null
  item_count: number
  on_hand: number
  unit_cost: number
  expiry_date: string | null
  updated_at: string
}

const ROW: Row = {
  warehouse_id: 7,
  warehouse_name: 'Central store',
  warehouse_type: 'bonded_warehouse',
  is_active: 0,
  is_default: 1,
  allow_negative: null,
  item_count: 412,
  on_hand: 1250.5,
  unit_cost: 148.25,
  expiry_date: '2026-03-31',
  updated_at: '2026-09-14 11:02:30',
}

const COLUMNS: MasterColumn<Row>[] = [
  { key: 'warehouse_name', header: 'Warehouse' },
  { key: 'warehouse_id', header: 'Warehouse', exportValue: (r) => `#${r.warehouse_id}` },
  { key: 'warehouse_type', header: null, exportValue: () => 'Bonded warehouse' },
  { key: 'is_active', header: 'Status' },
  { key: 'is_default', header: 'Default' },
  { key: 'allow_negative', header: 'Negative stock' },
  { key: 'item_count', header: 'Items', align: 'right' },
  { key: 'on_hand', header: 'On hand', align: 'right' },
  { key: 'unit_cost', header: 'Unit cost', align: 'right' },
  { key: 'expiry_date', header: 'Expires' },
  { key: 'updated_at', header: 'Updated' },
  { key: 'pick', header: '', noExport: true },
]

function textFor(key: string, row: Row = ROW): string {
  const col = masterExportColumns(COLUMNS).find((c) => c.key === key)
  if (!col) throw new Error(`no export column for ${key}`)
  return cellText(row, col)
}

describe('masterExportColumns', () => {
  it('keeps the table order and drops UI-only columns', () => {
    expect(masterExportColumns(COLUMNS).map((c) => c.key)).toEqual([
      'warehouse_name',
      'warehouse_id',
      'warehouse_type',
      'is_active',
      'is_default',
      'allow_negative',
      'item_count',
      'on_hand',
      'unit_cost',
      'expiry_date',
      'updated_at',
    ])
  })

  it('writes the word the badge shows for is_active, never 1 or 0', () => {
    expect(textFor('is_active')).toBe('Inactive')
    expect(textFor('is_active', { ...ROW, is_active: 1 })).toBe('Active')
  })

  it('writes Yes / No for other flags, and leaves an unset one blank', () => {
    expect(textFor('is_default')).toBe('Yes')
    expect(textFor('is_default', { ...ROW, is_default: 0 })).toBe('No')
    // `null` means "follow company policy" here — No would be a wrong answer.
    expect(textFor('allow_negative')).toBe('')
  })

  it('honours a column that resolves its own value', () => {
    expect(textFor('warehouse_id')).toBe('#7')
    expect(textFor('warehouse_type')).toBe('Bonded warehouse')
  })

  it('formats counts, quantities, costs, dates and timestamps', () => {
    expect(textFor('item_count')).toBe('412')
    expect(textFor('on_hand')).toBe('1,250.5')
    expect(textFor('unit_cost')).toBe('148.25')
    // Locale month names differ between ICU builds; what matters is that the
    // raw `2026-03-31` / `2026-09-14 11:02:30` never reach the sheet.
    expect(textFor('expiry_date')).toMatch(/^31 \w+\.? 2026$/)
    expect(textFor('updated_at')).toMatch(/^14 \w+\.? 2026, 11:02$/)
  })

  it('falls back to a readable header when the table header is not text', () => {
    const headers = masterExportColumns(COLUMNS).map((c) => c.csvHeader)
    expect(headers[0]).toBe('Warehouse')
    expect(headers[2]).toBe('Warehouse type')
  })

  it('produces a CSV whose header row and cells match the screen', () => {
    const csv = toCsv([ROW], toCsvColumns(masterExportColumns(COLUMNS)))
    const [header, first] = csv.trim().split('\r\n')
    expect(header).toBe(
      'Warehouse,Warehouse,Warehouse type,Status,Default,Negative stock,Items,On hand,Unit cost,Expires,Updated',
    )
    expect(first).toBe(
      'Central store,#7,Bonded warehouse,Inactive,Yes,,412,1250.5,148.25,2026-03-31,2026-09-14 11:02:30',
    )
  })
})
