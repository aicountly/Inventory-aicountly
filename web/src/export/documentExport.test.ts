import { describe, expect, it } from 'vitest'
import { buildExcelAoa } from './documentExport'
import type { TabularExportPayload } from './documentExport'
import type { ExportColumn, ExportRow } from './exportColumns'

const COLUMNS: ExportColumn[] = [
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 34, pdfWeight: 26 },
  { key: 'out_qty', label: 'Out qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10 },
  { key: 'value', label: 'Value', format: 'amount', align: 'right', excelWidth: 16, pdfWeight: 12 },
]

function row(item: string, qty: number | '', value: number | ''): ExportRow {
  return {
    item_name: { value: item, text: item },
    out_qty: { value: qty, text: qty === '' ? '' : String(qty) },
    value: { value, text: value === '' ? '' : value.toFixed(2) },
  }
}

const PAYLOAD: TabularExportPayload = {
  title: 'Stock movement register',
  companyName: 'Acme Ltd',
  metaLines: ['Period: 01 Apr 2026 to 14 Sep 2026', 'Rows: 2'],
  columns: COLUMNS,
  rows: [row('Widget A', 10, 1200), row('Widget B', 4, 200)],
  filenameBase: 'stock-movement-register',
}

describe('buildExcelAoa', () => {
  it('opens with the company, the title and one row per meta line', () => {
    const { aoa, layout } = buildExcelAoa(PAYLOAD)
    expect(aoa[0]).toEqual(['Acme Ltd'])
    expect(aoa[1]).toEqual(['Stock movement register'])
    expect(aoa[2]).toEqual(['Period: 01 Apr 2026 to 14 Sep 2026'])
    expect(aoa[3]).toEqual(['Rows: 2'])
    expect(aoa[4]).toEqual([])
    expect(layout.metaCount).toBe(2)
  })

  it('puts the column headers where the layout says they are', () => {
    const { aoa, layout } = buildExcelAoa(PAYLOAD)
    expect(aoa[layout.headerRowIndex]).toEqual(['Item', 'Out qty', 'Value'])
    expect(layout.dataStartRow).toBe(layout.headerRowIndex + 1)
    expect(layout.lastCol).toBe(2)
  })

  /**
   * The point of an Excel export over a CSV of formatted strings: a reader can
   * select the column and see the sum. Writing "₹ 1,200.00" makes that zero.
   */
  it('writes amounts as numbers, not as formatted strings', () => {
    const { aoa, layout } = buildExcelAoa(PAYLOAD)
    const firstDataRow = aoa[layout.dataStartRow]
    expect(firstDataRow).toEqual(['Widget A', 10, 1200])
    expect(typeof firstDataRow[2]).toBe('number')
  })

  it('leaves an empty amount empty rather than writing a zero', () => {
    const { aoa, layout } = buildExcelAoa({ ...PAYLOAD, rows: [row('Widget C', '', '')] })
    expect(aoa[layout.dataStartRow]).toEqual(['Widget C', '', ''])
  })

  it('appends the totals row and reports its index', () => {
    const totals: ExportRow = {
      item_name: { value: '', text: '' },
      out_qty: { value: '14', text: '14' },
      value: { value: '1,400.00', text: '1,400.00' },
    }
    const { aoa, layout } = buildExcelAoa({
      ...PAYLOAD,
      totalsRow: totals,
      totalsLabel: 'Total (412 movements)',
    })
    expect(layout.totalsRowIndex).toBe(layout.dataStartRow + 2)
    expect(aoa[layout.totalsRowIndex]).toEqual(['Total (412 movements)', '14', '1,400.00'])
  })

  it('has no totals row index when the register has no totals', () => {
    expect(buildExcelAoa(PAYLOAD).layout.totalsRowIndex).toBe(-1)
  })

  it('writes the notes under the grid, one row each', () => {
    const { aoa, layout } = buildExcelAoa({
      ...PAYLOAD,
      excelNotes: ['Only the first 10,000 rows are included.'],
    })
    expect(aoa[layout.notesStartRow]).toEqual(['Only the first 10,000 rows are included.'])
  })

  it('has exactly one cell per visible column on every data row', () => {
    const { aoa, layout } = buildExcelAoa(PAYLOAD)
    for (let r = layout.dataStartRow; r < layout.dataStartRow + layout.rowCount; r += 1) {
      expect(aoa[r]).toHaveLength(COLUMNS.length)
    }
  })

  it('drops a hidden column from the sheet as well as from the screen', () => {
    const visible = COLUMNS.filter((c) => c.key !== 'out_qty')
    const { aoa, layout } = buildExcelAoa({
      ...PAYLOAD,
      columns: visible,
      rows: [row('Widget A', 10, 1200)],
    })
    expect(aoa[layout.headerRowIndex]).toEqual(['Item', 'Value'])
    expect(aoa[layout.dataStartRow]).toEqual(['Widget A', 1200])
  })

  it('tolerates a register with no meta lines at all', () => {
    const { aoa, layout } = buildExcelAoa({ ...PAYLOAD, metaLines: [] })
    expect(layout.metaCount).toBe(0)
    expect(layout.headerRowIndex).toBe(3)
    expect(aoa[2]).toEqual([])
  })
})
