/**
 * What a master screen writes into a CSV, a spreadsheet or a printed sheet.
 *
 * Every master renders through one `MasterPage`, so every master exports
 * through one derivation: the table's own column list, in the table's own
 * order, resolved to text the same way `registers/registerCells` resolves a
 * register's. Hide a column and it leaves the sheet; add one and it appears,
 * with no second list to keep in step.
 *
 * The inference below is deliberately conservative. A key that is plainly a
 * date, a count or a cost is formatted as one; anything else is written as
 * plain text rather than guessed at, because a quantity printed as rupees is a
 * wrong number on a piece of paper. A column whose meaning lives in its
 * rendering — a badge, an id shown as `#12` — declares `exportValue` and the
 * guess never runs.
 *
 * Pure: no React, no DOM.
 */

import type { CellFormat, ExportableColumn } from '../registers/registerCells'
import { isAmountKey } from '../registers/registerCells'
import type { CsvValue } from '../utils/csv'
import { humanize } from '../utils/format'
import type { MasterColumn } from './types'

/** `is_default`, `has_stock`, `allow_negative` — rendered as a word, not 1/0. */
const FLAG_KEY = /^(is|has|allow|can)_/
const QTY_KEY = /(^|_)qty($|_)|(^|_)quantity($|_)|_on_hand$|^on_hand$/
const COUNT_KEY = /_count$|^count$|_places$|^attempts$|^decimal_places$/

/** The header the sheet prints: the table's, when it is text, else the key. */
export function masterColumnHeader<T>(col: MasterColumn<T>): string {
  if (typeof col.header === 'string' && col.header.trim() !== '') return col.header
  if (typeof col.header === 'number') return String(col.header)
  return humanize(col.key)
}

/** How one master column is formatted on paper. */
export function masterColumnFormat<T>(col: MasterColumn<T>): CellFormat {
  if (col.exportFormat) return col.exportFormat
  const key = col.key
  if (/_at$/.test(key)) return 'datetime'
  if (/_date$/.test(key) || /^(mfg|expiry)_date$/.test(key)) return 'date'
  if (col.align === 'right') {
    if (QTY_KEY.test(key)) return 'qty'
    if (isAmountKey(key)) return 'amount'
    if (COUNT_KEY.test(key)) return 'int'
  }
  return 'text'
}

function flagValue(value: unknown): CsvValue {
  if (value === null || value === undefined || value === '') return ''
  return Number(value) === 1 ? 'Yes' : 'No'
}

/**
 * The value resolver for a column that declares none.
 *
 * `is_active` is the one flag with a name of its own on screen — the table
 * shows an Active / Inactive badge, so the sheet says Active or Inactive too,
 * not `1`. Every other flag reads Yes / No; an absent flag stays blank rather
 * than claiming No.
 */
export function masterColumnValue<T>(col: MasterColumn<T>): ((row: T) => CsvValue) | undefined {
  if (col.exportValue) return col.exportValue
  const key = col.key
  if (key === 'is_active') {
    return (row: T) => {
      const value = (row as Record<string, unknown>)[key]
      if (value === null || value === undefined || value === '') return ''
      return Number(value) === 1 ? 'Active' : 'Inactive'
    }
  }
  if (FLAG_KEY.test(key)) return (row: T) => flagValue((row as Record<string, unknown>)[key])
  return undefined
}

/** The master's table columns as export columns, in the same order. */
export function masterExportColumns<T>(
  columns: readonly MasterColumn<T>[],
): ExportableColumn<T>[] {
  return columns
    .filter((col) => !col.noExport)
    .map((col) => ({
      key: col.key,
      header: col.header,
      csvHeader: masterColumnHeader(col),
      align: col.align,
      format: masterColumnFormat(col),
      csv: masterColumnValue(col),
    }))
}
