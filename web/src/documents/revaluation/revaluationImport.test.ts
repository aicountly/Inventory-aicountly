import { describe, expect, it } from 'vitest'
import { parseRateRows, splitRow, stripCurrency } from './revaluationImport'

describe('splitRow', () => {
  it('honours quotes so a remark may contain the delimiter', () => {
    expect(splitRow('LAP001,46500,"Market price, revised"', ',')).toEqual(['LAP001', '46500', 'Market price, revised'])
    expect(splitRow('A,1,"say ""hi"""', ',')).toEqual(['A', '1', 'say "hi"'])
  })
})

describe('stripCurrency', () => {
  it('drops the symbol and the grouping, keeping the decimal', () => {
    expect(stripCurrency('₹1,23,456.78')).toBe('123456.78')
    expect(stripCurrency('46,500')).toBe('46500')
    expect(stripCurrency('1.234,56')).toBe('1234.56')
    expect(stripCurrency('1,23,456')).toBe('123456')
    expect(stripCurrency('1234,56')).toBe('1234.56')
    expect(stripCurrency('3950.25')).toBe('3950.25')
    expect(stripCurrency('1.234.567')).toBe('1234567')
  })
})

describe('parseRateRows', () => {
  it('reads a tab-separated paste from a spreadsheet', () => {
    const { rows, headerSkipped, delimiter } = parseRateRows('LAP001\t46500\tMarket price revised\nCHR001\t3950\tDiscounted bulk rate')
    expect(delimiter).toBe('\t')
    expect(headerSkipped).toBe(false)
    expect(rows).toEqual([
      { row: 1, code: 'LAP001', newUnitCost: 46500, remarks: 'Market price revised', problem: null },
      { row: 2, code: 'CHR001', newUnitCost: 3950, remarks: 'Discounted bulk rate', problem: null },
    ])
  })

  it('skips a header row', () => {
    const { rows, headerSkipped } = parseRateRows('SKU,New cost,Remarks\nLAP001,46500,')
    expect(headerSkipped).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ row: 2, code: 'LAP001', newUnitCost: 46500 })
  })

  it('does not mistake a data row for a header', () => {
    const { headerSkipped, rows } = parseRateRows('LAP001,46500\nCHR001,3950')
    expect(headerSkipped).toBe(false)
    expect(rows).toHaveLength(2)
  })

  it('accepts a single column of codes with no rate', () => {
    const { rows } = parseRateRows('LAP001\nCHR001\n')
    expect(rows.map((r) => r.code)).toEqual(['LAP001', 'CHR001'])
    expect(rows.every((r) => r.newUnitCost === null && r.problem === null)).toBe(true)
  })

  it('reports the rows it cannot use, one by one', () => {
    const { rows } = parseRateRows('LAP001,abc\nCHR001,0\n,1200')
    expect(rows[0].problem).toContain('not a number')
    expect(rows[1].problem).toContain('greater than zero')
    expect(rows[2].problem).toContain('No SKU')
  })

  it('reads a rate written with a currency symbol and Indian grouping', () => {
    const { rows } = parseRateRows('LAP001,"₹46,500.00"')
    expect(rows[0].newUnitCost).toBe(46500)
  })

  it('ignores blank lines', () => {
    expect(parseRateRows('\n\nLAP001,1\n\n').rows).toHaveLength(1)
    expect(parseRateRows('   ').rows).toEqual([])
  })
})
