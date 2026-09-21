/**
 * Reading a batch file: parse, map, validate.
 *
 * Pure functions, no fetching and no DOM, so the part of an import that is easy
 * to get quietly wrong — a quoted comma, a `31/03/2028`, an expiry before the
 * manufacturing date — is unit tested rather than discovered by a user who has
 * already pressed Import.
 *
 * What this file deliberately does NOT do is decide whether a batch is
 * acceptable. It catches what it can so the reader sees the problem before the
 * round trip, but `POST /v1/batches` is the authority on every domain rule:
 * the item must exist, be active and be batch-tracked, and the batch number
 * must be unique for that item. A row that passes here can still be refused
 * there, and the import reports exactly what the API said.
 */

export type ImportSeverity = 'valid' | 'warning' | 'error'

/** One target column, as offered in the mapping step. */
export interface BatchImportField {
  key: string
  label: string
  required?: boolean
  hint?: string
  /** Header fragments that auto-select this column, lower-cased. */
  aliases: readonly string[]
}

export const BATCH_IMPORT_FIELDS: readonly BatchImportField[] = [
  {
    key: 'item',
    label: 'Item (SKU or name)',
    required: true,
    hint: 'Matched against the item SKU first, then the exact item name.',
    aliases: ['item', 'item sku', 'sku', 'item code', 'item name', 'product'],
  },
  { key: 'batch_no', label: 'Batch number', required: true, aliases: ['batch', 'batch no', 'batch number', 'batch_no'] },
  { key: 'lot_no', label: 'Lot number', aliases: ['lot', 'lot no', 'lot number', 'lot_no'] },
  { key: 'mfg_date', label: 'Manufactured on', aliases: ['mfg', 'mfg date', 'manufactured', 'manufacture date', 'mfg_date', 'made on'] },
  { key: 'expiry_date', label: 'Expires on', aliases: ['expiry', 'expiry date', 'expires', 'exp', 'expiry_date', 'best before'] },
  { key: 'warranty_months', label: 'Warranty (months)', aliases: ['warranty', 'warranty months', 'warranty_months'] },
  { key: 'status', label: 'Status', hint: 'active, quarantine, recalled, expired or closed. Defaults to active.', aliases: ['status', 'batch status', 'state'] },
]

export const BATCH_IMPORT_TEMPLATE_HEADERS = [
  'Item SKU',
  'Batch number',
  'Lot number',
  'Manufactured on',
  'Expires on',
  'Warranty months',
  'Status',
] as const

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Delimited text → a grid of cells.
 *
 * RFC 4180 quoting (`""` inside a quoted field is one quote, a newline inside
 * quotes stays in the cell), CR / LF / CRLF line endings, and a delimiter
 * sniffed from the first line so a tab-separated paste from a spreadsheet works
 * without asking the user what a delimiter is.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const input = text.replace(/^﻿/, '')
  const sep = delimiter ?? sniffDelimiter(input)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  // A trailing newline leaves one empty row; so does a blank line mid-file.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t', '|'].map((d) => ({ d, n: firstLine.split(d).length - 1 }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

/**
 * Each target field's best-matching column index, or -1.
 *
 * Exact alias first, then a contains-match, so "Batch No." finds `batch_no`
 * without "Batch No." also stealing the item column from "Item batch code".
 * A column is claimed once — two fields never point at the same column.
 */
export function guessMapping(headers: readonly string[]): Record<string, number> {
  const normalised = headers.map(normaliseHeader)
  const taken = new Set<number>()
  const mapping: Record<string, number> = {}

  for (const pass of ['exact', 'contains'] as const) {
    for (const field of BATCH_IMPORT_FIELDS) {
      if (mapping[field.key] !== undefined) continue
      const index = normalised.findIndex((h, i) => {
        if (taken.has(i) || h === '') return false
        return pass === 'exact'
          ? field.aliases.includes(h)
          : field.aliases.some((a) => h.includes(a))
      })
      if (index >= 0) {
        mapping[field.key] = index
        taken.add(index)
      }
    }
  }

  for (const field of BATCH_IMPORT_FIELDS) {
    if (mapping[field.key] === undefined) mapping[field.key] = -1
  }
  return mapping
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A spreadsheet date → `YYYY-MM-DD`, or null.
 *
 * Day-first for the slashed forms, because this is an Indian ERP and
 * `03/04/2026` in an Indian warehouse sheet is the third of April. Ambiguity is
 * not guessed away silently — the preview shows the interpreted date back, so
 * a reader can see `03/04/2026 → 03 Apr 2026` before importing anything.
 */
export function parseLooseDate(value: string): string | null {
  const s = String(value ?? '').trim()
  if (!s) return null

  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (dmy) {
    const year = Number(dmy[3])
    return iso(year < 100 ? 2000 + year : year, Number(dmy[2]), Number(dmy[1]))
  }

  const named = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2}|\d{4})$/)
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1
    const year = Number(named[3])
    return month > 0 ? iso(year < 100 ? 2000 + year : year, month, Number(named[1])) : null
  }

  return null
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface BatchImportRow {
  /** 1-based line in the source file, counting the header. */
  line: number
  raw: string[]
  itemKey: string
  batch_no: string
  lot_no: string
  /** Raw text as typed, kept so the preview can show what was interpreted. */
  mfg_raw: string
  expiry_raw: string
  mfg_date: string | null
  expiry_date: string | null
  warranty_months: string
  status: string
  /** Filled by the drawer once the item key is resolved against the API. */
  itemId: number | null
  itemName: string | null
  errors: string[]
  warnings: string[]
}

