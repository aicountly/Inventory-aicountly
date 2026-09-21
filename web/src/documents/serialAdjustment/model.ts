/**
 * Serial Adjustment — the editable draft and the pure conversions between it, the API
 * resource (DocumentService::hydrate) and the create / update payload
 * (DocumentService::create). Everything here is pure so it is unit-tested.
 *
 * ## Why this type has its own model instead of reusing formModel.ts
 *
 * Every other document is entered item-first: pick an item, type a quantity, then open the
 * serial picker and tick the serials off a list. A serial adjustment is the one type where
 * the operator starts from the serial — it is in their hand, on a label, under a scanner —
 * and the item, the warehouse and the batch are things they are asking the system to tell
 * them, not things they can supply. So a row here is ONE SERIAL, and the item / warehouse /
 * batch on it come from `GET /v1/serials?q=` rather than from a picker.
 *
 * The server contract is unchanged. `SERIAL_ADJUSTMENT` is `line_mode: by_line`
 * (Config\DocumentTypeRegistry), so a line still carries item + warehouse + batch +
 * direction + qty + serials[]; `toPayloadLines` groups the serial rows back into exactly
 * that shape. One line per (item, warehouse, batch, direction, unit, remark) with
 * `qty = number of serials on it`, which is the equality DocumentService and the existing
 * client-side validation both require.
 */

import type { CreateDocumentLine, CreateDocumentPayload, DocumentLine, InventoryDocument } from '../types'
import type { ItemSearchRow, ItemUnitRow } from '../../services/lookupApi'
import type { SerialLookupRow } from '../../services/lookupApi'
import { toNumber } from '../../utils/format'

/** State of the live `GET /v1/serials` check on one row. */
export type SerialCheck =
  /** Nothing typed yet. */
  | 'idle'
  /** The lookup is in flight. */
  | 'checking'
  /** Resolved against a real serial. */
  | 'ok'
  /** Resolved, but something about it needs the operator's eye (status, duplicate item). */
  | 'warning'
  /** No such serial, or the lookup failed. */
  | 'error'

export interface SerialRowDraft {
  key: string
  /** What was typed or scanned, trimmed. */
  serial_no: string
  /** Resolved by the lookup; null until then. */
  serial_id: number | null
  item_id: number | null
  item_name: string
  item_sku: string | null
  /** Base unit of the item — a serial is one piece, so the row never converts. */
  unit_id: number | null
  conversion_factor: number
  warehouse_id: number | null
  warehouse_name: string | null
  batch_id: number | null
  batch_no: string | null
  location_code: string | null
  /** `inv_serials.status` as the lookup found it. Read-only: posting does not change it. */
  current_status: string | null
  direction: 'in' | 'out' | null
  remarks: string
  /**
   * Base-unit quantity this row contributes. Always 1 for a row that carries a serial.
   * A stored line with no serials at all (only reachable by editing a draft raised on the
   * previous screen) expands to a single row that keeps its quantity, so editing such a
   * draft here and saving it back does not silently drop stock quantity.
   */
  qty: number
  check: SerialCheck
  message: string | null
}

export interface SerialAdjustmentHeaderDraft {
  document_date: string
  document_no: string
  default_warehouse_id: number | null
  reason_code: string
  movement_reason: string
  narration: string
}

let keySeq = 0

export function nextRowKey(): string {
  keySeq += 1
  return `sa${Date.now().toString(36)}-${keySeq}`
}

export function newHeader(today: string): SerialAdjustmentHeaderDraft {
  return {
    document_date: today,
    document_no: '',
    default_warehouse_id: null,
    reason_code: '',
    movement_reason: '',
    narration: '',
  }
}

