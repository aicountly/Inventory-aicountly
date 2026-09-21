import { describe, expect, it } from 'vitest'
import { parseItemText, parseQty, splitRow } from './pasteItems'

describe('splitRow', () => {
  it('splits on the delimiter', () => {
    expect(splitRow('A,B,C', ',')).toEqual(['A', 'B', 'C'])
  })

  it('honours quoted fields and doubled quotes', () => {
    expect(splitRow('"Widget, large",5', ',')).toEqual(['Widget, large', '5'])
    expect(splitRow('"He said ""hi""",1', ',')).toEqual(['He said "hi"', '1'])
  })

  it('returns the whole line when there is no delimiter', () => {
    expect(splitRow('  DEL-14-001  ', '')).toEqual(['DEL-14-001'])
  })
})

describe('parseItemText', () => {
  it('reads a tab-separated SKU / quantity block', () => {
    const result = parseItemText('DEL-14-001\t5\nWM-001\t10')
    expect(result.delimiter).toBe('tab')
    expect(result.headerRow).toBe(false)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ code: 'DEL-14-001', qty: '5' })
    expect(result.rows[1]).toMatchObject({ code: 'WM-001', qty: '10' })
  })

  it('detects a header row and maps columns by name in any order', () => {
    const result = parseItemText('Quantity,Warehouse,SKU\n5,Main,DEL-14-001')
    expect(result.headerRow).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ code: 'DEL-14-001', qty: '5', warehouse: 'Main' })
  })

  it('treats a single column as codes with no quantity', () => {
    const result = parseItemText('DEL-14-001\nWM-001')
    expect(result.delimiter).toBe('none')
    expect(result.rows.map((r) => r.code)).toEqual(['DEL-14-001', 'WM-001'])
    expect(result.rows[0].qty).toBe('')
  })

  it('splits a serial cell into individual numbers', () => {
    const result = parseItemText('SKU,QTY,Warehouse,Batch,Serials\nSN-ITEM,2,Main,B1,"SN-1 SN-2"')
    expect(result.rows[0].serials).toEqual(['SN-1', 'SN-2'])
  })

  it('flags a row with no item code instead of dropping it', () => {
    const result = parseItemText('DEL-14-001,5\n,7')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1].problem).toBeTruthy()
  })

  it('ignores blank lines, trailing whitespace and CRLF', () => {
    const result = parseItemText('DEL-14-001,5\r\n\r\nWM-001,10   \r\n')
    expect(result.rows).toHaveLength(2)
  })

  it('caps the number of rows it will read', () => {
    const text = Array.from({ length: 20 }, (_, i) => `SKU-${i},1`).join('\n')
    expect(parseItemText(text, { maxRows: 5 }).rows).toHaveLength(5)
  })

  it('returns nothing for empty input', () => {
    expect(parseItemText('   \n  ').rows).toEqual([])
  })

  it('reports the source line number, allowing for the header', () => {
    const result = parseItemText('SKU,QTY\nA,1\nB,2')
    expect(result.rows.map((r) => r.index)).toEqual([2, 3])
  })
})

describe('parseQty', () => {
  it('reads grouped and annotated numbers', () => {
    expect(parseQty('1,200.50')).toBe(1200.5)
    expect(parseQty('12 nos')).toBe(12)
    expect(parseQty('  7 ')).toBe(7)
  })

  it('returns null when there is no number', () => {
    expect(parseQty('')).toBeNull()
    expect(parseQty('abc')).toBeNull()
    expect(parseQty('-')).toBeNull()
  })
})
