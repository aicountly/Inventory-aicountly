import { describe, expect, it } from 'vitest'
import { applyPreview, detectDelimiter, matchCountSheet, parseCountSheet, parseDelimited } from './countSheetImport'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'

const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!

const WAREHOUSES: Record<number, string> = { 1: 'Main Warehouse', 2: 'Secondary WH' }
const warehouseName = (id: number | null | undefined) => (id ? (WAREHOUSES[id] ?? '') : '')

function line(partial: Partial<LineDraft>): LineDraft {
  return newLine(COUNT, { warehouse_id: 1, book_qty: '10', physical_qty: '', origin: 'count', ...partial })
}

const LINES = [
  line({ key: 'a', item_id: 1, item_sku: 'ITM-001', item_name: 'HP Laptop 15s', warehouse_id: 1, batch_id: 5, batch_no: 'B2403' }),
  line({ key: 'b', item_id: 2, item_sku: 'ITM-002', item_name: 'Logitech Mouse M331', warehouse_id: 1 }),
  line({ key: 'c', item_id: 3, item_sku: 'ITM-003', item_name: 'Dell Monitor 24"', warehouse_id: 2 }),
  line({ key: 'd', item_id: 1, item_sku: 'ITM-001', item_name: 'HP Laptop 15s', warehouse_id: 2, batch_id: 6, batch_no: 'B2404' }),
]

describe('delimited parsing', () => {
  it('reads quoted fields, doubled quotes and CRLF endings', () => {
    const grid = parseDelimited('a,"b,c","say ""hi"""\r\n1,2,3\r\n')
    expect(grid).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })

  it('drops a trailing newline instead of inventing an empty row', () => {
    expect(parseDelimited('a,b\n1,2\n')).toHaveLength(2)
  })

  it('detects tab and semicolon separated files', () => {
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t')
    expect(detectDelimiter('a;b;c\n')).toBe(';')
    expect(detectDelimiter('a,b,c\n')).toBe(',')
  })

  it('strips a UTF-8 byte order mark from the first header', () => {
    const result = parseCountSheet('﻿Item Code,Counted Quantity\nITM-001,8\n')
    expect(result.error).toBeNull()
    expect(result.rows[0].itemCode).toBe('ITM-001')
  })
})

describe('header mapping', () => {
  it('accepts the aliases a handheld export actually writes', () => {
    const result = parseCountSheet('SKU\tWarehouse\tLot No\tPhysical Qty\nITM-001\tMain Warehouse\tB2403\t8\n')
    expect(result.error).toBeNull()
    expect(result.rows[0]).toMatchObject({ itemCode: 'ITM-001', warehouse: 'Main Warehouse', batch: 'B2403', countedQty: '8' })
  })

  it('refuses a file with no counted-quantity column', () => {
    expect(parseCountSheet('Item Code,Warehouse\nITM-001,Main\n').error).toMatch(/counted-quantity/i)
  })

  it('refuses a file with no item column', () => {
    expect(parseCountSheet('Counted Quantity\n8\n').error).toMatch(/item column/i)
  })

  it('refuses an empty file', () => {
    expect(parseCountSheet('').error).toMatch(/empty/i)
  })
})

describe('matching onto loaded lines', () => {
  function preview(csv: string) {
    const parsed = parseCountSheet(csv)
    expect(parsed.error).toBeNull()
    return matchCountSheet(parsed.rows, LINES, warehouseName)
  }

  it('matches on item code when it is unambiguous', () => {
    const p = preview('Item Code,Counted Quantity\nITM-002,25\n')
    expect(p.matched).toHaveLength(1)
    expect(p.matched[0].lineKey).toBe('b')
    expect(p.matched[0].qty).toBe(25)
  })

  it('refuses to guess when an item is loaded in two warehouses', () => {
    const p = preview('Item Code,Counted Quantity\nITM-001,8\n')
    expect(p.matched).toHaveLength(0)
    expect(p.rejected[0].problem).toBe('ambiguous')
  })

  it('narrows by warehouse and then by batch', () => {
    const p = preview('Item Code,Warehouse,Batch,Counted Quantity\nITM-001,Secondary WH,B2404,7\n')
    expect(p.matched[0].lineKey).toBe('d')
  })

  it('reports a warehouse the item is not loaded in', () => {
    const p = preview('Item Code,Warehouse,Counted Quantity\nITM-002,Secondary WH,5\n')
    expect(p.rejected[0].problem).toBe('warehouse_not_found')
  })

  it('reports a batch the item is not loaded with', () => {
    const p = preview('Item Code,Warehouse,Batch,Counted Quantity\nITM-001,Main Warehouse,B9999,5\n')
    expect(p.rejected[0].problem).toBe('batch_not_found')
  })

  it('reports an unknown item rather than dropping the row silently', () => {
    const p = preview('Item Code,Counted Quantity\nITM-404,5\n')
    expect(p.rejected[0].problem).toBe('item_not_found')
  })

  it('rejects a non-numeric and a blank quantity', () => {
    const p = preview('Item Code,Counted Quantity\nITM-002,eight\nITM-003,\n')
    expect(p.rejected.map((r) => r.problem)).toEqual(['invalid_qty', 'missing_qty'])
  })

  it('lets a later re-scan supersede an earlier one and says which', () => {
    const p = preview('Item Code,Counted Quantity\nITM-002,25\nITM-002,24\n')
    expect(p.matched).toHaveLength(1)
    expect(p.matched[0].qty).toBe(24)
    expect(p.matched[0].message).toMatch(/row 2/)
    expect(p.rejected[0].problem).toBe('duplicate_row')
  })

  it('counts the loaded lines the file says nothing about', () => {
    const p = preview('Item Code,Counted Quantity\nITM-002,25\n')
    expect(p.untouchedLines).toBe(3)
  })

  it('matches on item name when no code column is present', () => {
    const p = preview('Item Name,Counted Quantity\nLogitech Mouse M331,25\n')
    expect(p.matched[0].lineKey).toBe('b')
  })
})

describe('applying a preview', () => {
  it('writes only the counted column, and only for matched rows', () => {
    const parsed = parseCountSheet('Item Code,Counted Quantity\nITM-002,25\nITM-404,5\n')
    const p = matchCountSheet(parsed.rows, LINES, warehouseName)
    const applied = applyPreview(LINES, p)
    expect(applied.find((l) => l.key === 'b')?.physical_qty).toBe('25')
    expect(applied.find((l) => l.key === 'b')?.book_qty).toBe('10')
    expect(applied.find((l) => l.key === 'c')?.physical_qty).toBe('')
  })

  it('leaves the original lines untouched', () => {
    const parsed = parseCountSheet('Item Code,Counted Quantity\nITM-002,25\n')
    applyPreview(LINES, matchCountSheet(parsed.rows, LINES, warehouseName))
    expect(LINES.find((l) => l.key === 'b')?.physical_qty).toBe('')
  })
})
