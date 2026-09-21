import { describe, expect, it } from 'vitest'
import {
  autoMapColumns,
  normaliseDate,
  parseDelimited,
  tallyRows,
  validateImportRows,
} from './batchImport'
import type { ImportField, ImportItemRef } from './batchImport'

const STATUSES = ['active', 'quarantine', 'recalled', 'expired', 'closed']

const ITEMS = new Map<string, ImportItemRef>([
  ['paracetamol 500mg', { item_id: 1, item_name: 'Paracetamol 500mg', item_sku: 'MED-PARA-500', track_batch: 1 }],
  ['med para 500', { item_id: 1, item_name: 'Paracetamol 500mg', item_sku: 'MED-PARA-500', track_batch: 1 }],
  ['acer laptop', { item_id: 2, item_name: 'Acer Laptop', track_batch: 0 }],
])

const MAPPING: Record<ImportField, number> = {
  item: 0,
  batch_no: 1,
  lot_no: 2,
  mfg_date: 3,
  expiry_date: 4,
  warranty_months: 5,
  status: 6,
}

function validate(rows: string[][]) {
  return validateImportRows({ rows, mapping: MAPPING, itemsByKey: ITEMS, statuses: STATUSES })
}

describe('parseDelimited', () => {
  it('reads quoted fields, doubled quotes and embedded newlines', () => {
    const csv = 'a,b\n"x,1","he said ""hi"""\n"multi\nline",2\n'
    expect(parseDelimited(csv)).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['multi\nline', '2'],
    ])
  })

  it('handles CRLF, a trailing newline and blank lines', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('strips a byte-order mark so the first header still matches', () => {
    expect(parseDelimited('﻿Item,Batch\nX,Y')[0]).toEqual(['Item', 'Batch'])
  })

  it('reads a tab-separated file when told to', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('autoMapColumns', () => {
  it('matches the spellings a spreadsheet actually carries', () => {
    const mapping = autoMapColumns(['Item Name', 'Batch No', 'Lot Number', 'Mfg Date', 'Expiry Date'])
    expect(mapping.item).toBe(0)
    expect(mapping.batch_no).toBe(1)
    expect(mapping.lot_no).toBe(2)
    expect(mapping.mfg_date).toBe(3)
    expect(mapping.expiry_date).toBe(4)
    expect(mapping.status).toBe(-1)
  })

  it('never maps one column to two fields', () => {
    const mapping = autoMapColumns(['SKU', 'Batch'])
    const used = Object.values(mapping).filter((i) => i >= 0)
    expect(new Set(used).size).toBe(used.length)
  })
})

describe('normaliseDate', () => {
  it('accepts the three spellings a warehouse spreadsheet uses', () => {
    expect(normaliseDate('2028-03-31')).toBe('2028-03-31')
    expect(normaliseDate('31/03/2028')).toBe('2028-03-31')
    expect(normaliseDate('31-03-2028')).toBe('2028-03-31')
    expect(normaliseDate('2028-3-1')).toBe('2028-03-01')
  })

  it('refuses anything it cannot read for certain', () => {
    for (const bad of ['', 'March 2028', '31/13/2028', '2028-02-30', '03/31/2028']) {
      expect(normaliseDate(bad), bad).toBeNull()
    }
  })
})

describe('validateImportRows', () => {
  it('builds the payload the create endpoint takes', () => {
    const [row] = validate([['Paracetamol 500mg', 'BCH-1', 'LOT-1', '01/04/2026', '31/03/2028', '24', 'Active']])
    expect(row.verdict).toBe('valid')
    expect(row.payload).toEqual({
      item_id: 1,
      batch_no: 'BCH-1',
      lot_no: 'LOT-1',
      mfg_date: '2026-04-01',
      expiry_date: '2028-03-31',
      warranty_months: 24,
      status: 'active',
    })
  })

  it('matches an item by SKU as well as by name', () => {
    const [row] = validate([['MED-PARA-500', 'BCH-1']])
    expect(row.item?.item_id).toBe(1)
  })

  it('refuses a row with no item, no batch number or an unknown item', () => {
    const rows = validate([
      ['', 'BCH-1'],
      ['Paracetamol 500mg', ''],
      ['Nothing At All', 'BCH-2'],
    ])
    expect(rows.map((r) => r.verdict)).toEqual(['error', 'error', 'error'])
    expect(rows[2].messages[0]).toContain('No active item matches')
    expect(rows.every((r) => r.payload === null)).toBe(true)
  })

  it('refuses an item that is not batch-tracked', () => {
    const [row] = validate([['Acer Laptop', 'BCH-1']])
    expect(row.verdict).toBe('error')
    expect(row.messages[0]).toContain('not batch-tracked')
  })

  it('refuses an unreadable date and an expiry before manufacture', () => {
    const rows = validate([
      ['Paracetamol 500mg', 'BCH-1', '', 'last March'],
      ['Paracetamol 500mg', 'BCH-2', '', '01/04/2026', '01/04/2025'],
    ])
    expect(rows[0].verdict).toBe('error')
    expect(rows[1].messages[0]).toContain('before the manufacturing date')
  })

  it('catches two rows claiming the same batch before the server does', () => {
    const rows = validate([
      ['Paracetamol 500mg', 'BCH-1'],
      ['MED-PARA-500', 'bch-1'],
    ])
    expect(rows[0].verdict).toBe('valid')
    expect(rows[1].verdict).toBe('error')
    expect(rows[1].messages[0]).toContain('Duplicate of line 2')
  })

  it('warns, but still imports, where the fix is obvious', () => {
    const [row] = validate([['Paracetamol 500mg', 'BCH-1', '', '', '', 'soon', 'Frozen']])
    expect(row.verdict).toBe('warning')
    expect(row.messages).toHaveLength(2)
    expect(row.payload).toMatchObject({ status: 'active', warranty_months: null })
  })

  it('numbers rows by their line in the uploaded file', () => {
    const rows = validate([['Paracetamol 500mg', 'A'], ['Paracetamol 500mg', 'B']])
    expect(rows.map((r) => r.line)).toEqual([2, 3])
  })

  it('reads a column the mapping was pointed at, and nothing from one it was not', () => {
    const rows = validateImportRows({
      rows: [['ignored', 'Paracetamol 500mg', 'BCH-9']],
      mapping: { ...MAPPING, item: 1, batch_no: 2, lot_no: -1, mfg_date: -1, expiry_date: -1, warranty_months: -1, status: -1 },
      itemsByKey: ITEMS,
      statuses: STATUSES,
    })
    expect(rows[0].payload).toMatchObject({ item_id: 1, batch_no: 'BCH-9', lot_no: null })
  })
})

describe('tallyRows', () => {
  it('counts a warning as importable and an error as not', () => {
    const rows = validate([
      ['Paracetamol 500mg', 'BCH-1'],
      ['Paracetamol 500mg', 'BCH-2', '', '', '', '', 'Frozen'],
      ['Nothing', 'BCH-3'],
    ])
    expect(tallyRows(rows)).toEqual({ valid: 1, warning: 1, error: 1, importable: 2 })
  })

  it('never counts an error row as importable', () => {
    const rows = validate([['Nothing', 'A'], ['Nothing', 'B']])
    expect(tallyRows(rows).importable).toBe(0)
    expect(rows.every((r) => r.payload === null)).toBe(true)
  })
})