export function newRow(partial: Partial<SerialRowDraft> = {}): SerialRowDraft {
  return {
    key: nextRowKey(),
    serial_no: '',
    serial_id: null,
    item_id: null,
    item_name: '',
    item_sku: null,
    unit_id: null,
    conversion_factor: 1,
    warehouse_id: null,
    warehouse_name: null,
    batch_id: null,
    batch_no: null,
    location_code: null,
    current_status: null,
    direction: 'out',
    remarks: '',
    qty: 1,
    check: 'idle',
    message: null,
    ...partial,
  }
}

/** A row nothing has been entered on — dropped on save, never validated. */
export function isBlankRow(row: SerialRowDraft): boolean {
  return row.serial_no.trim() === '' && row.item_id === null
}

/**
 * The base unit of an item: one serial is one piece, so a serial row must never be counted
 * in Boxes. Prefers the row the item master marks `uom_role: 'base'`, then any unit whose
 * conversion factor is 1, then the item's default.
 */
export function baseUnitOf(item: Pick<ItemSearchRow, 'units' | 'unit_id' | 'unit_symbol'>): { unit_id: number | null; conversion_factor: number } {
  const units: ItemUnitRow[] = item.units ?? []
  const byRole = units.find((u) => u.uom_role === 'base')
  const byFactor = units.find((u) => Number(u.conversion_factor) === 1)
  const byDefault = units.find((u) => Number(u.is_default) === 1)
  const pick = byRole ?? byFactor ?? byDefault ?? units[0]
  if (pick) return { unit_id: pick.unit_id, conversion_factor: Number(pick.conversion_factor) || 1 }
  return { unit_id: item.unit_id ?? null, conversion_factor: 1 }
}

/** Serial statuses that mean the company physically holds the serial (SerialsController::STOCK_BEARING). */
export const STOCK_BEARING_STATUSES = ['in_stock', 'reserved', 'in_transit']

/**
 * Fold a resolved serial into a row. `duplicateOf` is the 1-based row number an earlier row
 * already claimed this serial on, when one did.
 */
export function applyLookup(row: SerialRowDraft, found: SerialLookupRow, duplicateOf: number | null): SerialRowDraft {
  const next: SerialRowDraft = {
    ...row,
    serial_no: found.serial_no,
    serial_id: found.serial_id,
    item_id: found.item_id,
    item_name: found.item_name ?? `Item #${found.item_id}`,
    item_sku: found.item_sku ?? null,
    warehouse_id: found.warehouse_id,
    warehouse_name: found.warehouse_name ?? null,
    batch_id: found.batch_id,
    batch_no: found.batch_no ?? null,
    location_code: found.location_code ?? null,
    current_status: found.status ?? null,
    qty: 1,
    check: 'ok',
    message: null,
  }
  if (duplicateOf !== null) {
    return { ...next, check: 'error', message: `Already added on line ${duplicateOf}.` }
  }
  if (!STOCK_BEARING_STATUSES.includes(String(found.status))) {
    return { ...next, check: 'warning', message: `This serial is ${humanStatus(found.status)}, not in stock.` }
  }
  return next
}

export function humanStatus(status: string | null | undefined): string {
  if (!status) return 'unknown'
  return String(status).replace(/_/g, ' ')
}

/** The row a serial was first claimed on (1-based), or null when this row is the first. */
export function duplicateRowNumber(rows: SerialRowDraft[], key: string, serialNo: string): number | null {
  const needle = serialNo.trim().toLowerCase()
  if (!needle) return null
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    if (r.key === key) return null
    if (r.serial_no.trim().toLowerCase() === needle) return i + 1
  }
  return null
}

/**
 * Re-run duplicate detection over every row. Called after any change to the serial column so
 * that deleting the first of two identical rows clears the error on the second.
 */
