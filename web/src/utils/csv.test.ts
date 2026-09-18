import { describe, expect, it } from 'vitest'
import { csvEscape, csvFilename, parseCsv, toCsv } from './csv'

describe('csvEscape', () => {
  it('leaves plain values alone and blanks null / undefined', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape(12.5)).toBe('12.5')
    expect(csvEscape(-3)).toBe('-3')
    expect(csvEscape(true)).toBe('true')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape(Number.NaN)).toBe('')
  })

  it('quotes commas, quotes and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
  })

  it('neutralises formula-looking strings but not negative numbers', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvEscape('+1')).toBe("'+1")
    expect(csvEscape('@cmd')).toBe("'@cmd")
    expect(csvEscape('-cmd')).toBe("'-cmd")
    expect(csvEscape('-5')).toBe('-5')
    expect(csvEscape('-.5')).toBe('-.5')
  })
})

describe('toCsv', () => {
  it('writes a header row and one CRLF-terminated line per row', () => {
    const rows = [
      { name: 'Bolt', qty: 10 },
      { name: 'Nut, M8', qty: null },
    ]
    const csv = toCsv(rows, [
      { header: 'Item', value: (r) => r.name },
      { header: 'Qty', value: (r) => r.qty },
    ])
    expect(csv).toBe('Item,Qty\r\nBolt,10\r\n"Nut, M8",\r\n')
  })

  it('produces only the header for no rows', () => {
    expect(toCsv([], [{ header: 'A', value: () => 1 }])).toBe('A\r\n')
  })
})

describe('parseCsv', () => {
  it('splits plain rows on commas', () => {
    expect(parseCsv('sku,qty\nABC-1,5\nABC-2,10')).toEqual([
      ['sku', 'qty'],
      ['ABC-1', '5'],
      ['ABC-2', '10'],
    ])
  })

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    expect(parseCsv('sku,qty\n"Nut, M8",3\n"say ""hi""",1')).toEqual([
      ['sku', 'qty'],
      ['Nut, M8', '3'],
      ['say "hi"', '1'],
    ])
  })

  it('accepts CRLF line endings and drops blank rows', () => {
    expect(parseCsv('sku,qty\r\nABC-1,5\r\n\r\nABC-2,10\r\n')).toEqual([
      ['sku', 'qty'],
      ['ABC-1', '5'],
      ['ABC-2', '10'],
    ])
  })

  it('returns an empty array for blank input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})

describe('csvFilename', () => {
  it('slugs the parts and appends the date', () => {
    expect(csvFilename('Stock summary', 'Acme Ltd · FY 2025-26', '2025-04-01')).toBe('stock-summary-acme-ltd-fy-2025-26-2025-04-01.csv')
    expect(csvFilename('Audit', '', '2025-04-01')).toBe('audit-2025-04-01.csv')
    expect(csvFilename('', '', '2025-04-01')).toBe('export-2025-04-01.csv')
  })
})
