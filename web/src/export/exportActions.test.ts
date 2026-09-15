import { describe, expect, it } from 'vitest'
import {
  buildTabularPayload,
  exportErrorMessage,
  rowCountMetaLine,
  slugifyExportFilename,
  truncationNote,
} from './exportActions'
import type { ExportableColumn } from '../registers/registerCells'

interface Row {
  item_name: string
  out_qty: number
  value: number
}

const COLUMNS: ExportableColumn<Row>[] = [
  { key: 'item_name', header: 'Item' },
  { key: 'out_qty', header: 'Out qty', align: 'right', format: 'qty' },
  { key: 'value', header: 'Value', align: 'right', format: 'amount' },
]

const ROWS: Row[] = [
  { item_name: 'Widget A', out_qty: 10, value: 1200 },
  { item_name: 'Widget B', out_qty: 4, value: 200 },
]

const REQUEST = {
  columns: COLUMNS,
  rows: ROWS,
  identity: { companyName: 'Acme Ltd', scopeLabel: 'Acme Ltd · FY 2026-27 · Head office' },
  title: 'Stock movement register',
  filenameBase: 'stock-movement-register-acme-2026-09-14',
}

describe('slugifyExportFilename', () => {
  it('joins the parts into one safe, lowercase stem', () => {
    expect(slugifyExportFilename(['Stock Movement Register', 'Acme Ltd', '2026-09-14'])).toBe(
      'stock-movement-register-acme-ltd-2026-09-14',
    )
  })

  it('drops empty parts and collapses punctuation', () => {
    expect(slugifyExportFilename(['A/B', null, '', 'C & D'])).toBe('a-b-c-d')
  })

  it('never returns an empty filename', () => {
    expect(slugifyExportFilename([null, undefined, ''])).toBe('export')
  })
})

describe('exportErrorMessage', () => {
  it('names the remedy when a lazily-loaded export chunk fails', () => {
    const err = new Error('Failed to fetch dynamically imported module: /assets/jspdf-x.js')
    expect(exportErrorMessage(err, 'PDF export failed.')).toBe(
      'Export libraries could not load. Please refresh the page and try again.',
    )
  })

  it('passes a real error through unchanged', () => {
    expect(exportErrorMessage(new Error('Disk full'), 'PDF export failed.')).toBe('Disk full')
  })

  it('falls back when there is no message at all', () => {
    expect(exportErrorMessage(null, 'PDF export failed.')).toBe('PDF export failed.')
  })

  /** `String({})` is "[object Object]", which tells the reader nothing. */
  it('falls back rather than showing a stringified object', () => {
    expect(exportErrorMessage({ status: 500 }, 'PDF export failed.')).toBe('PDF export failed.')
  })
})

/**
 * A short file that says nothing reads as the whole set: the reader sums a
 * column, files the figure and never learns that 2,431 rows were missing.
 */
describe('truncationNote', () => {
  it('states both counts and the difference between them', () => {
    const note = truncationNote(10_000, 12_431)
    expect(note).toContain('10,000 of the 12,431 rows')
    expect(note).toContain('2,431 are not')
    expect(note).toContain('Narrow the filters')
  })

  it('never guesses a count it does not have', () => {
    const note = truncationNote(10_000, 0)
    expect(note).toContain('only the first 10,000 rows')
    expect(note).not.toMatch(/\bof the\b/)
  })
})

describe('rowCountMetaLine', () => {
  it('reads as a fraction when the export is short', () => {
    expect(rowCountMetaLine(10_000, 12_431)).toBe('Rows: 10,000 of 12,431')
  })

  it('reads as a plain count when the export holds everything', () => {
    expect(rowCountMetaLine(412, 412)).toBe('Rows: 412')
  })
})

describe('buildTabularPayload', () => {
  it('carries the identity onto the sheet', () => {
    const payload = buildTabularPayload(REQUEST)
    expect(payload.companyName).toBe('Acme Ltd')
    expect(payload.scopeLabel).toBe('Acme Ltd · FY 2026-27 · Head office')
  })

  /** The whole contract: screen, sheet and paper share one column list. */
  it('derives every surface from the visible columns, in order', () => {
    const payload = buildTabularPayload(REQUEST)
    expect(payload.columns.map((c) => c.key)).toEqual(['item_name', 'out_qty', 'value'])
    expect(payload.columns.map((c) => c.label)).toEqual(['Item', 'Out qty', 'Value'])
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0].value).toEqual({ value: 1200, text: '1,200.00' })
  })

  it('maps the server totals onto the same columns', () => {
    const payload = buildTabularPayload({
      ...REQUEST,
      totalsText: ['Total (412 movements)', '1,204', '4,18,200.00'],
    })
    expect(payload.totalsRow?.item_name.text).toBe('Total (412 movements)')
    expect(payload.totalsRow?.value.text).toBe('4,18,200.00')
  })

  it('has no totals row when the register supplies none', () => {
    expect(buildTabularPayload(REQUEST).totalsRow).toBeNull()
  })

  it('puts the truncation warning in the spreadsheet as well as on the page', () => {
    const payload = buildTabularPayload({ ...REQUEST, warningNote: 'Capped at 10,000 rows.' })
    expect(payload.warningNote).toBe('Capped at 10,000 rows.')
    expect(payload.excelNotes).toContain('Capped at 10,000 rows.')
  })

  it('defaults a register to A4 landscape', () => {
    const payload = buildTabularPayload(REQUEST)
    expect(payload.orientation).toBe('landscape')
    expect(payload.paperSize).toBe('A4')
  })

  it('names the sheet after the register', () => {
    expect(buildTabularPayload(REQUEST).sheetName).toBe('Stock movement register')
  })
})
