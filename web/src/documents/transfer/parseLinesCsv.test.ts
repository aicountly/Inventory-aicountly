import { describe, expect, it } from 'vitest'
import { parseLinesCsv, splitCsvLine } from './parseLinesCsv'

describe('splitting a CSV line', () => {
  it('reads commas, semicolons and tabs', () => {
    expect(splitCsvLine('PRD-001,10')).toEqual(['PRD-001', '10'])
    expect(splitCsvLine('PRD-001;10')).toEqual(['PRD-001', '10'])
    expect(splitCsvLine('PRD-001\t10')).toEqual(['PRD-001', '10'])
  })

  it('keeps a comma that is inside quotes', () => {
    expect(splitCsvLine('"PRD,001",10')).toEqual(['PRD,001', '10'])
  })

  it('reads a doubled quote as one quote', () => {
    expect(splitCsvLine('"15"" monitor",2')).toEqual(['15" monitor', '2'])
  })
})

describe('reading a transfer CSV', () => {
  it('takes code, quantity and an optional batch', () => {
    const { rows, errors } = parseLinesCsv('PRD-001,10\nRM-012,100,BCH-SEP26-01')
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { lineNo: 1, code: 'PRD-001', qty: 10, batchNo: null },
      { lineNo: 2, code: 'RM-012', qty: 100, batchNo: 'BCH-SEP26-01' },
    ])
  })

  it('skips the header row every spreadsheet writes', () => {
    const { rows } = parseLinesCsv('item_code,quantity,batch_no\nPRD-001,10')
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('PRD-001')
  })

  it('ignores blank lines and trailing newlines', () => {
    const { rows, errors } = parseLinesCsv('PRD-001,10\n\n\nRM-012,5\n')
    expect(rows).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('names the line that cannot be read instead of dropping it silently', () => {
    const { rows, errors } = parseLinesCsv('PRD-001,10\nRM-012,\nACC-005,abc\nPRD-002,-4')
    expect(rows.map((r) => r.code)).toEqual(['PRD-001'])
    expect(errors).toEqual([
      { lineNo: 2, message: '“RM-012” has no quantity.' },
      { lineNo: 3, message: '“ACC-005” has an unusable quantity (abc).' },
      { lineNo: 4, message: '“PRD-002” has an unusable quantity (-4).' },
    ])
  })

  it('reads a thousands separator in the quantity', () => {
    expect(parseLinesCsv('RM-012,"1,250"').rows[0].qty).toBe(1250)
  })

  it('reports a row with no code at all', () => {
    expect(parseLinesCsv(',10').errors).toEqual([{ lineNo: 1, message: 'No item code in the first column.' }])
  })
})
