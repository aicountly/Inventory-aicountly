import { describe, expect, it } from 'vitest'
import { parseImportText } from './ImportLinesModal'

describe('parseImportText', () => {
  it('parses a comma-delimited paste with a full header', () => {
    const { rows, error } = parseImportText('Item,Warehouse,Batch,Qty,Unit,Remarks\nRM-001,Main,B1,10,Kg,Production use')
    expect(error).toBeNull()
    expect(rows).toEqual([{ rowNumber: 2, itemQuery: 'RM-001', warehouseQuery: 'Main', batchText: 'B1', qtyText: '10', unitText: 'Kg', remarks: 'Production use' }])
  })

  it('detects a tab-delimited paste (spreadsheet copy)', () => {
    const { rows, error } = parseImportText('Item\tQty\nRM-002\t5')
    expect(error).toBeNull()
    expect(rows).toEqual([{ rowNumber: 2, itemQuery: 'RM-002', warehouseQuery: '', batchText: '', qtyText: '5', unitText: '', remarks: '' }])
  })

  it('accepts SKU / code / barcode as aliases for the Item column', () => {
    expect(parseImportText('SKU,Qty\nRM-010,1').error).toBeNull()
    expect(parseImportText('Barcode,Qty\n1234567890,1').error).toBeNull()
  })

  it('requires an Item/SKU/code/barcode column in the header', () => {
    const { rows, error } = parseImportText('Warehouse,Qty\nMain,5')
    expect(rows).toEqual([])
    expect(error).toMatch(/header.*item/i)
  })

  it('keeps a comma inside a quoted field intact', () => {
    const { rows } = parseImportText('Item,Remarks\nRM-003,"Used in line A, cell 2"')
    expect(rows[0].remarks).toBe('Used in line A, cell 2')
  })

  it('skips blank lines and rows with no item value', () => {
    const { rows } = parseImportText('Item,Qty\nRM-004,1\n\n,5\nRM-005,2')
    expect(rows.map((r) => r.itemQuery)).toEqual(['RM-004', 'RM-005'])
  })

  it('caps the number of imported rows at 200', () => {
    const body = Array.from({ length: 250 }, (_, i) => `SKU-${i},1`).join('\n')
    const { rows } = parseImportText(`Item,Qty\n${body}`)
    expect(rows).toHaveLength(200)
  })

  it('reports an error for a paste with no rows at all', () => {
    expect(parseImportText('   \n  ').error).toMatch(/paste/i)
  })
})
