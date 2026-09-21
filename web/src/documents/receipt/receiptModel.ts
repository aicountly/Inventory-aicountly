/**
 * The Material Receipt workspace's own pure layer: the receipt-specific fields
 * that ride in `inv_documents.metadata_json`, the running totals and the
 * validation the screen shows beside each field.
 *
 * Everything here is pure, so it is unit-tested (receiptModel.test.ts) and the
 * components stay about layout.
 *
 * ## Why validation lives here and not only in formModel
 *
 * `validateDraft` is the shared, server-mirroring check for every document
 * type: it produces a flat list of sentences for a notice at the foot of the
 * form. A goods-inward clerk filling forty lines needs the message ON the cell
 * that is wrong, and needs to know which messages stop the post and which are
 * merely worth knowing. So this adds a second, field-addressed view of the same
 * rules, plus three receipt-specific ones the server tolerates but a stores
 * ledger should not:
 *
 *   - a line with no warehouse (the server would store NULL and the stock would
 *     sit in no warehouse at all),
 *   - a batch-tracked item received into no batch,
 *   - a receipt line with no rate, which opens a cost layer at zero and prices
 *     every later issue of that item by guesswork.
 *
 * The first two block posting; the third is a warning, because a free
 * replacement genuinely does arrive at no cost. None of them block SAVING A
 * DRAFT — a half-filled receipt is exactly what a draft is for.
 */

import { draftTotals, isBlankLine, lineAmount, lineBaseQty, round4 } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentMetadata } from '../types'
import type { DocumentTypeSpec } from '../registry'
import { toNumber } from '../../utils/format'

// ---------------------------------------------------------------------------
// Receipt extras (metadata)
// ---------------------------------------------------------------------------

/**
 * The logistics facts a goods-inward desk records that are not stock and not
 * money: who carried it, which gate pass it came in on, which vehicle, and
 * whether QC has cleared it.
 *
 * They live in the document's `metadata` JSON because that is the column
 * `inv_documents` already carries for exactly this, and because inventing
 * four columns for one document type would put a stores form in charge of the
 * schema every other type shares.
 */
export interface ReceiptExtras {
  transporter_name: string
  gate_entry_no: string
  vehicle_no: string
  quality_checked: boolean
}

