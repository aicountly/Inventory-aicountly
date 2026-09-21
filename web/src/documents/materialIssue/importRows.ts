/**
 * Reading item lines out of a spreadsheet.
 *
 * Everything here is pure: a workbook (or a CSV) is turned into an array of
 * arrays by the dialog — xlsx-js-style is loaded on demand, it is ~1.5 MB and
 * nobody who does not import pays for it — and the mapping, the header
 * matching and the row validation happen here, where they are unit-tested.
 *
 * Nothing in this file touches the network. A parsed row names an item by SKU
 * or by name; resolving that to an item_id is the dialog's job, through the
 * live item search, because only the server knows what the codes mean.
 */

export interface ImportedRow {
  /** 1-based row number in the sheet, counting the header — what the user sees. */
  row: number
  sku: string
  itemName: string
  warehouse: string
  batch: string
  serials: string[]
  qty: number
  unit: string
  remarks: string
}

export interface ImportIssue {
  row: number
  message: string
}

export interface ImportParseResult {
  rows: ImportedRow[]
  issues: ImportIssue[]
  /** Recognised column keys, in sheet order — drives the "columns matched" line. */
  matched: ImportColumn[]
}

export type ImportColumn = 'sku' | 'itemName' | 'warehouse' | 'batch' | 'serials' | 'qty' | 'unit' | 'remarks'

/** The template the dialog offers, in the order the columns are written. */
export const IMPORT_TEMPLATE_HEADERS: readonly string[] = ['SKU', 'Item', 'Warehouse', 'Batch', 'Serial', 'Quantity', 'Unit', 'Remarks']

/**
 * Header spellings that mean the same column.
 *
 * Matched on the squashed form (lower case, letters and digits only), so
 * "Batch No.", "batch_no" and "BATCH NO" are one key without nine entries each.
 */
const HEADER_ALIASES: Record<string, ImportColumn> = {
  sku: 'sku',
  itemsku: 'sku',
  itemcode: 'sku',
  code: 'sku',
  barcode: 'sku',
  upc: 'sku',
  item: 'itemName',
  itemname: 'itemName',
  name: 'itemName',
  description: 'itemName',
  warehouse: 'warehouse',
  warehousename: 'warehouse',
  store: 'warehouse',
  godown: 'warehouse',
  batch: 'batch',
  batchno: 'batch',
  lot: 'batch',
  lotno: 'batch',
  serial: 'serials',
  serials: 'serials',
  serialno: 'serials',
  serialnos: 'serials',
  serialnumbers: 'serials',
  qty: 'qty',
  quantity: 'qty',
  issueqty: 'qty',
  issuequantity: 'qty',
  unit: 'unit',
  uom: 'unit',
  unitofmeasure: 'unit',
  remarks: 'remarks',
  remark: 'remarks',
  note: 'remarks',
  notes: 'remarks',
}

export function normaliseHeader(header: unknown): string {
  return String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Split a cell that may hold several serial numbers.
 *
 * Comma, semicolon, pipe and newline all separate, because every one of them
 * comes out of some other system's export.
 */
export function splitSerials(value: unknown): string[] {
  return cell(value)
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A quantity as a spreadsheet may hold it: a number, "1,250", or "12.5 kg". */
export function parseQty(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = cell(value).replace(/,/g, '')
  if (!raw) return null
  const m = /^-?\d*\.?\d+/.exec(raw)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * A delimited text file as rows of cells (RFC 4180: quoted fields, doubled
 * quotes, embedded separators and newlines). Tab-separated files are detected
 * from the header line, because that is what a paste out of Excel produces.
 */
export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.slice(0, source.search(/\r?\n/) === -1 ? source.length : source.search(/\r?\n/))
  const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === sep) {
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
  // A trailing newline has already pushed its row, so nothing is added here and
  // the file does not gain a phantom last line.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Blank lines are kept. They are what makes row 7 of the parsed sheet row 7
  // of the file the user is looking at; parseImportSheet skips them.
  return rows
}

/**
 * Map a sheet to rows the line editor can take.
 *
 * The first non-empty row is the header. A row that names no item, or carries
 * no usable quantity, comes back as an issue rather than a line — an import
 * that quietly drops half a file is worse than one that refuses it.
 */
export function parseImportSheet(aoa: unknown[][]): ImportParseResult {
  const issues: ImportIssue[] = []
  // Blank rows are skipped where they are met, not filtered out first: a row
  // number in a message has to be the row the user sees in the spreadsheet, and
  // compacting the sheet first shifts every number after the first gap.
  const filled = (r: unknown): r is unknown[] => Array.isArray(r) && r.some((c) => cell(c) !== '')
  const headerAt = aoa.findIndex(filled)
  if (headerAt === -1) return { rows: [], issues: [{ row: 0, message: 'The file is empty.' }], matched: [] }

  const columns: (ImportColumn | null)[] = aoa[headerAt].map((h) => HEADER_ALIASES[normaliseHeader(h)] ?? null)
  const matched = [...new Set(columns.filter((c): c is ImportColumn => c !== null))]

  const headerRowNo = headerAt + 1
  if (!matched.includes('sku') && !matched.includes('itemName')) {
    return { rows: [], issues: [{ row: headerRowNo, message: 'No SKU or Item column found. The first row must be a header.' }], matched }
  }
  if (!matched.includes('qty')) {
    return { rows: [], issues: [{ row: headerRowNo, message: 'No Quantity column found. The first row must be a header.' }], matched }
  }

  const rows: ImportedRow[] = []
  for (let r = headerAt + 1; r < aoa.length; r += 1) {
    const raw = aoa[r]
    if (!filled(raw)) continue
    const rowNo = r + 1
    const pick = (key: ImportColumn): unknown => {
      const at = columns.indexOf(key)
      return at === -1 ? '' : raw[at]
    }
    const sku = cell(pick('sku'))
    const itemName = cell(pick('itemName'))
    if (!sku && !itemName) {
      issues.push({ row: rowNo, message: 'No SKU or item name.' })
      continue
    }
    const qty = parseQty(pick('qty'))
    if (qty === null) {
      issues.push({ row: rowNo, message: `${sku || itemName}: quantity is missing or not a number.` })
      continue
    }
    if (qty <= 0) {
      issues.push({ row: rowNo, message: `${sku || itemName}: quantity must be greater than zero.` })
      continue
    }
    rows.push({
      row: rowNo,
      sku,
      itemName,
      warehouse: cell(pick('warehouse')),
      batch: cell(pick('batch')),
      serials: splitSerials(pick('serials')),
      qty,
      unit: cell(pick('unit')),
      remarks: cell(pick('remarks')),
    })
  }
  return { rows, issues, matched }
}