export function markDuplicates(rows: SerialRowDraft[]): SerialRowDraft[] {
  const seen = new Map<string, number>()
  return rows.map((row, i) => {
    const key = row.serial_no.trim().toLowerCase()
    if (!key) return row.message?.startsWith('Already added') ? { ...row, check: 'idle', message: null } : row
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, i + 1)
      // This row is the original. Clear a stale duplicate error, keep every other message.
      if (row.message?.startsWith('Already added')) {
        const status = row.current_status
        const inStock = status !== null && STOCK_BEARING_STATUSES.includes(status)
        return row.serial_id === null
          ? { ...row, check: 'idle', message: null }
          : inStock
            ? { ...row, check: 'ok', message: null }
            : { ...row, check: 'warning', message: `This serial is ${humanStatus(status)}, not in stock.` }
      }
      return row
    }
    if (row.check === 'error' && row.message?.startsWith('Already added')) return row
    return { ...row, check: 'error', message: `Already added on line ${first}.` }
  })
}

// ---------------------------------------------------------------------------
// Draft ← stored document
// ---------------------------------------------------------------------------

/**
 * Expand a stored document into serial rows: one row per serial, so a line that carried
 * four serials becomes four rows. A line with no serials keeps its quantity on one row.
 */
export function draftFromDocument(doc: InventoryDocument): { header: SerialAdjustmentHeaderDraft; rows: SerialRowDraft[] } {
  const header: SerialAdjustmentHeaderDraft = {
    document_date: doc.document_date?.slice(0, 10) ?? '',
    document_no: doc.document_no ?? '',
    default_warehouse_id: null,
    reason_code: doc.reason_code ?? '',
    movement_reason: doc.movement_reason ?? '',
    narration: doc.narration ?? '',
  }
  const rows: SerialRowDraft[] = []
  for (const line of doc.lines) rows.push(...rowsFromLine(line))
  return { header, rows }
}

export function rowsFromLine(line: DocumentLine): SerialRowDraft[] {
  const direction = line.direction === 'in' || line.direction === 'out' ? line.direction : null
  const common = {
    item_id: line.item_id,
    item_name: line.item_label ?? line.item_name ?? `Item #${line.item_id}`,
    item_sku: line.item_sku ?? null,
    unit_id: line.unit_id,
    conversion_factor: toNumber(line.conversion_factor) ?? 1,
    warehouse_id: line.warehouse_id,
    warehouse_name: line.warehouse_name ?? null,
    batch_id: line.batch_id,
    batch_no: line.batch_no ?? null,
    direction,
    remarks: line.description ?? '',
  }
  const serials = line.serials ?? []
  if (serials.length === 0) {
    return [newRow({ ...common, qty: toNumber(line.base_qty) ?? toNumber(line.qty) ?? 1, check: 'idle' })]
  }
  return serials.map((s) =>
    newRow({
      ...common,
      serial_id: s.serial_id,
      serial_no: s.serial_no ?? '',
      qty: 1,
      // Saved rows are trusted as stored; the live status is filled in by the lookup the
      // page runs when it opens, so nothing here claims a status it has not read.
      check: 'idle',
    }),
  )
}

// ---------------------------------------------------------------------------
// Draft → payload
// ---------------------------------------------------------------------------

function groupKey(row: SerialRowDraft): string {
  return [row.item_id, row.warehouse_id ?? '', row.batch_id ?? '', row.direction ?? '', row.unit_id ?? '', row.remarks.trim()].join('|')
}

/**
 * Group serial rows back into `by_line` document lines: one line per
 * (item, warehouse, batch, direction, unit, remark), carrying every serial that shares them
 * and `qty` equal to how many. Grouping by the remark as well keeps a per-row note attached
 * to exactly the serial it was written against instead of smearing it over the group.
 */
