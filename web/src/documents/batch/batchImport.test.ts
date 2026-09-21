import { describe, expect, it } from 'vitest'
import { IMPORT_ROW_LIMIT, IMPORT_TEMPLATE, parseImportRows, splitDelimited } from './batchImport'

describe('splitting a delimited line', () => {
  it('trims each field', () => {
    expect(splitDelimited('a , b ,c', ',')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a delimiter that sits inside quotes', () => {
    expect(splitDelimited('ITEM-1,10,"Damaged, then re-lotted"', ',')).toEqual(['ITEM-1', '10', 'Damaged, then re-lotted'])
  })

  it('reads a doubled quote as one quote', () => {
    expect(splitDelimited('"say ""hi""",2', ',')).toEqual(['say "hi"', '2'])
  })

  it('keeps empty fields so the column positions still line up', () => {
    expect(splitDelimited('ITEM-1,,,BATCH-B', ',')).toEqual(['ITEM-1', '', '', 'BATCH-B'])
  })
})

describe('reading rows out of a pasted sheet', () => {
  it('uses a header row when it recognises one', () => {
    const rows = parseImportRows('sku,qty,direction,from_batch,to_batch,note\nITEM-AX45,10,out,BATCH-A,BATCH-B,Damaged')
    expect(rows).toEqual([{ row: 2, sku: 'ITEM-AX45', qty: '10', direction: 'out', fromBatch: 'BATCH-A', toBatch: 'BATCH-B', note: 'Damaged' }])
  })

  it('accepts the names a real export uses', () => {
    const rows = parseImportRows('Item Code,Quantity,Dir,Current Batch,Revised Batch,Remarks\nITEM-AX45,4,in,BATCH-A,BATCH-B,Re-lotted')
    expect(rows[0].sku).toBe('ITEM-AX45')
    expect(rows[0].direction).toBe('in')
    expect(rows[0].fromBatch).toBe('BATCH-A')
    expect(rows[0].toBatch).toBe('BATCH-B')
    expect(rows[0].note).toBe('Re-lotted')
  })

  it('reads the declared column order when there is no header', () => {
    const rows = parseImportRows('ITEM-AX45,10,out,BATCH-A,BATCH-B,Damaged')
    expect(rows).toEqual([{ row: 1, sku: 'ITEM-AX45', qty: '10', direction: 'out', fromBatch: 'BATCH-A', toBatch: 'BATCH-B', note: 'Damaged' }])
  })

  it('handles tab-separated text, which is what a spreadsheet puts on the clipboard', () => {
    const rows = parseImportRows('ITEM-1\t5\tin\tB1\tB2\tnote')
    expect(rows[0]).toMatchObject({ sku: 'ITEM-1', qty: '5', direction: 'in', fromBatch: 'B1', toBatch: 'B2' })
  })

  it('reads the short forms of a direction and leaves anything else unset', () => {
    expect(parseImportRows('A,1,I')[0].direction).toBe('in')
    expect(parseImportRows('A,1,O')[0].direction).toBe('out')
    expect(parseImportRows('A,1,inward')[0].direction).toBeNull()
    expect(parseImportRows('A,1,')[0].direction).toBeNull()
  })

  it('strips everything but digits and a point out of a quantity', () => {
    expect(parseImportRows('A,"1,250.5",out')[0].qty).toBe('1250.5')
    expect(parseImportRows('A,10 Nos,out')[0].qty).toBe('10')
  })

  it('skips blank lines and rows with neither an item nor a quantity', () => {
    expect(parseImportRows('sku,qty\nITEM-1,5\n\n,\nITEM-2,6')).toHaveLength(2)
  })

  it('stops at the row limit rather than resolving an entire mis-pasted file', () => {
    const many = Array.from({ length: IMPORT_ROW_LIMIT + 25 }, (_, i) => `ITEM-${i},1,out`).join('\n')
    expect(parseImportRows(many)).toHaveLength(IMPORT_ROW_LIMIT)
  })

  it('returns nothing for empty text', () => {
    expect(parseImportRows('')).toEqual([])
    expect(parseImportRows('\n \n')).toEqual([])
  })

  it('reads its own template', () => {
    const rows = parseImportRows(IMPORT_TEMPLATE)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in'])
  })
})
