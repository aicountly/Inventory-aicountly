/**
 * Reading a spreadsheet of units into drafts the API will accept.
 *
 * Inventory has no import subsystem — no upload endpoint, no staging table, no
 * job runner — and inventing one for a master that holds a few dozen rows would
 * be a lot of machinery for the wrong problem. So this is a client-side import
 * over the CRUD that already exists: the sheet is parsed, every row is checked
 * by the SAME rules the form uses, and the rows that pass are created one call
 * at a time through `POST /v1/uom`, which means they go through the same
 * validation, the same audit trail and the same Books mirror as a unit typed in
 * by hand.
 *
 * Nothing is inserted silently. A row that cannot be created is reported with
 * the line number it came from and the reason, and the run says exactly how
 * many were created, skipped and refused.
 *
 * Pure: no DOM, no network, no SheetJS. The caller hands it a grid of cells.
 */

import { normaliseUnitToken, validateUnitDraft } from './uomPresentation'
import type { Uom } from '../../../services/masters'

export type Cell = string | number | boolean | null | undefined

/** The columns the template writes, in the order it writes them. */
export const IMPORT_COLUMNS = ['Unit Name', 'Symbol', 'Print Name', 'GST UQC', 'Decimals', 'Status'] as const

/**
 * Header spellings accepted for each field.
 *
 * Written the way a person spells them and normalised through the SAME
 * function the lookup uses, so the two cannot drift: hand-normalising the keys
 * here is how "Status" ended up filed under `statu` and every status column in
 * every sheet was quietly ignored.
 *
 * The export's own headings are in the list, because a sheet exported from this
 * screen has to be a sheet this screen can read back.
 */
const HEADER_SPELLINGS: Record<string, keyof ImportRowValues> = {
  'Unit Name': 'unit_name',
  Unit: 'unit_name',
  Name: 'unit_name',
  Symbol: 'unit_symbol',
  'Unit Symbol': 'unit_symbol',
  'Print Name': 'print_name',
  'GST UQC': 'uqc_gst',
  UQC: 'uqc_gst',
  'UQC GST': 'uqc_gst',
  Decimals: 'decimal_places',
  'Decimal Places': 'decimal_places',
  'Decimal Precision': 'decimal_places',
  Status: 'is_active',
  Active: 'is_active',
  'Is Active': 'is_active',
}

const HEADER_ALIASES: Record<string, keyof ImportRowValues> = Object.fromEntries(
  Object.entries(HEADER_SPELLINGS).map(([spelling, field]) => [normaliseUnitToken(spelling), field]),
)

export interface ImportRowValues {
  unit_name: string
  unit_symbol: string
  print_name: string
  uqc_gst: string
  decimal_places: string
  is_active: string
}

export type RowVerdict = 'valid' | 'warning' | 'error'

export interface ParsedRow {
  /** 1-based line in the source sheet, counting the header. */
  line: number
  values: ImportRowValues
  verdict: RowVerdict
  /** Why it cannot be imported, or what to look at before it is. */
  messages: string[]
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Headings the sheet had that nothing here understands. Reported, not fatal. */
  unknownHeaders: string[]
  /** Set when the sheet has no usable header row at all. */
  fatal: string | null
  counts: { total: number; valid: number; warning: number; error: number }
}

function text(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'boolean') return cell ? 'Active' : 'Inactive'
  return String(cell).trim()
}

function headerKey(cell: Cell): keyof ImportRowValues | null {
  return HEADER_ALIASES[normaliseUnitToken(text(cell))] ?? null
}

/** `Active`, `1`, `yes`, `true` → active. Blank → active, the create default. */
export function readStatus(value: string): boolean | null {
  const token = value.trim().toLowerCase()
  if (token === '') return true
  if (['active', 'yes', 'y', 'true', '1', 'enabled'].includes(token)) return true
  if (['inactive', 'no', 'n', 'false', '0', 'disabled'].includes(token)) return false
  return null
}

/**
 * Turn a grid of cells into checked drafts.
 *
 * `existing` is every unit already on record: a row colliding with one of them
 * is an error here rather than a 409 discovered halfway through the run.
 */