export function toPayloadLines(rows: SerialRowDraft[], defaultWarehouseId: number | null): CreateDocumentLine[] {
  const groups = new Map<string, CreateDocumentLine>()
  const order: string[] = []
  for (const row of rows) {
    if (isBlankRow(row) || row.item_id === null) continue
    const key = groupKey(row)
    let line = groups.get(key)
    if (!line) {
      line = {
        item_id: row.item_id,
        warehouse_id: row.warehouse_id ?? defaultWarehouseId ?? null,
        unit_id: row.unit_id,
        qty: 0,
        batch_id: row.batch_id,
      }
      if (row.direction) line.direction = row.direction
      if (row.remarks.trim()) line.description = row.remarks.trim()
      groups.set(key, line)
      order.push(key)
    }
    // Entered quantity, not base quantity: the server multiplies by the unit's conversion
    // factor itself. A serial row is one piece in the item's base unit, so the two agree.
    line.qty = round4(line.qty + row.qty / (row.conversion_factor || 1))
    if (row.serial_id !== null) line.serials = [...(line.serials ?? []), row.serial_id]
  }
  return order.map((k) => groups.get(k) as CreateDocumentLine)
}

/** Round like PHP round($x, 4), as formModel does. */
export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Number(`${Math.round(Number(`${n}e4`))}e-4`)
}

