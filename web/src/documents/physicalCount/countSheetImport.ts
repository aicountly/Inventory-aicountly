/**
 * Reading a count sheet back off a handheld terminal or a spreadsheet.
 *
 * The workflow this file implements is deliberately four steps — parse,
 * validate, preview, apply — and applying is not posting. A file dropped here
 * can never move stock: the most it can do is fill the Counted column of lines
 * that are already loaded, which the operator then sees, corrects and posts by
 * hand. That is the whole reason the matching below refuses to guess.
 *
 * Only quantities are taken from the file. Book quantity stays the server's
 * snapshot, because the point of a count is to compare what is on the shelf
 * with what the system believes, and a file that supplies both sides compares
 * itself.
 */

import { toNumber } from '../../utils/format'
import type { LineDraft } from '../formModel'

export interface ParsedRow {
  /** 1-based line in the file, counting the header — what the reader sees. */
  rowNumber: number
  itemCode: string
  itemName: string
  warehouse: string
  batch: string
  serial: string
  countedQty: string
  uom: string
}

export type MatchProblem =
  | 'item_not_found'
  | 'ambiguous'
  | 'warehouse_not_found'
  | 'batch_not_found'
  | 'invalid_qty'
  | 'duplicate_row'
  | 'missing_qty'

export interface MatchedRow {
  row: ParsedRow
  /** The count line this row fills, when exactly one matched. */
  lineKey: string | null
  qty: number | null
  problem: MatchProblem | null
  message: string | null
}

export interface ImportPreview {
  rows: MatchedRow[]
  matched: MatchedRow[]
  rejected: MatchedRow[]
  /** Loaded lines the file says nothing about — they stay uncounted. */
  untouchedLines: number
}

export const IMPORT_TEMPLATE_HEADERS = [
  'Item Code',
  'Item Name',
  'Warehouse',
  'Batch',
  'Serial Number',
  'Counted Quantity',
  'UOM',
] as const

/**
 * RFC-4180-ish CSV: quoted fields, doubled quotes inside them, CR/LF or LF
 * line endings, and a trailing newline that does not invent an empty row.
 *
 * Written here rather than pulled in: `utils/csv` is the writer, the app has no
 * parser, and a dependency for eight lines of state machine is not worth the
 * bytes on a page a warehouse loads over 4G.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  const input = text.replace(/^﻿/, '')

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Tab-separated files are what several handhelds actually emit. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  if (tabs > commas && tabs > semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** Header spellings accepted for each field, so an exported sheet re-imports. */
const HEADER_ALIASES: Record<keyof Omit<ParsedRow, 'rowNumber'>, string[]> = {
  itemCode: ['itemcode', 'code', 'sku', 'itemsku', 'item'],
  itemName: ['itemname', 'name', 'description', 'itemdescription'],
  warehouse: ['warehouse', 'warehousename', 'location', 'store'],
  batch: ['batch', 'batchno', 'batchnumber', 'lot', 'lotno'],
  serial: ['serial', 'serialno', 'serialnumber', 'serialnos'],
  countedQty: ['countedquantity', 'countedqty', 'counted', 'qty', 'quantity', 'physicalqty', 'physicalquantity'],
  uom: ['uom', 'unit', 'unitofmeasure', 'unitsymbol'],
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Fatal: the file could not be read as a count sheet at all. */
  error: string | null
}

export function parseCountSheet(text: string): ParseResult {
  const grid = parseDelimited(text, detectDelimiter(text))
  if (grid.length === 0) return { rows: [], error: 'The file is empty.' }

  const header = grid[0].map(normaliseHeader)
  const index: Partial<Record<keyof Omit<ParsedRow, 'rowNumber'>, number>> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof Omit<ParsedRow, 'rowNumber'>, string[]][]) {
    const at = header.findIndex((h) => aliases.includes(h))
    if (at >= 0) index[field] = at
  }

  if (index.countedQty === undefined) {
    return { rows: [], error: 'No counted-quantity column found. Expected a header row with “Counted Quantity”.' }
  }
  if (index.itemCode === undefined && index.itemName === undefined) {
    return { rows: [], error: 'No item column found. Expected “Item Code” or “Item Name” in the header row.' }
  }

  const cell = (row: string[], at: number | undefined) => (at === undefined ? '' : (row[at] ?? '').trim())
  const rows = grid.slice(1).map((row, i) => ({
    rowNumber: i + 2,
    itemCode: cell(row, index.itemCode),
    itemName: cell(row, index.itemName),
    warehouse: cell(row, index.warehouse),
    batch: cell(row, index.batch),
    serial: cell(row, index.serial),
    countedQty: cell(row, index.countedQty),
    uom: cell(row, index.uom),
  }))

  return { rows, error: null }
}

