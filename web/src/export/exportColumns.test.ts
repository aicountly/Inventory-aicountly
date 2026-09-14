import { describe, expect, it } from 'vitest'
import {
  columnWidthPercents,
  parseFormattedNumber,
  excelNumberFormat,
  isNumericFormat,
  toExportCell,
  toExportColumns,
  toExportRows,
  toExportTotals,
} from './exportColumns'
import type { ExportableColumn } from '../registers/registerCells'

interface Row {
  item_name: string
  out_qty: number | null
  stock_value: number | null
  gp_rate: number
  days_to_expiry: number
  movement_date: string
}

const COLUMNS: ExportableColumn<Row>[] = [
  { key: 'item_name', header: 'Item' },
  { key: 'movement_date', header: 'Date', format: 'date' },
  { key: 'out_qty', header: 'Out qty', align: 'right', format: 'qty' },
  { key: 'stock_value', header: 'Stock value', align: 'right', format: 'amount' },
  { key: 'gp_rate', header: 'GP %', align: 'right', exportType: 'text' },
  { key: 'days_to_expiry', header: 'Days to expiry', align: 'right' },
]

const ROW: Row = {
  item_name: 'Widget A',
  out_qty: 12.5,
  stock_value: 1200.5,
  gp_rate: 18.25,
  days_to_expiry: 40,
  movement_date: '2026-04-18',
}

describe('toExportColumns', () => {
  it('carries the label the screen shows', () => {
    expect(toExportColumns(COLUMNS).map((c) => c.label)).toEqual([
      'Item', 'Date', 'Out qty', 'Stock value', 'GP %', 'Days to expiry',
    ])
  })

  it('prefers csvHeader when a column names its export header separately', () => {
    const [col] = toExportColumns<Row>([{ key: 'item_name', header: 'Item', csvHeader: 'Item name' }])
    expect(col.label).toBe('Item name')
  })

  it('falls back to the key when the header is a React node', () => {
    const [col] = toExportColumns<Row>([{ key: 'item_name', header: { type: 'span' } }])
    expect(col.label).toBe('item_name')
  })

  it('carries the declared format through to alignment and width', () => {
    const cols = toExportColumns(COLUMNS)
    expect(cols[0]).toMatchObject({ format: 'text', align: 'left' })
    expect(cols[2]).toMatchObject({ format: 'qty', align: 'right' })
    expect(cols[3]).toMatchObject({ format: 'amount', align: 'right' })
    expect(cols[0].excelWidth).toBeGreaterThan(cols[3].excelWidth)
    expect(cols[0].pdfWeight).toBeGreaterThan(cols[3].pdfWeight)
  })

  /**
   * The trap the spec calls out: a key ending in `rate` reads as money to a
   * naive heuristic, and `days_to_expiry` reads as a count of rupees. Both
   * would be quietly wrong numbers on a printed page.
   */
  it('does not treat a percentage or a day count as money', () => {
    const cols = toExportColumns(COLUMNS)
    expect(cols.find((c) => c.key === 'gp_rate')?.format).toBe('text')
    expect(cols.find((c) => c.key === 'days_to_expiry')?.format).toBe('text')
  })

  it('marks outward columns red, the way a credit is red in Books', () => {
    const cols = toExportColumns(COLUMNS)
    expect(cols.find((c) => c.key === 'out_qty')?.tone).toBe('credit')
    expect(cols.find((c) => c.key === 'stock_value')?.tone).toBeUndefined()
  })
})

describe('toExportCell', () => {
  it('gives Excel the number and the page the formatted text', () => {
    const cell = toExportCell(ROW, COLUMNS[3])
    expect(cell.value).toBe(1200.5)
    expect(cell.text).toBe('1,200.50')
  })

  it('leaves a blank cell blank rather than writing a zero', () => {
    const cell = toExportCell({ ...ROW, stock_value: null }, COLUMNS[3])
    expect(cell.value).toBe('')
    expect(cell.text).toBe('')
  })

  it('keeps a text column as text on both surfaces', () => {
    const cell = toExportCell(ROW, COLUMNS[0])
    expect(cell.value).toBe('Widget A')
    expect(cell.text).toBe('Widget A')
  })

  it('formats a date the way the table does', () => {
    expect(toExportCell(ROW, COLUMNS[1]).text).toBe('18 Apr 2026')
  })

  it('honours a column’s own csv resolver', () => {
    const col: ExportableColumn<Row> = {
      key: 'derived',
      header: 'Derived',
      format: 'amount',
      csv: (row) => (row.stock_value ?? 0) * 2,
    }
    expect(toExportCell(ROW, col).value).toBe(2401)
  })
})