export function parseUnitSheet(grid: readonly (readonly Cell[])[], existing: readonly Uom[], knownUqcCodes: readonly string[] = []): ParseResult {
  const headerIndex = grid.findIndex((row) => row.some((cell) => headerKey(cell) !== null))
  if (headerIndex === -1) {
    return {
      rows: [],
      unknownHeaders: [],
      fatal: 'No heading row was found. The first row should name the columns — download the template to see them.',
      counts: { total: 0, valid: 0, warning: 0, error: 0 },
    }
  }

  const header = grid[headerIndex]
  const columnOf = new Map<keyof ImportRowValues, number>()
  const unknownHeaders: string[] = []
  header.forEach((cell, index) => {
    const key = headerKey(cell)
    if (key) {
      if (!columnOf.has(key)) columnOf.set(key, index)
    } else if (text(cell) !== '') {
      unknownHeaders.push(text(cell))
    }
  })

  if (!columnOf.has('unit_name') || !columnOf.has('unit_symbol')) {
    return {
      rows: [],
      unknownHeaders,
      fatal: 'The sheet needs at least a “Unit Name” and a “Symbol” column.',
      counts: { total: 0, valid: 0, warning: 0, error: 0 },
    }
  }

  const read = (row: readonly Cell[], key: keyof ImportRowValues): string => {
    const index = columnOf.get(key)
    return index === undefined ? '' : text(row[index])
  }

  const existingNames = new Map<string, Uom>()
  const existingSymbols = new Map<string, Uom>()
  for (const unit of existing) {
    existingNames.set(normaliseUnitToken(unit.unit_name), unit)
    const symbol = normaliseUnitToken(unit.unit_symbol)
    if (symbol) existingSymbols.set(symbol, unit)
  }

  const seenNames = new Map<string, number>()
  const seenSymbols = new Map<string, number>()
  const rows: ParsedRow[] = []

  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const raw = grid[i]
    const values: ImportRowValues = {
      unit_name: read(raw, 'unit_name'),
      unit_symbol: read(raw, 'unit_symbol'),
      print_name: read(raw, 'print_name'),
      uqc_gst: read(raw, 'uqc_gst').toUpperCase(),
      decimal_places: read(raw, 'decimal_places'),
      is_active: read(raw, 'is_active'),
    }
    // A wholly blank line is spacing, not a record. Skipped without comment.
    if (Object.values(values).every((v) => v === '')) continue

    const line = i + 1
    const messages: string[] = []
    let verdict: RowVerdict = 'valid'
    const fail = (message: string) => {
      messages.push(message)
      verdict = 'error'
    }

    for (const message of Object.values(validateUnitDraft(values, { knownUqcCodes }))) fail(message)

    if (readStatus(values.is_active) === null) {
      fail(`“${values.is_active}” is not a status. Use Active or Inactive.`)
    }

    const nameToken = normaliseUnitToken(values.unit_name)
    const symbolToken = normaliseUnitToken(values.unit_symbol)

    if (nameToken) {
      const clash = existingNames.get(nameToken)
      if (clash) fail(`A unit named “${clash.unit_name}” already exists.`)
      const twice = seenNames.get(nameToken)
      if (twice) fail(`The same name appears on line ${twice} of this sheet.`)
      else seenNames.set(nameToken, line)
    }

    if (symbolToken) {
      const clash = existingSymbols.get(symbolToken)
      if (clash) fail(`The symbol “${clash.unit_symbol}” is already used by ${clash.unit_name}.`)
      const twice = seenSymbols.get(symbolToken)
      if (twice) fail(`The same symbol appears on line ${twice} of this sheet.`)
      else seenSymbols.set(symbolToken, line)
    }

    // Worth seeing before the run, but not a reason to refuse the row.
    if (verdict === 'valid' && values.uqc_gst === '') {
      messages.push('No GST UQC — the unit will import, but cannot be reported on a return until one is set.')
      verdict = 'warning'
    }

    rows.push({ line, values, verdict, messages })
  }

  return {
    rows,
    unknownHeaders,
    fatal: null,
    counts: {
      total: rows.length,
      valid: rows.filter((r) => r.verdict === 'valid').length,
      warning: rows.filter((r) => r.verdict === 'warning').length,
      error: rows.filter((r) => r.verdict === 'error').length,
    },
  }
}

/** The body `POST /v1/uom` receives for an importable row. */
export function toCreatePayload(row: ParsedRow): Record<string, unknown> {
  return {
    unit_name: row.values.unit_name.trim(),
    unit_symbol: row.values.unit_symbol.trim(),
    print_name: row.values.print_name.trim() || null,
    uqc_gst: row.values.uqc_gst.trim() || null,
    decimal_places: row.values.decimal_places.trim() === '' ? 4 : Number(row.values.decimal_places),
    is_active: readStatus(row.values.is_active) === false ? 0 : 1,
  }
}

/** A blank sheet with the headings and one worked example. */
export function templateCsv(): string {
  return [IMPORT_COLUMNS.join(','), 'Kilogram,KG,Kilogram,KGS,4,Active', 'Dozen,DOZ,Dozen,DOZ,0,Active'].join('\r\n')
}

export interface ImportFailure {
  line: number
  name: string
  reason: string
}

/** The rows that did not make it, as a sheet the sender can fix and resend. */
export function failureReportCsv(failures: readonly ImportFailure[]): string {
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return [
    'Line,Unit Name,Reason',
    ...failures.map((f) => [String(f.line), escape(f.name), escape(f.reason)].join(',')),
  ].join('\r\n')
}
