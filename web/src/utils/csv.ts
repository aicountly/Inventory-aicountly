/**
 * Client-side CSV export. Pure string building (unit-tested) plus one tiny DOM
 * helper that hands the file to the browser.
 */

import { todayIso } from './format'

export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<T> {
  header: string
  value: (row: T) => CsvValue
}

/**
 * One CSV cell. Strings that a spreadsheet would read as a formula (`=`, `+`,
 * `@`, a bare `-` not followed by a digit) are prefixed with an apostrophe.
 */
export function csvEscape(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const s = String(value)
  const formulaLike = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?(\d|\.\d)/.test(s))
  const guarded = formulaLike ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Header row + one line per row, CRLF-terminated (what spreadsheets expect). */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvEscape(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvEscape(c.value(row))).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** `stock-summary-acme-2025-04-01.csv` from free-form parts. */
export function csvFilename(base: string, scopeLabel = '', date = todayIso()): string {
  const slug = [base, scopeLabel]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'export'}-${date}.csv`
}

/**
 * Parse CSV text into rows of raw string cells — quoted fields, escaped `""`,
 * CR/LF or bare LF line endings. Blank rows are dropped. Good enough for a
 * small hand-filled import sheet; not a streaming parser for large files.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // swallowed; \n (bare or following \r) ends the row
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Trigger a download of `csv` as `filename` (UTF-8 with BOM so Excel reads accents). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
