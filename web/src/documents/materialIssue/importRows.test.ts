import { describe, expect, it } from 'vitest'
import { normaliseHeader, parseDelimited, parseImportSheet, parseQty, splitSerials } from './importRows'

describe('parseQty', () => {
  it('reads a spreadsheet number however it is written', () => {
    expect(parseQty(12)).toBe(12)
    expect(parseQty('12.5')).toBe(12.5)
    expect(parseQty('1,250')).toBe(1250)
    expect(parseQty('12.5 kg')).toBe(12.5)
  })

  it('has no answer for a blank or non-numeric cell', () => {
    expect(parseQty('')).toBeNull()
    expect(parseQty(null)).toBeNull()
    expect(parseQty('n/a')).toBeNull()
    expect(parseQty(Number.NaN)).toBeNull()
  })
})

describe('splitSerials', () => {
  it('splits on every separator another system might export', () => {
    expect(splitSerials('SN1, SN2; SN3|SN4\nSN5')).toEqual(['SN1', 'SN2', 'SN3', 'SN4', 'SN5'])
    expect(splitSerials('  SN1  ')).toEqual(['SN1'])
    expect(splitSerials('')).toEqual([])
  })
})

describe('normaliseHeader', () => {
  it('squashes spelling differences to one key', () => {
    expect(normaliseHeader('Batch No.')).toBe('batchno')
    expect(normaliseHeader('batch_no')).toBe('batchno')
    expect(normaliseHeader('  BATCH NO  ')).toBe('batchno')
  })
})

describe('parseDelimited', () => {
  it('reads quoted fields, doubled quotes and embedded separators', () => {
    const rows = parseDelimited('SKU,Item,Qty\r\nA-1,"Bolt, 10mm",5\r\nA-2,"He said ""hi""",3\r\n')
    expect(rows).toEqual([
      ['SKU', 'Item', 'Qty'],
      ['A-1', 'Bolt, 10mm', '5'],
      ['A-2', 'He said "hi"', '3'],
    ])
  })

  it('detects a tab-separated paste out of Excel', () => {
    expect(parseDelimited('SKU\tQty\nA-1\t5')).toEqual([
      ['SKU', 'Qty'],
      ['A-1', '5'],
    ])
  })

  it('drops a UTF-8 BOM but keeps a blank line in place', () => {
    // The blank line holds row 3 open so a message about "A-1" says row 3.
    expect(parseDelimited('﻿SKU,Qty\n\nA-1,5\n')).toEqual([
      ['SKU', 'Qty'],
      [''],
      ['A-1', '5'],
    ])
  })

  it('adds no phantom row for a trailing newline', () => {
    expect(parseDelimited('SKU,Qty\nA-1,5\n')).toHaveLength(2)
    expect(parseDelimited('SKU,Qty\nA-1,5')).toHaveLength(2)
  })
})

describe('parseImportSheet', () => {
  it('maps a well-formed sheet onto rows', () => {
    const result = parseImportSheet([
      ['SKU', 'Item', 'Warehouse', 'Batch No.', 'Serial', 'Quantity', 'Unit', 'Remarks'],
      ['GS-001', 'Gear Shaft', 'Main', 'B-2026-001', '', '5', 'Nos', 'Production use'],
      ['BB-002', 'Ball Bearing', '', '', 'SN1;SN2', '2', 'Nos', ''],
    ])
    expect(result.issues).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ row: 2, sku: 'GS-001', warehouse: 'Main', batch: 'B-2026-001', qty: 5, remarks: 'Production use' })
    expect(result.rows[1].serials).toEqual(['SN1', 'SN2'])
    expect(result.matched).toContain('qty')
  })

  it('refuses a sheet with no item or no quantity column', () => {
    expect(parseImportSheet([['Thing', 'Amount'], ['x', '1']]).issues[0].message).toContain('No SKU or Item column')
    expect(parseImportSheet([['SKU', 'Colour'], ['x', 'red']]).issues[0].message).toContain('No Quantity column')
  })

  it('reports a bad row instead of quietly dropping it', () => {
    // An import that silently loses half a file is worse than one that refuses it.
    const result = parseImportSheet([
      ['SKU', 'Quantity'],
      ['GS-001', '5'],
      ['', ''],
      ['BB-002', 'abc'],
      ['HX-010', '0'],
      ['HX-011', '-3'],
    ])
    expect(result.rows.map((r) => r.sku)).toEqual(['GS-001'])
    expect(result.issues).toHaveLength(3)
    expect(result.issues.map((i) => i.row)).toEqual([4, 5, 6])
    expect(result.issues[0].message).toContain('not a number')
    expect(result.issues[1].message).toContain('greater than zero')
  })

  it('calls the empty file empty', () => {
    expect(parseImportSheet([]).issues[0].message).toBe('The file is empty.')
  })
})
