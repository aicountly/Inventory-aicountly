/**
 * One value resolver for the screen's exports.
 *
 * The CSV file and the print sheet are both built from the register's own
 * column list through the functions below, so the three views cannot disagree
 * about what a column is called, which columns exist, or what a cell says. That
 * is the same guarantee Books gets from `reportExportColumns.js`, and it is why
 * hiding a column in the configurator removes it from the spreadsheet too.
 *
 * All pure — no React, no DOM.
 */

import type { CsvColumn, CsvValue } from '../utils/csv'
import { formatDate, formatDateTime, formatInt, formatMoney, formatQty } from '../utils/format'

/** How a raw value is rendered into text for print (and read by exports). */
export type CellFormat = 'text' | 'amount' | 'qty' | 'int' | 'date' | 'datetime'

export interface ExportableColumn<T> {
  key: string
  /** ReactNode on the real column; only used when it happens to be a string. */
  header?: unknown
  align?: 'left' | 'right' | 'center'
  csv?: (row: T) => CsvValue
  csvHeader?: string
  /** Currency column, for export number formats. */
  amount?: boolean
  exportType?: 'amount' | 'text'
  /** Explicit formatting for print. Set by the shared column builders. */
  format?: CellFormat
}

/**
 * Keys that look like money but are not.
 *
 * Inventory has exactly the trap the spec warns about: `gp_rate` is a
 * percentage, `days_to_expiry` and `lead_time_days` are counts, `turnover` is a
 * ratio. Formatting any of them as rupees in a printed register would be a
 * quietly wrong number on a piece of paper, which is worse than an ugly one.
 */
const NOT_AMOUNT = new Set([
  'gp_rate',
  'gp_percent',
  'margin_percent',
  'turnover',
  'turnover_ratio',
  'days_to_expiry',
  'days_of_cover',
  'days_since_last_out',
  'days_since_last_movement',
  'shelf_life_days',
  'lead_time_days',
  'weighted_age_days',
  'oldest_days',
  'newest_days',
  'sequence_no',
  'line_id',
  'document_id',
  'item_id',
  'batch_id',
  'warehouse_id',
  'movement_id',
  'run_id',
  'layer_id',
  'reservation_id',
  'pending_id',
])

/**
 * `mrp` is in the list because it is one: maximum retail PRICE. It carries no
 * word the pattern already matches, so without it the Items master printed a
 * money column as raw text — "1234.5" on a letterheaded PDF beside "1,234.50"
 * on the screen, and an Excel cell typed as text that will not sum.
 */
const AMOUNT_KEY = /(^|_)(amount|value|cost|price|rate|debit|credit|total|mrp)(_|$)/i

/** Conservative fallback for a column that declares no `format`/`amount`. */
export function isAmountKey(key: string): boolean {
  if (!key || NOT_AMOUNT.has(key)) return false
  return AMOUNT_KEY.test(key)
}

/** The column's export header: `csvHeader`, else a string header, else the key. */
export function columnLabel<T>(col: ExportableColumn<T>): string {
  if (col.csvHeader) return col.csvHeader
  if (typeof col.header === 'string') return col.header
  if (typeof col.header === 'number') return String(col.header)
  return col.key
}

/** Scalars pass through; arrays join; objects become JSON. */
export function rawCsvValue(value: unknown): CsvValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join('; ')
  }
  return JSON.stringify(value)
}

/** The underlying value of one cell: the column's `csv` resolver, else the field. */
export function cellValue<T>(row: T, col: ExportableColumn<T>): CsvValue {
  if (typeof col.csv === 'function') return col.csv(row)
  return rawCsvValue((row as Record<string, unknown>)[col.key])
}

/** The effective format for a column that may not declare one. */
export function cellFormat<T>(col: ExportableColumn<T>): CellFormat {
  if (col.format) return col.format
  if (col.exportType === 'text') return 'text'
  if (col.exportType === 'amount' || col.amount === true) return 'amount'
  if (col.align === 'right' && isAmountKey(col.key)) return 'amount'
  return 'text'
}

/** One cell as printable text. Blank, never `null`, never `undefined`. */
export function cellText<T>(row: T, col: ExportableColumn<T>): string {
  const value = cellValue(row, col)
  if (value === null || value === undefined || value === '') return ''
  switch (cellFormat(col)) {
    case 'amount':
      return formatMoney(value, '')
    case 'qty':
      return formatQty(value, '')
    case 'int':
      return formatInt(value, '')
    case 'date':
      return formatDate(value, '')
    case 'datetime':
      return formatDateTime(value, '')
    default:
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  }
}

/** CSV columns derived from the visible table columns. */
export function toCsvColumns<T>(columns: readonly ExportableColumn<T>[]): CsvColumn<T>[] {
  return columns.map((col) => ({
    header: columnLabel(col),
    value: (row: T) => cellValue(row, col),
  }))
}

/** Print columns derived from the same list. */
export function toPrintColumns<T>(
  columns: readonly ExportableColumn<T>[],
): { key: string; label: string; align?: 'left' | 'right' | 'center' }[] {
  return columns.map((col) => ({ key: col.key, label: columnLabel(col), align: col.align }))
}

/** Pre-formatted print cells, in column order. */
export function toPrintRows<T>(
  rows: readonly T[],
  columns: readonly ExportableColumn<T>[],
): string[][] {
  return rows.map((row) => columns.map((col) => cellText(row, col)))
}