export function toPayload(header: SerialAdjustmentHeaderDraft, rows: SerialRowDraft[]): CreateDocumentPayload {
  return {
    document_type: 'SERIAL_ADJUSTMENT',
    document_date: header.document_date,
    document_no: header.document_no.trim() || null,
    reason_code: header.reason_code.trim() || null,
    movement_reason: header.movement_reason.trim() || null,
    narration: header.narration.trim() || null,
    lines: toPayloadLines(rows, header.default_warehouse_id),
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RowIssue {
  key: string
  /** 1-based row number as the grid shows it. */
  row: number
  message: string
}

export interface DraftValidation {
  errors: string[]
  rowIssues: RowIssue[]
  /** Not blocking — shown, and the user may post anyway. */
  warnings: string[]
}

/**
 * What the server would reject with a 422 anyway, checked first so the message lands next to
 * the field. Mirrors DocumentService::normalizeLines (direction required for by_line, qty > 0)
 * and the serial-count equality the existing line validation enforces.
 */
export function validateDraft(header: SerialAdjustmentHeaderDraft, rows: SerialRowDraft[]): DraftValidation {
  const errors: string[] = []
  const rowIssues: RowIssue[] = []
  const warnings: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)) errors.push('Document date is required (YYYY-MM-DD).')

  const active = rows.filter((r) => !isBlankRow(r))
  if (active.length === 0) errors.push('Scan or add at least one serial number.')

  const seen = new Map<string, number>()
  rows.forEach((row, i) => {
    if (isBlankRow(row)) return
    const n = i + 1
    const add = (message: string) => rowIssues.push({ key: row.key, row: n, message })
    const serial = row.serial_no.trim()
    if (serial === '' && row.serial_id === null && row.item_id === null) {
      add('Scan or enter a serial number.')
      return
    }
    if (row.item_id === null) {
      add(row.check === 'checking' ? 'Still checking this serial number.' : 'This serial number was not found, so there is no item to adjust.')
      return
    }
    if (!row.direction) add('Choose whether this serial goes in or out.')
    if (row.qty <= 0) add('Quantity must be greater than zero.')
    if (serial !== '') {
      const key = serial.toLowerCase()
      const first = seen.get(key)
      if (first !== undefined) add(`Serial ${serial} is already on line ${first}.`)
      else seen.set(key, n)
    }
    if (row.check === 'checking') add('Still checking this serial number.')
    if (row.serial_id === null && row.item_id !== null && serial !== '') {
      add('This serial number has not been matched to a registered serial.')
    }
  })

  const notInStock = active.filter((r) => r.current_status !== null && !STOCK_BEARING_STATUSES.includes(r.current_status))
  if (notInStock.length > 0) {
    warnings.push(
      `${notInStock.length} serial${notInStock.length === 1 ? ' is' : 's are'} not in stock (${[...new Set(notInStock.map((r) => humanStatus(r.current_status)))].join(', ')}). Check that is what you meant to record.`,
    )
  }
  return { errors, rowIssues, warnings }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface AdjustmentSummary {
  /** Rows with something on them. */
  serialLines: number
  /** Distinct serial numbers entered. */
  uniqueSerials: number
  /** Lines the document will actually post (rows grouped). */
  documentLines: number
  items: number
  warehouses: number
  inCount: number
  outCount: number
  /** Rows carrying an error or a warning. */
  needsAttention: number
}

export function summarise(rows: SerialRowDraft[], defaultWarehouseId: number | null = null): AdjustmentSummary {
  const active = rows.filter((r) => !isBlankRow(r))
  const serials = new Set<string>()
  const items = new Set<number>()
  const warehouses = new Set<number>()
  let inCount = 0
  let outCount = 0
  let needsAttention = 0
  for (const row of active) {
    const s = row.serial_no.trim().toLowerCase()
    if (s) serials.add(s)
    if (row.item_id !== null) items.add(row.item_id)
    const wh = row.warehouse_id ?? defaultWarehouseId
    if (wh !== null) warehouses.add(wh)
    if (row.direction === 'in') inCount += 1
    else if (row.direction === 'out') outCount += 1
    if (row.check === 'error' || row.check === 'warning') needsAttention += 1
  }
  return {
    serialLines: active.length,
    uniqueSerials: serials.size,
    documentLines: toPayloadLines(active, defaultWarehouseId).length,
    items: items.size,
    warehouses: warehouses.size,
    inCount,
    outCount,
    needsAttention,
  }
}

// ---------------------------------------------------------------------------
// Bulk intake (paste / file)
// ---------------------------------------------------------------------------

export interface ParsedIntake {
  /** Distinct serial numbers, in the order they first appeared. */
  serials: string[]
  /** Values that appeared more than once in the pasted text. */
  duplicates: string[]
  /** Entries too long for inv_serials.serial_no (VARCHAR(128)). */
  tooLong: string[]
}

/** inv_serials.serial_no is VARCHAR(128). */
export const SERIAL_MAX_LENGTH = 128

/**
 * Split a pasted block (or one column of a file) into serial numbers. Accepts newlines,
 * commas, semicolons and tabs as separators, which is what a spreadsheet column, a scanner
 * log and a hand-typed list each produce.
 */
export function parseSerialList(text: string): ParsedIntake {
  const serials: string[] = []
  const duplicates: string[] = []
  const tooLong: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/[\n\r,;\t]+/)) {
    const value = raw.trim()
    if (!value) continue
    if (value.length > SERIAL_MAX_LENGTH) {
      tooLong.push(value)
      continue
    }
    const key = value.toLowerCase()
    if (seen.has(key)) {
      if (!duplicates.includes(value)) duplicates.push(value)
      continue
    }
    seen.add(key)
    serials.push(value)
  }
  return { serials, duplicates, tooLong }
}

/**
 * Pull the serial-number column out of delimited text (CSV / TSV). A file whose first line
 * names a column containing "serial" uses that column and skips the header; anything else is
 * read as one serial per line, which is what a bare scanner dump looks like.
 */
export function parseDelimitedSerials(text: string): ParsedIntake {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { serials: [], duplicates: [], tooLong: [] }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const header = splitDelimited(lines[0], delimiter).map((c) => c.trim().toLowerCase())
  const column = header.findIndex((c) => c.includes('serial'))
  if (column === -1) return parseSerialList(text)
  const body = lines.slice(1).map((line) => splitDelimited(line, delimiter)[column] ?? '')
  return parseSerialList(body.join('\n'))
}

/** One row of delimited text, honouring double quotes around a value that contains the delimiter. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else quoted = false
      } else current += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delimiter) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out
}

/** The CSV the Download template action hands out — the columns this screen reads back. */
export const IMPORT_TEMPLATE_CSV = ['Serial Number,Remarks', 'SN-00001,', 'SN-00002,Relabelled', ''].join('\n')
