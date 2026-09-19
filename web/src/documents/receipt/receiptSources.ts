/**
 * Turning something that is not yet a receipt line into one: a purchase order,
 * a read invoice, a pasted list of codes.
 *
 * All pure. The dialogs that collect the input are components; what they
 * produce goes through here so the arithmetic (pending quantities, quantity ×
 * rate, which fields an extraction is allowed to overwrite) is unit-tested once
 * and the same for every route in.
 */

import { newLine, round4 } from '../formModel'
import type { HeaderDraft, LineDraft, UnitOption } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { toNumber } from '../../utils/format'
import type { ExtractedReceipt, PurchaseOrderReceivable, PurchaseOrderReceivableLine } from './integrations'

// ---------------------------------------------------------------------------
// Purchase order → lines
// ---------------------------------------------------------------------------

/** What the user typed against one order line, keyed by po_line_id. */
export type PoSelection = Record<string, string>

/**
 * The quantity this receipt may take for an order line.
 *
 * Never more than the pending quantity: a purchase order for 100 bags cannot
 * receive 120 against it, and the over-delivery that does happen in a yard is a
 * separate line the storekeeper adds deliberately, not a number this dialog
 * lets through by accident.
 */
export function clampReceiptQty(entered: unknown, pending: number): number {
  const q = toNumber(entered)
  if (q === null || q <= 0) return 0
  const limit = Math.max(0, round4(pending))
  return round4(Math.min(q, limit))
}

export function defaultSelection(lines: PurchaseOrderReceivableLine[]): PoSelection {
  const out: PoSelection = {}
  for (const line of lines) {
    const pending = round4(Math.max(0, Number(line.pending_qty) || 0))
    out[String(line.po_line_id)] = pending > 0 ? String(pending) : ''
  }
  return out
}

export interface PoDraftOptions {
  spec: DocumentTypeSpec
  defaultWarehouseId: number | null
}

/**
 * Receipt lines for the order lines the user kept a quantity against.
 *
 * The order stays in Purchases: what comes across is the item, the quantity and
 * the agreed rate, plus a reference in the line's metadata so the receipt can
 * say which order line it answered. No purchase order row is written here.
 */
export function poLinesToDrafts(receivable: PurchaseOrderReceivable, selection: PoSelection, options: PoDraftOptions): LineDraft[] {
  const { spec, defaultWarehouseId } = options
  const drafts: LineDraft[] = []
  for (const line of receivable.lines) {
    if (!line.item_id) continue
    const qty = clampReceiptQty(selection[String(line.po_line_id)], Number(line.pending_qty) || 0)
    if (qty <= 0) continue
    const rate = toNumber(line.rate)
    const units: UnitOption[] = line.unit_id
      ? [{ unit_id: line.unit_id, unit_symbol: line.unit_symbol ?? null, conversion_factor: 1, is_default: true }]
      : []
    drafts.push(
      newLine(spec, {
        item_id: line.item_id,
        item_name: line.item_name ?? `Item #${line.item_id}`,
        item_sku: line.item_sku ?? null,
        units,
        unit_id: line.unit_id ?? null,
        warehouse_id: line.warehouse_id ?? defaultWarehouseId ?? null,
        qty: String(qty),
        rate: rate === null ? '' : String(rate),
        amount: rate === null ? '' : String(round4(qty * rate)),
        metadata: {
          source: 'purchase_order',
          purchase_order_id: receivable.order.po_id,
          purchase_order_no: receivable.order.po_no,
          purchase_order_line_id: line.po_line_id,
        },
      }),
    )
  }
  return drafts
}

// ---------------------------------------------------------------------------
// Read invoice → proposal
// ---------------------------------------------------------------------------

