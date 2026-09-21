import { describe, expect, it } from 'vitest'
import {
  guessMapping,
  markDuplicates,
  parseDelimited,
  parseLooseDate,
  rowSeverity,
  tally,
  toCreatePayload,
  toImportRow,
} from './batchImport'

describe('parseDelimited', () => {
  it('reads a plain comma file', () => {
    expect(parseDelimited('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a quoted comma inside its cell', () => {
    expect(parseDelimited('item,note\n"Salt, 1kg",fine\n')).toEqual([
      ['item', 'note'],
      ['Salt, 1kg', 'fine'],
    ])
  })

  it('unescapes a doubled quote and keeps a newline inside quotes', () => {
    expect(parseDelimited('a\n"He said ""hi""\nagain"\n')).toEqual([['a'], ['He said "hi"\nagain']])
  })

  it('reads CRLF, LF and a final line with no terminator alike', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('sniffs a tab paste from a spreadsheet without being told', () => {
    expect(parseDelimited('item\tbatch\nSKU-1\tBCH-1')).toEqual([
      ['item', 'batch'],
      ['SKU-1', 'BCH-1'],
    ])
  })

  it('sniffs a semicolon file, as European spreadsheets write', () => {
    expect(parseDelimited('item;batch\nSKU-1;BCH-1')).toEqual([
      ['item', 'batch'],
      ['SKU-1', 'BCH-1'],
    ])
  })

  it('strips a byte-order mark rather than putting it in the first header', () => {
    expect(parseDelimited('﻿item,batch\nSKU-1,BCH-1')[0][0]).toBe('item')
  })

  it('drops blank lines instead of importing them as empty batches', () => {
    expect(parseDelimited('a,b\n\n1,2\n\n')).toHaveLength(2)
  })
})

describe('guessMapping', () => {
  it('matches the headings a warehouse actually writes', () => {
    const mapping = guessMapping(['Item SKU', 'Batch No.', 'Lot Number', 'Mfg Date', 'Expiry Date'])
    expect(mapping.item).toBe(0)
    expect(mapping.batch_no).toBe(1)
    expect(mapping.lot_no).toBe(2)
    expect(mapping.mfg_date).toBe(3)
    expect(mapping.expiry_date).toBe(4)
  })

  it('never points two fields at the same column', () => {
    const mapping = guessMapping(['Batch', 'Batch number'])
    const claimed = Object.values(mapping).filter((i) => i >= 0)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('leaves a field unmapped rather than guessing wildly', () => {
    const mapping = guessMapping(['Thing', 'Other'])
    expect(mapping.batch_no).toBe(-1)
    expect(mapping.status).toBe(-1)
  })
})

describe('parseLooseDate', () => {
  it('takes the ISO form unchanged', () => {
    expect(parseLooseDate('2028-03-31')).toBe('2028-03-31')
  })

  it('reads a slashed date day-first, as an Indian sheet writes it', () => {
    expect(parseLooseDate('31/03/2028')).toBe('2028-03-31')
    expect(parseLooseDate('3/4/2026')).toBe('2026-04-03')
  })

  it('reads a two-digit year as this century', () => {
    expect(parseLooseDate('31-03-28')).toBe('2028-03-31')
  })

  it('reads a named month', () => {
    expect(parseLooseDate('31 Mar 2028')).toBe('2028-03-31')
    expect(parseLooseDate('01-April-2026')).toBe('2026-04-01')
  })

  it('rejects an impossible date instead of rolling it over', () => {
    expect(parseLooseDate('31/02/2026')).toBeNull()
    expect(parseLooseDate('2026-13-01')).toBeNull()
    expect(parseLooseDate('tomorrow')).toBeNull()
    expect(parseLooseDate('')).toBeNull()
  })
})

const MAPPING = {
  item: 0,
  batch_no: 1,
  lot_no: 2,
  mfg_date: 3,
  expiry_date: 4,
  warranty_months: 5,
  status: 6,
}

describe('toImportRow', () => {
  it('accepts a complete, well-formed row', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', 'LOT-1', '2026-04-01', '2028-03-31', '24', 'active'], MAPPING, 2)
    expect(row.errors).toEqual([])
    expect(row.warnings).toEqual([])
    expect(rowSeverity(row)).toBe('valid')
    expect(row.mfg_date).toBe('2026-04-01')
    expect(row.expiry_date).toBe('2028-03-31')
  })

  it('requires an item and a batch number', () => {
    const row = toImportRow(['', '', '', '', '', '', ''], MAPPING, 2)
    expect(row.errors).toContain('Item is required')
    expect(row.errors).toContain('Batch number is required')
  })

  it('refuses an expiry date before the manufacturing date', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', '', '2028-03-31', '2026-04-01', '', ''], MAPPING, 2)
    expect(row.errors).toContain('Expiry date is before the manufacturing date')
  })

  it('names the text it could not read as a date, rather than dropping it', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', '', '', 'soon', '', ''], MAPPING, 2)
    expect(row.errors).toContain('Expiry date "soon" is not a date')
  })

  it('refuses a status outside the domain', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', '', '', '2028-03-31', '', 'pending'], MAPPING, 2)
    expect(row.errors[0]).toMatch(/Status "pending" is not one of/)
  })

  it('refuses a batch or lot number past the column width', () => {
    const long = 'B'.repeat(65)
    const row = toImportRow(['SKU-1', long, long, '', '2028-03-31', '', ''], MAPPING, 2)
    expect(row.errors).toContain('Batch number is longer than 64 characters')
    expect(row.errors).toContain('Lot number is longer than 64 characters')
  })

  it('warns — but does not refuse — a row with no expiry date', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', '', '', '', '', ''], MAPPING, 2)
    expect(row.errors).toEqual([])
    expect(rowSeverity(row)).toBe('warning')
  })

  it('takes nothing from a column that is not in the file', () => {
    const row = toImportRow(['SKU-1', 'BCH-1'], { ...MAPPING, lot_no: -1, status: -1 }, 2)
    expect(row.lot_no).toBe('')
    expect(row.status).toBe('')
  })
})

describe('markDuplicates', () => {
  it('refuses the second of a repeated item and batch number, naming the first line', () => {
    const rows = markDuplicates([
      toImportRow(['SKU-1', 'BCH-1', '', '', '2028-03-31', '', ''], MAPPING, 2),
      toImportRow(['SKU-1', 'bch-1', '', '', '2028-03-31', '', ''], MAPPING, 3),
    ])
    expect(rows[0].errors).toEqual([])
    expect(rows[1].errors).toContain('Same item and batch number as line 2')
  })

  it('leaves the same batch number under a different item alone', () => {
    const rows = markDuplicates([
      toImportRow(['SKU-1', 'BCH-1', '', '', '2028-03-31', '', ''], MAPPING, 2),
      toImportRow(['SKU-2', 'BCH-1', '', '', '2028-03-31', '', ''], MAPPING, 3),
    ])
    expect(rows[1].errors).toEqual([])
  })
})

describe('tally', () => {
  it('counts what would be sent, which is everything but the errors', () => {
    const rows = [
      toImportRow(['SKU-1', 'BCH-1', '', '', '2028-03-31', '', ''], MAPPING, 2),
      toImportRow(['SKU-1', 'BCH-2', '', '', '', '', ''], MAPPING, 3),
      toImportRow(['', '', '', '', '', '', ''], MAPPING, 4),
    ]
    expect(tally(rows)).toEqual({ total: 3, valid: 1, warning: 1, error: 1, importable: 2 })
  })
})

describe('toCreatePayload', () => {
  it('sends nulls where the file said nothing, never empty strings', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', '', '', '', '', ''], MAPPING, 2)
    row.itemId = 42
    expect(toCreatePayload(row)).toEqual({
      item_id: 42,
      batch_no: 'BCH-1',
      lot_no: null,
      mfg_date: null,
      expiry_date: null,
      warranty_months: null,
      status: 'active',
    })
  })

  it('sends the resolved item id and the interpreted dates, not the raw text', () => {
    const row = toImportRow(['SKU-1', 'BCH-1', 'LOT-9', '01/04/2026', '31/03/2028', '12', 'quarantine'], MAPPING, 2)
    row.itemId = 7
    expect(toCreatePayload(row)).toEqual({
      item_id: 7,
      batch_no: 'BCH-1',
      lot_no: 'LOT-9',
      mfg_date: '2026-04-01',
      expiry_date: '2028-03-31',
      warranty_months: 12,
      status: 'quarantine',
    })
  })
})
