import { describe, expect, it } from 'vitest'
import { csvEscape, csvFilename, csvRecords, parseCsv, toCsv } from './csv'

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
  it('splits a header and its data rows', () => {
    const parsed = parseCsv('Item,Qty\r\nBolt,10\r\nNut,5\r\n')
    expect(parsed.headers).toEqual(['Item', 'Qty'])
    expect(parsed.rows).toEqual([
      ['Bolt', '10'],
      ['Nut', '5'],
    ])
  })

  it('round-trips what toCsv writes, including a quoted comma and an escaped quote', () => {
    const csv = toCsv(
      [
        { name: 'Nut, M8', note: 'say "hi"' },
        { name: 'Bolt', note: 'plain' },
      ],
      [
        { header: 'Item', value: (r) => r.name },
        { header: 'Note', value: (r) => r.note },
      ],
    )
    const parsed = parseCsv(csv)
    expect(parsed.headers).toEqual(['Item', 'Note'])
    expect(parsed.rows).toEqual([
      ['Nut, M8', 'say "hi"'],
      ['Bolt', 'plain'],
    ])
  })

  it('strips a leading BOM and tolerates a missing trailing newline', () => {
    const parsed = parseCsv('﻿Item,Qty\nBolt,10')
    expect(parsed.headers).toEqual(['Item', 'Qty'])
    expect(parsed.rows).toEqual([['Bolt', '10']])
  })

  it('drops blank lines', () => {
    const parsed = parseCsv('Item,Qty\n\nBolt,10\n\n\nNut,5\n')
    expect(parsed.rows).toEqual([
      ['Bolt', '10'],
      ['Nut', '5'],
    ])
  })

  it('keeps a newline embedded in a quoted field', () => {
    const parsed = parseCsv('Item,Note\nBolt,"line one\nline two"\n')
    expect(parsed.rows).toEqual([['Bolt', 'line one\nline two']])
  })

  it('returns no rows for header-only input', () => {
    expect(parseCsv('Item,Qty\n')).toEqual({ headers: ['Item', 'Qty'], rows: [] })
  })
})

describe('csvRecords', () => {
  it('keys each row by header, padding a short row with empty strings', () => {
    const parsed = parseCsv('Item,Qty,Rate\nBolt,10\n')
    expect(csvRecords(parsed)).toEqual([{ Item: 'Bolt', Qty: '10', Rate: '' }])
  })
})

describe('csvFilename', () => {
  it('slugs the parts and appends the date', () => {
    expect(csvFilename('Stock summary', 'Acme Ltd · FY 2025-26', '2025-04-01')).toBe('stock-summary-acme-ltd-fy-2025-26-2025-04-01.csv')
    expect(csvFilename('Audit', '', '2025-04-01')).toBe('audit-2025-04-01.csv')
    expect(csvFilename('', '', '2025-04-01')).toBe('export-2025-04-01.csv')
  })
})
