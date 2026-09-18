import { describe, expect, it } from 'vitest'
import {
  SERIAL_IMPORT_TEMPLATE,
  classifyImportRows,
  detectDelimiter,
  generateSerialRange,
  guessColumnMapping,
  importRowCounts,
  importableRows,
  parseDelimited,
  parseSerialInput,
} from './serialParse'
import type { SerialImportField } from './serialParse'

describe('parseSerialInput', () => {
  it('splits on newlines, commas, semicolons and tabs and trims', () => {
    expect(parseSerialInput(' A1 \nB2,C3;D4\tE5\r\n').serials).toEqual(['A1', 'B2', 'C3', 'D4', 'E5'])
  })

  it('reports repeats once and keeps first-seen order', () => {
    const parsed = parseSerialInput('X\nY\nX\nZ\nY\nX')
    expect(parsed.serials).toEqual(['X', 'Y', 'Z'])
    expect(parsed.duplicates).toEqual(['X', 'Y'])
  })

  it('sets aside values longer than the API accepts', () => {
    const long = 'L'.repeat(129)
    const parsed = parseSerialInput(`ok\n${long}`)
    expect(parsed.serials).toEqual(['ok'])
    expect(parsed.tooLong).toEqual([long])
  })

  it('handles empty input', () => {
    expect(parseSerialInput('')).toEqual({ serials: [], duplicates: [], tooLong: [] })
  })
})

describe('generateSerialRange', () => {
  it('pads and wraps with prefix and suffix', () => {
    expect(generateSerialRange({ prefix: 'SN-', suffix: '/A', start: 8, end: 11, pad: 4 })).toEqual(['SN-0008/A', 'SN-0009/A', 'SN-0010/A', 'SN-0011/A'])
    expect(generateSerialRange({ prefix: '', suffix: '', start: 1, end: 2, pad: 0 })).toEqual(['1', '2'])
  })

  it('rejects invalid or oversized ranges', () => {
    expect(generateSerialRange({ prefix: '', suffix: '', start: 5, end: 4, pad: 0 })).toEqual([])
    expect(generateSerialRange({ prefix: '', suffix: '', start: -1, end: 4, pad: 0 })).toEqual([])
    expect(generateSerialRange({ prefix: '', suffix: '', start: 1, end: 10, pad: 0 }, 5)).toEqual([])
  })
})

describe('parseDelimited', () => {
  it('reads a plain comma file', () => {
    expect(parseDelimited('serial_no,warranty_until\nSN-1,2028-04-15\n')).toEqual([
      ['serial_no', 'warranty_until'],
      ['SN-1', '2028-04-15'],
    ])
  })

  it('keeps a delimiter that sits inside quotes', () => {
    expect(parseDelimited('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('"MacBook Pro 14"" M3",SN-1')).toEqual([['MacBook Pro 14" M3', 'SN-1']])
  })

  it('survives the CRLF endings Excel writes', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('drops blank lines rather than importing them as empty serials', () => {
    expect(parseDelimited('SN-1\n\n\nSN-2\n')).toEqual([['SN-1'], ['SN-2']])
  })

  it('reads tab-separated text when told to', () => {
    expect(parseDelimited('SN-1\t2028-04-15', '\t')).toEqual([['SN-1', '2028-04-15']])
  })
})

describe('detectDelimiter', () => {
  it('picks whichever separator the first line actually uses', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
    expect(detectDelimiter('a;b;c')).toBe(';')
  })

  it('falls back to a comma for a single-column list', () => {
    expect(detectDelimiter('SN-0001\nSN-0002')).toBe(',')
  })
})

describe('guessColumnMapping', () => {
  it('recognises the usual header names', () => {
    expect(guessColumnMapping(['Serial Number', 'Warranty Until', 'Notes'])).toEqual([
      'serial_no',
      'warranty_until',
      'ignore',
    ])
    expect(guessColumnMapping(['serial_no', 'expiry_date'])).toEqual(['serial_no', 'warranty_until'])
  })

  it('leaves a column it does not recognise out rather than guessing', () => {
    // A column guessed wrongly and imported silently is 5,000 serials to undo.
    expect(guessColumnMapping(['Supplier', 'Cost'])).toEqual(['ignore', 'ignore'])
  })
})

describe('classifyImportRows', () => {
  const mapping: SerialImportField[] = ['serial_no', 'warranty_until']
  const rows = [
    ['serial_no', 'warranty_until'],
    ['SN-1', '2028-04-15'],
    ['SN-2', ''],
    ['SN-1', '2028-04-15'],
    ['', '2028-04-15'],
    ['SN-3', '15/04/2028'],
    ['L'.repeat(129), ''],
  ]

  it('keeps every row and says why the bad ones cannot be sent', () => {
    const classified = classifyImportRows(rows, mapping, { hasHeader: true })
    expect(classified.map((r) => r.state)).toEqual([
      'ready',
      'ready',
      'duplicate_in_file',
      'empty',
      'bad_warranty',
      'too_long',
    ])
  })

  it('numbers the lines as the file does, so the operator can find them', () => {
    const classified = classifyImportRows(rows, mapping, { hasHeader: true })
    expect(classified[0].line).toBe(2)
    expect(classified.at(-1)?.line).toBe(7)
  })

  it('counts a repeat against the first occurrence only', () => {
    const classified = classifyImportRows([['A'], ['A'], ['A']], ['serial_no'])
    expect(classified.map((r) => r.state)).toEqual(['ready', 'duplicate_in_file', 'duplicate_in_file'])
  })

  it('treats a missing warranty column as no warranty, not as an error', () => {
    const classified = classifyImportRows([['SN-9']], ['serial_no'])
    expect(classified[0]).toEqual({ line: 1, serialNo: 'SN-9', warrantyUntil: null, state: 'ready' })
  })

  it('sends only the rows that are ready', () => {
    const classified = classifyImportRows(rows, mapping, { hasHeader: true })
    expect(importableRows(classified).map((r) => r.serialNo)).toEqual(['SN-1', 'SN-2'])
    expect(importRowCounts(classified)).toEqual({
      ready: 2,
      duplicate_in_file: 1,
      too_long: 1,
      bad_warranty: 1,
      empty: 1,
    })
  })
})

describe('SERIAL_IMPORT_TEMPLATE', () => {
  it('round-trips through the parser it is a template for', () => {
    const rows = parseDelimited(SERIAL_IMPORT_TEMPLATE)
    const mapping = guessColumnMapping(rows[0])
    expect(mapping).toEqual(['serial_no', 'warranty_until'])
    expect(importableRows(classifyImportRows(rows, mapping, { hasHeader: true }))).toHaveLength(3)
  })
})
