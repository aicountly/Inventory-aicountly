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

// ---- CSV import (parsing) --------------------------------------------------

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

/**
 * Parses CSV text into a header row and data rows. Handles quoted fields
 * (embedded commas, newlines and doubled `""` escapes), a leading BOM, and
 * both `\n` and `\r\n` line endings. Blank lines are dropped.
 *
 * The counterpart to `toCsv`: that one writes what this one reads, so a file
 * downloaded from "Download Template" round-trips through this parser.
 */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
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
      // swallow; \n (bare or in \r\n) ends the row
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

  const nonBlank = rows.filter((r) => r.length > 1 || r[0]?.trim() !== '')
  const [headerRow, ...dataRows] = nonBlank
  return { headers: (headerRow ?? []).map((h) => h.trim()), rows: dataRows }
}

/** `parseCsv`'s rows as header-keyed, trimmed records. A short row leaves the missing columns ''. */
export function csvRecords(parsed: ParsedCsv): Record<string, string>[] {
  return parsed.rows.map((cells) => {
    const record: Record<string, string> = {}
    parsed.headers.forEach((header, i) => {
      record[header] = (cells[i] ?? '').trim()
    })
    return record
  })
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