const STATUSES = ['active', 'quarantine', 'recalled', 'expired', 'closed']

function cell(raw: readonly string[], index: number): string {
  return index >= 0 ? String(raw[index] ?? '').trim() : ''
}

/** One file row → a draft, with everything this file can check already checked. */
export function toImportRow(
  raw: readonly string[],
  mapping: Record<string, number>,
  line: number,
): BatchImportRow {
  const mfgRaw = cell(raw, mapping.mfg_date ?? -1)
  const expiryRaw = cell(raw, mapping.expiry_date ?? -1)
  const row: BatchImportRow = {
    line,
    raw: [...raw],
    itemKey: cell(raw, mapping.item ?? -1),
    batch_no: cell(raw, mapping.batch_no ?? -1),
    lot_no: cell(raw, mapping.lot_no ?? -1),
    mfg_raw: mfgRaw,
    expiry_raw: expiryRaw,
    mfg_date: parseLooseDate(mfgRaw),
    expiry_date: parseLooseDate(expiryRaw),
    warranty_months: cell(raw, mapping.warranty_months ?? -1),
    status: cell(raw, mapping.status ?? -1).toLowerCase(),
    itemId: null,
    itemName: null,
    errors: [],
    warnings: [],
  }

  if (!row.itemKey) row.errors.push('Item is required')
  if (!row.batch_no) row.errors.push('Batch number is required')
  if (row.batch_no.length > 64) row.errors.push('Batch number is longer than 64 characters')
  if (row.lot_no.length > 64) row.errors.push('Lot number is longer than 64 characters')
  if (mfgRaw && !row.mfg_date) row.errors.push(`Manufacturing date "${mfgRaw}" is not a date`)
  if (expiryRaw && !row.expiry_date) row.errors.push(`Expiry date "${expiryRaw}" is not a date`)
  if (row.mfg_date && row.expiry_date && row.expiry_date < row.mfg_date) {
    row.errors.push('Expiry date is before the manufacturing date')
  }
  if (row.warranty_months && !/^\d+$/.test(row.warranty_months)) {
    row.errors.push(`Warranty "${row.warranty_months}" is not a whole number of months`)
  }
  if (row.status && !STATUSES.includes(row.status)) {
    row.errors.push(`Status "${row.status}" is not one of ${STATUSES.join(', ')}`)
  }
  if (!expiryRaw) row.warnings.push('No expiry date — the item’s shelf life will be used if it has one')

  return row
}

/**
 * Rows that repeat an (item, batch number) pair are errors, not warnings: the
 * API refuses the second one anyway, and importing half a duplicate pair is
 * exactly the "silent partial import" this flow must not do.
 */
export function markDuplicates(rows: BatchImportRow[]): BatchImportRow[] {
  const seen = new Map<string, number>()
  for (const row of rows) {
    if (!row.itemKey || !row.batch_no) continue
    const key = `${row.itemKey.toLowerCase()} ${row.batch_no.toLowerCase()}`
    const first = seen.get(key)
    if (first === undefined) seen.set(key, row.line)
    else row.errors.push(`Same item and batch number as line ${first}`)
  }
  return rows
}

export function rowSeverity(row: BatchImportRow): ImportSeverity {
  if (row.errors.length > 0) return 'error'
  if (row.warnings.length > 0) return 'warning'
  return 'valid'
}

export interface ImportTally {
  total: number
  valid: number
  warning: number
  error: number
  /** Valid + warning: what pressing Import would actually send. */
  importable: number
}

export function tally(rows: readonly BatchImportRow[]): ImportTally {
  const counts = { valid: 0, warning: 0, error: 0 }
  for (const row of rows) counts[rowSeverity(row)] += 1
  return {
    total: rows.length,
    ...counts,
    importable: counts.valid + counts.warning,
  }
}

/** The body `POST /v1/batches` expects for one row. */
export function toCreatePayload(row: BatchImportRow): Record<string, unknown> {
  return {
    item_id: row.itemId,
    batch_no: row.batch_no,
    lot_no: row.lot_no || null,
    mfg_date: row.mfg_date,
    expiry_date: row.expiry_date,
    warranty_months: row.warranty_months === '' ? null : Number(row.warranty_months),
    status: row.status || 'active',
  }
}