export interface ExtractionPatch {
  /** Header fields the reader is proposing. Only the ones it actually found. */
  header: Partial<HeaderDraft>
  lines: LineDraft[]
  /** Lines the reader could not tie to an item in this company's item master. */
  unmatched: { label: string; qty: number | null; rate: number | null }[]
  notes: string[]
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * What a read invoice proposes, split into what can be applied and what cannot.
 *
 * Deliberately conservative:
 *   - a field the reader did not find is left alone, never blanked;
 *   - the document date is NOT taken from the invoice (the receipt date is the
 *     day the goods reached the store, which is a fact about the yard, not
 *     about the supplier's paperwork) — it is offered as the reference date;
 *   - a line whose item the reader could not resolve is reported, not guessed.
 */
export function extractionToPatch(extraction: ExtractedReceipt, options: PoDraftOptions): ExtractionPatch {
  const { spec, defaultWarehouseId } = options
  const header: Partial<HeaderDraft> = {}
  const notes: string[] = [...(extraction.warnings ?? [])]

  if (extraction.supplier_name?.trim()) header.party_name = extraction.supplier_name.trim()
  if (extraction.supplier_ref && Number(extraction.supplier_ref) > 0) header.party_ref = String(Math.floor(Number(extraction.supplier_ref)))
  if (extraction.reference_no?.trim()) header.source_document_no = extraction.reference_no.trim()
  if (isDate(extraction.reference_date)) header.source_document_date = extraction.reference_date
  else if (isDate(extraction.document_date)) header.source_document_date = extraction.document_date

  const lines: LineDraft[] = []
  const unmatched: ExtractionPatch['unmatched'] = []
  for (const line of extraction.lines ?? []) {
    const qty = toNumber(line.qty)
    const rate = toNumber(line.rate)
    if (!line.item_id) {
      unmatched.push({ label: line.item_name?.trim() || line.item_sku?.trim() || 'Unnamed line', qty, rate })
      continue
    }
    const units: UnitOption[] = line.unit_id
      ? [{ unit_id: line.unit_id, unit_symbol: line.unit_symbol ?? null, conversion_factor: 1, is_default: true }]
      : []
    lines.push(
      newLine(spec, {
        item_id: line.item_id,
        item_name: line.item_name ?? `Item #${line.item_id}`,
        item_sku: line.item_sku ?? null,
        units,
        unit_id: line.unit_id ?? null,
        warehouse_id: defaultWarehouseId ?? null,
        batch_no: line.batch_no?.trim() || null,
        qty: qty === null || qty <= 0 ? '' : String(round4(qty)),
        rate: rate === null ? '' : String(rate),
        amount: qty !== null && rate !== null ? String(round4(qty * rate)) : '',
        metadata: { source: 'ai_invoice', confidence: line.confidence ?? null },
      }),
    )
  }
  if (unmatched.length > 0) {
    notes.push(`${unmatched.length} line${unmatched.length === 1 ? '' : 's'} could not be matched to an item and ${unmatched.length === 1 ? 'was' : 'were'} left out.`)
  }
  if (lines.some((l) => l.batch_no)) {
    notes.push('Batch numbers were read from the document — pick or create the matching batch on each line before posting.')
  }
  return { header, lines, unmatched, notes }
}

// ---------------------------------------------------------------------------
// Pasted / imported list → rows
// ---------------------------------------------------------------------------

/**
 * Split delimited text into cells. Handles the two shapes a stores clerk
 * actually produces: a CSV exported from a spreadsheet, and a block copied
 * straight out of one (tab separated).
 *
 * RFC 4180 quoting, because a supplier name with a comma in it is normal.
 */
export function parseDelimited(text: string): string[][] {
  const normalised = text.replace(/\r\n?/g, '\n')
  const delimiter = pickDelimiter(normalised)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < normalised.length; i += 1) {
    const ch = normalised[i]
    if (quoted) {
      if (ch === '"') {
        if (normalised[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function pickDelimiter(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t'
  if (semis > commas) return ';'
  return ','
}

export interface BulkRow {
  /** SKU or barcode as typed. */
  code: string
  qty: string
  rate: string
  batch: string
  /** 1-based line number in what the user pasted, for the error list. */
  sourceRow: number
}

const HEADER_WORDS = ['sku', 'code', 'barcode', 'item', 'qty', 'quantity', 'rate', 'price', 'batch', 'lot']

/** True when the first row looks like column titles rather than data. */
export function looksLikeHeaderRow(cells: string[]): boolean {
  const lowered = cells.map((c) => c.trim().toLowerCase()).filter(Boolean)
  if (lowered.length === 0) return false
  const named = lowered.filter((c) => HEADER_WORDS.some((w) => c === w || c.startsWith(`${w} `) || c.includes(w)))
  return named.length >= Math.min(2, lowered.length) && lowered.every((c) => toNumber(c) === null)
}

/**
 * `SKU, qty, rate, batch` — one item per line, the order a delivery note is
 * read in. The header row, if there is one, is dropped.
 */
export function parseBulkRows(text: string): BulkRow[] {
  const rows = parseDelimited(text)
  if (rows.length === 0) return []
  const body = looksLikeHeaderRow(rows[0]) ? rows.slice(1) : rows
  const offset = body === rows ? 1 : 2
  return body.map((cells, i) => ({
    code: (cells[0] ?? '').trim(),
    qty: (cells[1] ?? '').trim(),
    rate: (cells[2] ?? '').trim(),
    batch: (cells[3] ?? '').trim(),
    sourceRow: i + offset,
  }))
}