function key(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? '').trim().toLowerCase()).join('|')
}

const PROBLEM_MESSAGE: Record<MatchProblem, string> = {
  item_not_found: 'No loaded count line for this item.',
  ambiguous: 'Matches more than one loaded line — add the warehouse or batch column.',
  warehouse_not_found: 'The item is loaded, but not in that warehouse.',
  batch_not_found: 'The item is loaded, but not with that batch.',
  invalid_qty: 'Counted quantity is not a number.',
  missing_qty: 'No counted quantity on this row.',
  duplicate_row: 'A later row in the file counts the same line.',
}

/**
 * Match parsed rows onto the loaded count lines.
 *
 * Matching narrows: item, then warehouse, then batch. A row that still matches
 * two lines after all three is REJECTED rather than applied to the first — an
 * import that quietly picks a line is an import that writes a count against the
 * wrong warehouse, and nothing downstream would ever show it.
 */
export function matchCountSheet(
  parsed: readonly ParsedRow[],
  lines: readonly LineDraft[],
  warehouseName: (id: number | null | undefined) => string,
): ImportPreview {
  const byItem = new Map<string, LineDraft[]>()
  const add = (k: string, line: LineDraft) => {
    if (!k.trim()) return
    byItem.set(k, [...(byItem.get(k) ?? []), line])
  }
  for (const line of lines) {
    add(key(line.item_sku), line)
    add(key(line.item_name), line)
    if (line.item_id !== null) add(key(`#${line.item_id}`), line)
  }

  const seen = new Map<string, number>()
  const rows: MatchedRow[] = parsed.map((row) => {
    const reject = (problem: MatchProblem): MatchedRow => ({
      row,
      lineKey: null,
      qty: null,
      problem,
      message: PROBLEM_MESSAGE[problem],
    })

    if (row.countedQty.trim() === '') return reject('missing_qty')
    const qty = toNumber(row.countedQty)
    if (qty === null) return reject('invalid_qty')

    let candidates = byItem.get(key(row.itemCode)) ?? byItem.get(key(row.itemName)) ?? []
    if (candidates.length === 0) return reject('item_not_found')

    if (row.warehouse.trim()) {
      const narrowed = candidates.filter((l) => key(warehouseName(l.warehouse_id)) === key(row.warehouse))
      if (narrowed.length === 0) return reject('warehouse_not_found')
      candidates = narrowed
    }
    if (row.batch.trim()) {
      const narrowed = candidates.filter((l) => key(l.batch_no) === key(row.batch))
      if (narrowed.length === 0) return reject('batch_not_found')
      candidates = narrowed
    }
    if (candidates.length > 1) return reject('ambiguous')

    const line = candidates[0]
    const previous = seen.get(line.key)
    seen.set(line.key, row.rowNumber)
    const matched: MatchedRow = { row, lineKey: line.key, qty, problem: null, message: null }
    if (previous !== undefined) {
      // The last row wins — a re-scan on a handheld is a correction, not an
      // error — but the earlier row is reported so nobody is surprised.
      matched.message = `Replaces the count from file row ${previous}.`
    }
    return matched
  })

  // An earlier row superseded by a later one is not applied.
  const lastRowForLine = new Map<string, number>()
  for (const m of rows) if (m.lineKey) lastRowForLine.set(m.lineKey, m.row.rowNumber)
  const resolved = rows.map((m) =>
    m.lineKey && lastRowForLine.get(m.lineKey) !== m.row.rowNumber
      ? { ...m, lineKey: null, qty: null, problem: 'duplicate_row' as MatchProblem, message: PROBLEM_MESSAGE.duplicate_row }
      : m,
  )

  const matched = resolved.filter((m) => m.lineKey !== null)
  return {
    rows: resolved,
    matched,
    rejected: resolved.filter((m) => m.lineKey === null),
    untouchedLines: Math.max(0, lines.length - new Set(matched.map((m) => m.lineKey)).size),
  }
}

/** Apply a preview to the draft: only the Counted column, only matched rows. */
export function applyPreview(lines: readonly LineDraft[], preview: ImportPreview): LineDraft[] {
  const counts = new Map<string, number>()
  for (const m of preview.matched) if (m.lineKey && m.qty !== null) counts.set(m.lineKey, m.qty)
  return lines.map((line) => (counts.has(line.key) ? { ...line, physical_qty: String(counts.get(line.key)) } : line))
}