describe('toExportRows', () => {
  it('produces one entry per visible column, keyed by column key', () => {
    const rows = toExportRows([ROW], COLUMNS)
    expect(Object.keys(rows[0])).toEqual(COLUMNS.map((c) => c.key))
  })

  it('hiding a column removes it from the export', () => {
    const visible = COLUMNS.filter((c) => c.key !== 'gp_rate')
    const rows = toExportRows([ROW], visible)
    expect(Object.keys(rows[0])).not.toContain('gp_rate')
  })
})

describe('toExportTotals', () => {
  const cols = toExportColumns(COLUMNS)

  it('maps the totals text onto the columns in order', () => {
    const totals = toExportTotals(cols, ['Total (2 rows)', '', '25', '2,401.00', '', ''])
    expect(totals?.item_name.text).toBe('Total (2 rows)')
    expect(totals?.stock_value.text).toBe('2,401.00')
    expect(totals?.gp_rate.text).toBe('')
  })

  it('is null when there is no totals row, and when every cell is blank', () => {
    expect(toExportTotals(cols, null)).toBeNull()
    expect(toExportTotals(cols, ['', '', '', '', '', ''])).toBeNull()
  })

  /**
   * The page prints the register's own formatting; Excel gets the number
   * behind it so a reader can check the footer against a SUM of the column.
   */
  it('gives Excel the number behind a formatted total, and the page the text', () => {
    const totals = toExportTotals(cols, ['Total (2 rows)', '', '25', '2,401.00', '', ''])
    expect(totals?.stock_value).toEqual({ value: 2401, text: '2,401.00' })
    expect(totals?.out_qty).toEqual({ value: 25, text: '25' })
  })

  it('leaves a label as text — it is not a number', () => {
    const totals = toExportTotals(cols, ['Total (2 rows)', '', '25', '2,401.00', '', ''])
    expect(totals?.item_name).toEqual({ value: 'Total (2 rows)', text: 'Total (2 rows)' })
  })

  it('does not invent a number for a total the register could not format', () => {
    const totals = toExportTotals(cols, ['Total', '', '—', 'mixed units', '', ''])
    expect(totals?.out_qty.value).toBe('—')
    expect(totals?.stock_value.value).toBe('mixed units')
  })
})

describe('parseFormattedNumber', () => {
  it('reads Indian grouping and a rupee sign', () => {
    expect(parseFormattedNumber('₹ 1,28,175.00')).toBe(128175)
    expect(parseFormattedNumber('4,18,200.50')).toBe(418200.5)
  })

  it('reads a negative, in either notation', () => {
    expect(parseFormattedNumber('-1,200.00')).toBe(-1200)
    expect(parseFormattedNumber('(1,200.00)')).toBe(-1200)
  })

  it('refuses anything that is not purely a figure', () => {
    expect(parseFormattedNumber('Total (412 movements)')).toBeNull()
    expect(parseFormattedNumber('12 Nos')).toBeNull()
    expect(parseFormattedNumber('18.25%')).toBeNull()
    expect(parseFormattedNumber('—')).toBeNull()
    expect(parseFormattedNumber('')).toBeNull()
  })
})

describe('number formats and widths', () => {
  it('formats amounts in rupees and quantities without a currency', () => {
    const cols = toExportColumns(COLUMNS)
    expect(excelNumberFormat(cols[3])).toBe('"₹ "#,##0.00')
    expect(excelNumberFormat(cols[2])).toBe('#,##0.####')
    expect(excelNumberFormat(cols[0])).toBeUndefined()
  })

  it('keeps a foreign currency’s own code', () => {
    const cols = toExportColumns(COLUMNS)
    expect(excelNumberFormat({ ...cols[3], currencyCode: 'USD' })).toBe('"USD "#,##0.00')
  })

  it('knows which formats are numeric', () => {
    expect(isNumericFormat('amount')).toBe(true)
    expect(isNumericFormat('qty')).toBe(true)
    expect(isNumericFormat('int')).toBe(true)
    expect(isNumericFormat('date')).toBe(false)
    expect(isNumericFormat('text')).toBe(false)
  })

  it('turns weights into percentages that fill the page exactly', () => {
    const pct = columnWidthPercents([
      { key: 'a', label: 'A', format: 'text', align: 'left', excelWidth: 1, pdfWeight: 3 },
      { key: 'b', label: 'B', format: 'text', align: 'left', excelWidth: 1, pdfWeight: 1 },
    ])
    expect(pct).toEqual([75, 25])
    expect(pct.reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })
})
