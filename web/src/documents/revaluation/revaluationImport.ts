/**
 * Reading a column of codes and rates out of a spreadsheet.
 *
 * Pure text in, rows out — it resolves nothing and fetches nothing, so it is unit-tested. What the
 * codes mean is decided afterwards by `resolveItemCode`, against the same endpoint the scanner uses.
 */

import { toNumber } from '../../utils/format'

export interface ParsedRateRow {
  /** 1-based line number in the pasted text, for the error list. */
  row: number
  code: string
  /** The new unit cost as written; null when the cell was empty or not a number. */
  newUnitCost: number | null
  remarks: string
  /** Why the row cannot be used, if it cannot. */
  problem: string | null
}

export interface ParsedRates {
  rows: ParsedRateRow[]
  /** The header row that was skipped, if one was recognised. */
  headerSkipped: boolean
  delimiter: string
}

const DELIMITERS = ['\t', ',', ';', '|'] as const
const HEADER_WORDS = /\b(sku|code|barcode|item|rate|cost|price|remark|narration)\b/i

/** The delimiter that splits the most lines into the same number of cells. */
function detectDelimiter(lines: readonly string[]): string {
  let best: string = DELIMITERS[0]
  let bestScore = 0
  for (const candidate of DELIMITERS) {
    const counts = lines.slice(0, 20).map((l) => splitRow(l, candidate).length)
    const score = counts.filter((c) => c >= 2).length
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** One CSV row, honouring double quotes so a remark may contain the delimiter. */
export function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === delimiter) {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

/**
 * `SKU, new cost, remarks` — in that order, with or without a header row.
 *
 * A single-column paste is accepted too: it means "add these items", and the cost is entered on
 * the grid afterwards.
 */
export function parseRateRows(text: string): ParsedRates {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return { rows: [], headerSkipped: false, delimiter: ',' }

  const delimiter = detectDelimiter(lines)
  const first = splitRow(lines[0], delimiter)
  // A header is a first row whose second cell is not a number but whose cells read like column names.
  const headerSkipped = first.length >= 2 && toNumber(first[1]) === null && first.some((c) => HEADER_WORDS.test(c))
  const body = headerSkipped ? lines.slice(1) : lines

  const rows = body.map((line, index) => {
    const cells = splitRow(line, delimiter)
    const code = cells[0] ?? ''
    const rawCost = cells[1] ?? ''
    const remarks = (cells[2] ?? '').slice(0, 255)
    const row = index + 1 + (headerSkipped ? 1 : 0)
    if (!code) return { row, code, newUnitCost: null, remarks, problem: 'No SKU or barcode in the first column.' }
    if (rawCost === '') return { row, code, newUnitCost: null, remarks, problem: null }
    const cost = toNumber(stripCurrency(rawCost))
    if (cost === null) return { row, code, newUnitCost: null, remarks, problem: `“${rawCost}” is not a number.` }
    if (cost <= 0) return { row, code, newUnitCost: null, remarks, problem: 'The new cost must be greater than zero.' }
    return { row, code, newUnitCost: cost, remarks, problem: null }
  })

  return { rows, headerSkipped, delimiter }
}

/**
 * `₹1,23,456.78` → `123456.78`. Drops the symbol and the grouping without eating the decimal.
 *
 * Which separator is which is a guess, so the guess is spelled out: with both present the later one
 * is the decimal point. With only commas, Indian or Western grouping (`46,500`, `1,23,456`) is
 * grouping and anything else (`1234,56`) is a decimal comma. With only dots, more than one is
 * grouping and a single one is a decimal point.
 */
export function stripCurrency(value: string): string {
  const cleaned = value.replace(/[^\d.,\-]/g, '').trim()
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    return lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '')
  }
  if (lastComma >= 0) {
    return /^-?\d{1,3}(,\d{2,3})+$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.')
  }
  return cleaned.split('.').length > 2 ? cleaned.replace(/\./g, '') : cleaned
}