export const EMPTY_EXTRAS: ReceiptExtras = {
  transporter_name: '',
  gate_entry_no: '',
  vehicle_no: '',
  quality_checked: false,
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

/** Read the receipt extras out of a stored document's metadata. */
export function readExtras(metadata: DocumentMetadata | null | undefined): ReceiptExtras {
  const m = metadata ?? {}
  return {
    transporter_name: str(m.transporter_name).slice(0, 120),
    gate_entry_no: str(m.gate_entry_no).slice(0, 64),
    vehicle_no: str(m.vehicle_no).slice(0, 32),
    quality_checked: m.quality_checked === true || m.quality_checked === 1 || m.quality_checked === '1',
  }
}

/**
 * Merge the extras back into the metadata, dropping the blanks.
 *
 * Blank in, key out: a receipt that never had a vehicle number should not
 * store `"vehicle_no": ""` and then show an empty field as though it had been
 * answered. `quality_checked` is written only when true for the same reason —
 * false is the absence of a QC sign-off, not a recorded rejection.
 */
export function writeExtras(metadata: DocumentMetadata, extras: ReceiptExtras): DocumentMetadata {
  const out: DocumentMetadata = { ...metadata }
  const put = (key: keyof ReceiptExtras, value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') delete out[key]
    else out[key] = trimmed
  }
  put('transporter_name', extras.transporter_name)
  put('gate_entry_no', extras.gate_entry_no)
  put('vehicle_no', extras.vehicle_no)
  if (extras.quality_checked) out.quality_checked = true
  else delete out.quality_checked
  return out
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface ReceiptTotals {
  /** Lines carrying anything at all (blank rows are not counted). */
  lines: number
  /** Sum of the entered quantities. Mixed units, so it counts pieces handled, not a measure. */
  quantity: number
  /** Sum of qty × rate. */
  amount: number
  /**
   * Freight, duty and the rest. Always 0 here, and deliberately so: landing
   * costs reach stock through a Landed Cost Allocation against the posted
   * receipt (DocumentTypeRegistry LANDED_COST), which is the document that can
   * spread one freight bill over several receipts and tell Books about it. A
   * charges box on this form would either be ignored on posting or would
   * capitalise money the allocation policy never saw.
   */
  otherCharges: number
  /** amount + otherCharges. */
  net: number
}

export function receiptTotals(lines: LineDraft[], spec: DocumentTypeSpec): ReceiptTotals {
  const t = draftTotals(lines, spec)
  const amount = round4(t.amount)
  return { lines: t.lines, quantity: round4(t.qtyIn), amount, otherCharges: 0, net: amount }
}

/** The amount a line will post at: the typed amount, else qty × rate. */
export function lineAmountOf(line: LineDraft): number | null {
  const typed = toNumber(line.amount)
  if (typed !== null) return typed
  return lineAmount(line.qty, line.rate)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueLevel = 'error' | 'warning'

export type HeaderField = 'document_date' | 'document_no' | 'default_warehouse_id' | 'party_name' | 'party_ref' | 'reference_date' | 'lines'

export type LineField = 'item' | 'warehouse' | 'batch' | 'unit' | 'qty' | 'rate' | 'serials'

export interface HeaderIssue {
  field: HeaderField
  level: IssueLevel
  message: string
}

export interface LineIssue {
  /** LineDraft.key. */
  key: string
  /** 1-based, as the grid numbers the row. */
  row: number
  field: LineField
  level: IssueLevel
  message: string
}

export interface ReceiptValidation {
  header: HeaderIssue[]
  lines: LineIssue[]
  errors: number
  warnings: number
  /** Nothing blocking: the receipt may be posted. */
  ok: boolean
}

export interface ValidateOptions {
  /**
   * Posting applies the full rule set. Saving a draft applies only what the
   * server needs to accept the payload, because a draft is where an
   * unfinished receipt is supposed to live.
   */
  forPost: boolean
  /** A warehouse can be asked for only when the user has one to pick. */
  hasWarehouses?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Lines that carry anything at all, paired with the row number the grid shows. */
export function activeLines(lines: LineDraft[]): { line: LineDraft; row: number }[] {
  const out: { line: LineDraft; row: number }[] = []
  lines.forEach((line, i) => {
    if (!isBlankLine(line)) out.push({ line, row: i + 1 })
  })
  return out
}

/** A key that identifies the same stock bucket: item × warehouse × batch. */
function bucketKey(line: LineDraft, header: HeaderDraft): string {
  return [line.item_id ?? 0, line.warehouse_id ?? header.default_warehouse_id ?? 0, line.batch_id ?? 0].join(':')
}

export function validateReceipt(header: HeaderDraft, lines: LineDraft[], options: ValidateOptions): ReceiptValidation {
  const headerIssues: HeaderIssue[] = []
  const lineIssues: LineIssue[] = []
  const { forPost, hasWarehouses = true } = options

  if (!DATE_RE.test(header.document_date)) {
    headerIssues.push({ field: 'document_date', level: 'error', message: 'Enter the receipt date.' })
  }
  if (header.reference_date && !DATE_RE.test(header.reference_date)) {
    headerIssues.push({ field: 'reference_date', level: 'error', message: 'Reference date must be a valid date.' })
  }
  if (header.party_ref.trim() !== '' && (toNumber(header.party_ref) ?? 0) <= 0) {
    headerIssues.push({ field: 'party_ref', level: 'error', message: 'A Books ledger id is a positive number.' })
  }

  const active = activeLines(lines)
  if (active.length === 0) {
    headerIssues.push({ field: 'lines', level: 'error', message: 'Add at least one item to receive.' })
  }
  if (forPost && hasWarehouses && header.default_warehouse_id === null && active.some((a) => a.line.warehouse_id === null)) {
    headerIssues.push({ field: 'default_warehouse_id', level: 'error', message: 'Choose the warehouse the goods are received into.' })
  }

  const seen = new Map<string, number>()
  for (const { line, row } of active) {
    const add = (field: LineField, level: IssueLevel, message: string) => lineIssues.push({ key: line.key, row, field, level, message })

    if (!line.item_id) add('item', 'error', 'Pick an item.')
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) add('qty', 'error', 'Quantity must be more than zero.')

    // Serial numbers that do not add up to the quantity are wrong on a draft
    // too — the shared validator has always refused them, and a draft saved
    // with six serials against five units is a draft that can never post.
    if (line.track_serial && line.serials.length > 0 && qty !== null) {
      const need = lineBaseQty(line)
      if (line.serials.length !== need) {
        add('serials', 'error', `${line.serials.length} serial number${line.serials.length === 1 ? '' : 's'} for a base quantity of ${need}.`)
      }
    }

    if (!forPost) continue

    const warehouse = line.warehouse_id ?? header.default_warehouse_id
    if (hasWarehouses && warehouse === null) add('warehouse', 'error', 'Choose a warehouse for this line.')

    if (line.track_batch && line.batch_id === null) {
      add('batch', 'error', 'This item is batch-tracked — pick or create the batch it arrived in.')
    }

    if (line.track_serial && line.serials.length === 0) {
      add('serials', 'warning', 'No serial numbers assigned; this item is serial-tracked.')
    }

    const rate = toNumber(line.rate)
    const amount = lineAmountOf(line)
    if ((rate === null || rate <= 0) && (amount === null || amount <= 0)) {
      add('rate', 'warning', 'No rate: this stock will be received at zero cost.')
    }

    if (line.item_id) {
      const key = bucketKey(line, header)
      const first = seen.get(key)
      if (first !== undefined) add('item', 'warning', `Same item, warehouse and batch as line ${first}.`)
      else seen.set(key, row)
    }
  }

  const all: { level: IssueLevel }[] = [...headerIssues, ...lineIssues]
  const errors = all.filter((i) => i.level === 'error').length
  const warnings = all.length - errors
  return { header: headerIssues, lines: lineIssues, errors, warnings, ok: errors === 0 }
}

/** Issues for one line, indexed by the field they belong to. */
export function issuesByField(issues: LineIssue[], key: string): Partial<Record<LineField, LineIssue>> {
  const out: Partial<Record<LineField, LineIssue>> = {}
  for (const issue of issues) {
    if (issue.key !== key) continue
    // First one wins: an error is pushed before the warning for the same field.
    if (!out[issue.field] || (out[issue.field]?.level === 'warning' && issue.level === 'error')) out[issue.field] = issue
  }
  return out
}

/** One sentence for the sticky bar: what still has to happen before this posts. */
export function blockingSummary(validation: ReceiptValidation): string | null {
  if (validation.errors === 0) return null
  const first = validation.header.find((i) => i.level === 'error')
  if (first) return first.message
  const line = validation.lines.find((i) => i.level === 'error')
  return line ? `Line ${line.row}: ${line.message}` : null
}
