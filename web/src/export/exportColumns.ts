/**
 * Screen columns → export columns.
 *
 * The requirement is that the spreadsheet and the printed page carry the same
 * columns and the same totals the reader sees on screen. The only way to
 * guarantee that is to derive all of them from one list, so everything here is
 * built on `registers/registerCells.ts`, which is already the single value
 * resolver behind the table and the CSV. Hide a column in the configurator and
 * it leaves the sheet, the PDF and the paper together — there is no second
 * column list anywhere that could drift.
 *
 * Books does the same through `reportExportColumns.js`; the difference is that
 * Inventory's column list already carries an explicit `format`, so the export
 * does not have to guess from the key as often.
 */

import type { ExportableColumn, CellFormat } from '../registers/registerCells'
import { cellFormat, cellText, cellValue, columnLabel } from '../registers/registerCells'
import { toNumber } from '../utils/format'

export type ExportAlign = 'left' | 'right' | 'center'

export interface ExportColumn {
  key: string
  label: string
  /** Drives alignment, the Excel number format and the PDF font. */
  format: CellFormat
  align: ExportAlign
  /** Width in Excel characters. */
  excelWidth: number
  /** Relative width used by the PDF `columnStyles` and the print `<colgroup>`. */
  pdfWeight: number
  /** Non-INR columns keep their own code in the Excel number format. */
  currencyCode?: string
  /** Red, like a credit in Books. Set for columns that report an outflow. */
  tone?: 'debit' | 'credit'
}

/** A prepared cell: the number Excel should compute on, and the text to print. */
export interface ExportCell {
  value: number | string
  text: string
}

export type ExportRow = Record<string, ExportCell>

const NUMERIC_FORMATS: ReadonlySet<CellFormat> = new Set<CellFormat>(['amount', 'qty', 'int'])

export function isNumericFormat(format: CellFormat): boolean {
  return NUMERIC_FORMATS.has(format)
}

/** Wide enough for a name, narrow enough that a 12-column register still fits. */
function defaultExcelWidth(format: CellFormat, key: string): number {
  if (format === 'amount') return 16
  if (format === 'qty' || format === 'int') return 13
  if (format === 'datetime') return 18
  if (format === 'date') return 13
  if (/(name|label|description|particulars|narration|remarks|notes)/i.test(key)) return 34
  return 20
}

function defaultPdfWeight(format: CellFormat, key: string): number {
  if (format === 'amount') return 12
  if (format === 'qty' || format === 'int') return 10
  if (format === 'datetime') return 14
  if (format === 'date') return 11
  if (/(name|label|description|particulars|narration|remarks|notes)/i.test(key)) return 26
  return 16
}

/**
 * A column whose value is an outflow prints red, the way a credit does in
 * Books. Detected by name because Inventory's movement columns are named for
 * what they are — `out_qty`, `issue_value`, `consumed_amount`.
 */
function defaultTone(key: string): 'credit' | undefined {
  return /(^|_)(out|issue|issued|consumed|scrap|scrapped|outward|credit)(_|$)/i.test(key)
    ? 'credit'
    : undefined
}

/** Export descriptors for the columns currently visible on screen. */
export function toExportColumns<T>(columns: readonly ExportableColumn<T>[]): ExportColumn[] {
  return columns.map((col) => {
    const format = cellFormat(col)
    const align: ExportAlign = col.align ?? (isNumericFormat(format) ? 'right' : 'left')
    return {
      key: col.key,
      label: columnLabel(col),
      format,
      align,
      excelWidth: defaultExcelWidth(format, col.key),
      pdfWeight: defaultPdfWeight(format, col.key),
      tone: format === 'amount' || format === 'qty' ? defaultTone(col.key) : undefined,
    }
  })
}

/**
 * One cell, twice: as a number for Excel to add up, and as the exact text the
 * table shows. Excel gets the raw figure — a spreadsheet of pre-formatted
 * strings cannot be summed, which is the first thing a reader tries.
 *
 * The number is resolved by `toNumber`, which is the *same* resolver
 * `cellText` used to produce the text, dispatched by the column's own
 * `format`. That is the whole point: a second, looser coercion here (strip the
 * commas, call `Number`) accepted strings the formatters reject, and a cell the
 * printed register left blank then carried a figure in the spreadsheet — the
 * two surfaces disagreeing about the same cell. One resolver, one number, and
 * the sheet and the paper cannot drift.
 */
export function toExportCell<T>(row: T, col: ExportableColumn<T>): ExportCell {
  const format = cellFormat(col)
  const text = cellText(row, col)
  if (!isNumericFormat(format)) return { value: text, text }

  // A blank stays blank. Writing 0 into an empty cell invents a figure, and a
  // column of invented zeroes changes the average and the count the reader
  // then computes over it. A cell whose value the column's own formatter could
  // not read is blank on paper, so it is blank in the spreadsheet too.
  if (text === '') return { value: '', text }
  const n = toNumber(cellValue(row, col))
  if (n === null) return { value: text, text }
  return { value: n, text }
}

export function toExportRows<T>(
  rows: readonly T[],
  columns: readonly ExportableColumn<T>[],
): ExportRow[] {
  return rows.map((row) => {
    const out: ExportRow = {}
    for (const col of columns) out[col.key] = toExportCell(row, col)
    return out
  })
}

/**
 * `"₹ 1,28,175.00"` → `128175`. Returns null for anything that is not purely a
 * formatted number — `Total (412 movements)`, `—`, a percentage with a suffix.
 */
export function parseFormattedNumber(text: string): number | null {
  const cleaned = text.replace(/[₹\s,]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * The totals row, widened to the export shape.
 *
 * The figures arrive as text because they come from the *server's* summary over
 * the whole filtered set via `totalsRowToText` — re-summing the visible rows
 * here would silently turn the register's headline figure into a page subtotal.
 *
 * The text is what the page prints, unchanged. Excel additionally gets the
 * number behind it where the cell is purely a formatted figure, so the totals
 * row is right-aligned, carries the column's currency format, and can be
 * checked against a `SUM` of the column above it. A label such as
 * `Total (412 movements)` has no number and stays text.
 */
export function toExportTotals(
  columns: readonly ExportColumn[],
  totalsText: readonly string[] | null | undefined,
): ExportRow | null {
  if (!totalsText || totalsText.length === 0) return null
  const out: ExportRow = {}
  let seen = false
  columns.forEach((col, index) => {
    const text = totalsText[index] ?? ''
    if (text) seen = true
    const numeric = text && isNumericFormat(col.format) ? parseFormattedNumber(text) : null
    out[col.key] = { value: numeric ?? text, text }
  })
  return seen ? out : null
}

/** Excel number format for a column. */
export function excelNumberFormat(col: ExportColumn): string | undefined {
  switch (col.format) {
    case 'amount':
      return col.currencyCode && col.currencyCode !== 'INR'
        ? `"${col.currencyCode} "#,##0.00`
        : '"₹ "#,##0.00'
    case 'qty':
      return '#,##0.####'
    case 'int':
      return '#,##0'
    default:
      return undefined
  }
}

/** Proportional widths, as percentages that sum to 100. */
export function columnWidthPercents(columns: readonly ExportColumn[]): number[] {
  const total = columns.reduce((sum, col) => sum + (col.pdfWeight || 1), 0)
  if (total <= 0) return columns.map(() => 100 / Math.max(columns.length, 1))
  return columns.map((col) => ((col.pdfWeight || 1) / total) * 100)
}
