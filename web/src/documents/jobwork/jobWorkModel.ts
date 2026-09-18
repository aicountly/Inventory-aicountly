/**
 * Everything the job-work screens compute, with no React and no I/O in it, so
 * every rule below is unit-tested rather than clicked through.
 *
 * The two directions are one workflow read from two ends: a JOB_WORK_OUT opens
 * a pending quantity against a job worker, a JOB_WORK_IN settles it. The
 * derived state here — age, what is due, what is late, how much of a dispatch
 * has come back, what the receipt will do to stock — is the part the operator
 * cannot see on the form itself, and it is what the old screen never showed.
 *
 * Nothing here decides anything the server decides. Settlement, valuation and
 * the negative-stock policy are the API's; these are the warnings and the
 * arithmetic that let someone key a correct document at speed, and every one of
 * them is re-checked on POST.
 */

import type { PendingRow } from '../../services/stockApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty, toNumber } from '../../utils/format'
import { lineBaseQty, round4 } from '../formModel'
import type { LineDraft } from '../formModel'
import type { JobWorkSettlement } from '../types'

export type JobWorkMode = 'in' | 'out'

export const JOB_WORK_CODE: Record<JobWorkMode, string> = {
  in: 'JOB_WORK_IN',
  out: 'JOB_WORK_OUT',
}

/** URL slug of each mode — `/documents/new/<slug>`, unchanged from before. */
export const JOB_WORK_SLUG: Record<JobWorkMode, string> = {
  in: 'job_work_in',
  out: 'job_work_out',
}

export function jobWorkModeFor(code: string | null | undefined): JobWorkMode | null {
  const c = (code ?? '').toUpperCase()
  if (c === 'JOB_WORK_IN') return 'in'
  if (c === 'JOB_WORK_OUT') return 'out'
  return null
}

export function otherMode(mode: JobWorkMode): JobWorkMode {
  return mode === 'in' ? 'out' : 'in'
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Whole days from one ISO date to another, positive when `to` is later.
 *
 * Both ends are read as UTC midnights so a browser in IST and one in UTC count
 * the same number of days between the same two calendar dates.
 */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / 86400000)
}

function parseIsoDate(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(ms) ? null : ms
}

// ---------------------------------------------------------------------------
// The open position
// ---------------------------------------------------------------------------

/**
 * What a pending job-work quantity is doing right now.
 *
 * `overdue` and `due` need a promised return date, so a dispatch that never
 * promised one is never either: nothing said when it was coming back, so
 * nothing can call it late.
 */
export type PendingState = 'open' | 'partial' | 'due' | 'overdue'

export const PENDING_STATE_LABEL: Record<PendingState, string> = {
  open: 'Open',
  partial: 'Partial',
  due: 'Due',
  overdue: 'Overdue',
}

export interface PendingView {
  pendingId: number
  documentId: number
  documentNo: string
  documentDate: string | null
  expectedReturnDate: string | null
  itemId: number
  itemName: string
  itemSku: string | null
  unitId: number | null
  unitSymbol: string | null
  warehouseId: number | null
  warehouseName: string | null
  partyRef: number | null
  partyName: string | null
  /** Originally dispatched. */
  sent: number
  /** Already settled by earlier receipts. */
  received: number
  /** Still with the job worker. */
  open: number
  /** Days since the dispatch, null when the document carries no date. */
  ageDays: number | null
  /** Days until the promised return; negative once it has passed. */
  dueInDays: number | null
  state: PendingState
  /** 0–1, how much of the dispatch has come back. */
  completion: number
}

export function pendingView(row: PendingRow, today: string): PendingView {
  const sent = toNumber(row.qty_original) ?? 0
  const received = toNumber(row.qty_settled) ?? 0
  const open = round4(Math.max(0, toNumber(row.qty_open) ?? sent - received))
  const expected = row.expected_return_date ?? null
  const dueInDays = daysBetween(today, expected)
  let state: PendingState = received > 0 ? 'partial' : 'open'
  if (dueInDays !== null) {
    if (dueInDays < 0) state = 'overdue'
    else if (dueInDays === 0) state = 'due'
  }
  return {
    pendingId: row.pending_id,
    documentId: row.document_id,
    documentNo: row.document_no ?? `#${row.document_id}`,
    documentDate: row.document_date ?? null,
    expectedReturnDate: expected,
    itemId: row.item_id,
    itemName: row.item_name ?? `Item #${row.item_id}`,
    itemSku: row.item_sku ?? null,
    unitId: row.unit_id,
    unitSymbol: row.unit_symbol,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    partyRef: row.party_ref,
    partyName: row.party_name ?? null,
    sent,
    received,
    open,
    ageDays: daysBetween(row.document_date, today),
    dueInDays,
    state,
    completion: sent > 0 ? Math.min(1, received / sent) : 0,
  }
}

export interface PendingDocumentGroup {
  documentId: number
  documentNo: string
  documentDate: string | null
  expectedReturnDate: string | null
  partyRef: number | null
  partyName: string | null
  rows: PendingView[]
  sent: number
  received: number
  open: number
  ageDays: number | null
  dueInDays: number | null
  state: PendingState
  completion: number
}

/**
 * The pending rows of one dispatch, gathered under it — which is how an
 * operator thinks about them ("challan JW-OUT-41 is half back"), and what the
 * reference selector on the form offers.
 */
export function groupByDocument(views: readonly PendingView[]): PendingDocumentGroup[] {
  const byDoc = new Map<number, PendingDocumentGroup>()
  for (const view of views) {
    let group = byDoc.get(view.documentId)
    if (!group) {
      group = {
        documentId: view.documentId,
        documentNo: view.documentNo,
        documentDate: view.documentDate,
        expectedReturnDate: view.expectedReturnDate,
        partyRef: view.partyRef,
        partyName: view.partyName,
        rows: [],
        sent: 0,
        received: 0,
        open: 0,
        ageDays: view.ageDays,
        dueInDays: view.dueInDays,
        state: view.state,
        completion: 0,
      }
      byDoc.set(view.documentId, group)
    }
    group.rows.push(view)
    group.sent = round4(group.sent + view.sent)
    group.received = round4(group.received + view.received)
    group.open = round4(group.open + view.open)
    // The document is as late as its latest line and as settled as its lines
    // together: one overdue item makes the challan overdue.
    if (STATE_RANK[view.state] > STATE_RANK[group.state]) group.state = view.state
  }
  for (const group of byDoc.values()) {
    group.completion = group.sent > 0 ? Math.min(1, group.received / group.sent) : 0
  }
  return [...byDoc.values()].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || (a.documentDate ?? '').localeCompare(b.documentDate ?? ''))
}

const STATE_RANK: Record<PendingState, number> = { open: 0, partial: 1, due: 2, overdue: 3 }

/** Settlement progress over a set of pending rows, for the completion meter. */
export function settlementProgress(views: readonly PendingView[]): { sent: number; received: number; open: number; percent: number } {
  let sent = 0
  let received = 0
  for (const v of views) {
    sent = round4(sent + v.sent)
    received = round4(received + v.received)
  }
  return {
    sent,
    received,
    open: round4(Math.max(0, sent - received)),
    percent: sent > 0 ? Math.round((received / sent) * 100) : 0,
  }
}

// ---------------------------------------------------------------------------
// What the document will do to stock
// ---------------------------------------------------------------------------

export interface StockEffectRow {
  key: string
  label: string
  qty: number
  /** `in` adds to a bucket, `out` takes from one. */
  direction: 'in' | 'out'
}

/**
 * The buckets this draft will move when it posts, from the lines as they stand.
 *
 * Mirrors DocumentPostingService and StockStatusService, where the job_worker
 * bucket is a SPLIT of stock already on hand rather than a removal of it:
 *
 *   dispatch   job_worker +qty   → on hand unchanged, available falls
 *   returned   job_worker −qty   → nothing moves; the goods are available again
 *   consumed   job_worker −qty   plus an out line that issues and costs them
 *   received   an in line        → finished goods arrive on hand
 *
 * Saying "back into stock" for a return would be wrong twice over: the goods
 * never left, and on-hand does not change. What changes is what can be sold.
 */
export function stockEffect(mode: JobWorkMode, lines: readonly LineDraft[], settlements: readonly JobWorkSettlement[] = []): StockEffectRow[] {
  if (mode === 'out') {
    let qty = 0
    for (const l of lines) {
      if (!l.item_id) continue
      qty = round4(qty + lineBaseQty(l))
    }
    if (qty <= 0) return []
    return [
      { key: 'with_worker', label: 'With job worker', qty, direction: 'in' },
      { key: 'available', label: 'Available to sell', qty, direction: 'out' },
    ]
  }

  let received = 0
  for (const l of lines) {
    if (!l.item_id || l.direction !== 'in') continue
    received = round4(received + lineBaseQty(l))
  }
  let consumed = 0
  let returned = 0
  for (const s of settlements) {
    const qty = toNumber(s.qty) ?? 0
    if (qty <= 0) continue
    if (s.settlement_type === 'consumed') consumed = round4(consumed + qty)
    else returned = round4(returned + qty)
  }
  const rows: StockEffectRow[] = []
  if (received > 0) rows.push({ key: 'received', label: 'Finished goods on hand', qty: received, direction: 'in' })
  if (consumed + returned > 0) rows.push({ key: 'with_worker', label: 'With job worker', qty: round4(consumed + returned), direction: 'out' })
  if (returned > 0) rows.push({ key: 'returned', label: 'Available again', qty: returned, direction: 'in' })
  if (consumed > 0) rows.push({ key: 'consumed', label: 'Issued to the job (consumed)', qty: consumed, direction: 'out' })
  return rows
}

// ---------------------------------------------------------------------------
// Smart warnings
// ---------------------------------------------------------------------------

export type WarningTone = 'info' | 'warning' | 'danger'

export interface SmartWarning {
  key: string
  tone: WarningTone
  message: string
  /**
   * True when the server will refuse the post. The form still lets the user
   * try — the API is the authority, and a client that blocks on its own
   * arithmetic is a client that can be wrong in a way nobody can override.
   */
  blocking: boolean
}

export interface WarningInput {
  mode: JobWorkMode
  lines: readonly LineDraft[]
  /** Pending rows this receipt settles, keyed by pending id. */
  selected: readonly PendingView[]
  settlements: readonly JobWorkSettlement[]
  availability: Record<string, AvailabilityCheckResult>
  today: string
  /** Batches whose expiry falls inside this many days are called out. */
  expiryWindowDays?: number
}

/**
 * Contextual notes beside the form. Informational ones never stop a save; the
 * blocking ones say plainly what the server will refuse and why, so the fix is
 * obvious before the round trip rather than after it.
 */
export function smartWarnings({ mode, lines, selected, settlements, availability, today, expiryWindowDays = 15 }: WarningInput): SmartWarning[] {
  const out: SmartWarning[] = []

  // Over-settlement: the server checks this against the live open quantity and
  // refuses; saying so here turns a 422 into a number the operator can correct.
  const openByPending = new Map(selected.map((v) => [v.pendingId, v]))
  for (const s of settlements) {
    const view = openByPending.get(s.pending_id)
    if (!view) continue
    const qty = toNumber(s.qty) ?? 0
    if (qty > view.open + 0.0001) {
      out.push({
        key: `over-settle-${s.pending_id}`,
        tone: 'danger',
        blocking: true,
        message: `${view.itemName}: settling ${formatQty(qty)} against ${formatQty(view.open)} still open on ${view.documentNo}.`,
      })
    }
  }

  const overdue = selected.filter((v) => v.state === 'overdue')
  if (overdue.length > 0) {
    const qty = overdue.reduce((t, v) => round4(t + v.open), 0)
    const worst = overdue.reduce((w, v) => (v.dueInDays !== null && (w === null || v.dueInDays < w) ? v.dueInDays : w), null as number | null)
    out.push({
      key: 'overdue',
      tone: 'warning',
      blocking: false,
      message: `${formatQty(qty)} is past its expected return${worst !== null ? ` by up to ${Math.abs(worst)} day${Math.abs(worst) === 1 ? '' : 's'}` : ''}.`,
    })
  }

  if (mode === 'out') {
    for (const line of lines) {
      if (!line.item_id) continue
      const result = availability[line.key]
      if (!result || result.ok) continue
      out.push({
        key: `short-${line.key}`,
        tone: 'danger',
        blocking: false,
        message: `${line.item_name || `Item #${line.item_id}`}: ${formatQty(result.available)} available, short by ${formatQty(shortBy(result))}.`,
      })
    }
  }

  for (const dup of duplicateSerials(lines)) {
    out.push({
      key: `dup-serial-${dup}`,
      tone: 'danger',
      blocking: true,
      message: `Serial ${dup} is assigned to more than one line.`,
    })
  }

  for (const line of lines) {
    const days = daysBetween(today, batchExpiry(line))
    if (days === null || days > expiryWindowDays) continue
    out.push({
      key: `expiry-${line.key}`,
      tone: days < 0 ? 'danger' : 'warning',
      blocking: false,
      message:
        days < 0
          ? `Batch ${line.batch_no ?? ''} on ${line.item_name} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`.replace('  ', ' ')
          : `Batch ${line.batch_no ?? ''} on ${line.item_name} expires in ${days} day${days === 1 ? '' : 's'}.`.replace('  ', ' '),
    })
  }

  return out
}

function batchExpiry(line: LineDraft): string | null {
  const value = (line.metadata as { batch_expiry_date?: unknown } | null)?.batch_expiry_date
  return typeof value === 'string' && value ? value : null
}

/** Serial numbers picked on more than one line — the server refuses these. */
export function duplicateSerials(lines: readonly LineDraft[]): string[] {
  const seen = new Set<number>()
  const dup = new Map<number, string>()
  for (const line of lines) {
    for (const serial of line.serials) {
      if (seen.has(serial.serial_id)) dup.set(serial.serial_id, serial.serial_no ?? `#${serial.serial_id}`)
      else seen.add(serial.serial_id)
    }
  }
  return [...dup.values()]
}

// ---------------------------------------------------------------------------
// Paste from a spreadsheet
// ---------------------------------------------------------------------------

export interface PastedLine {
  /** SKU, barcode or item name — resolved against the item master on import. */
  code: string
  qty: string
  rate: string
  batch: string
  remarks: string
}

export const PASTE_COLUMNS = ['Item code / SKU', 'Qty', 'Rate', 'Batch', 'Remarks'] as const

/**
 * Tab- or comma-separated rows out of a spreadsheet, in the column order the
 * template declares. A header row is dropped when its quantity cell is not a
 * number — which is what a pasted header looks like and what a real row never
 * does.
 */
export function parsePastedLines(text: string): PastedLine[] {
  const out: PastedLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    const code = cells[0] ?? ''
    if (code === '') continue
    const qty = cells[1] ?? ''
    if (out.length === 0 && qty !== '' && toNumber(qty) === null) continue
    out.push({ code, qty, rate: cells[2] ?? '', batch: cells[3] ?? '', remarks: cells[4] ?? '' })
  }
  return out
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Field ids the form labels are bound to, so an error can focus its own input. */
export const JOB_WORK_FIELD = {
  documentDate: 'jw-document-date',
  documentNo: 'jw-document-no',
  jobWorker: 'jw-job-worker',
  warehouse: 'jw-warehouse',
  expectedReturn: 'jw-expected-return',
} as const

export interface JobWorkValidation {
  /** Field id → message, for the input that is wrong. */
  fields: Record<string, string>
  /** Draft line keys that are wrong, for the row that is wrong. */
  lineKeys: Set<string>
  /** Everything, in the order the form reads, for the summary banner. */
  messages: string[]
  ok: boolean
}

/**
 * What this form refuses to send.
 *
 * It is deliberately no stricter than the server. A batch-tracked item with no
 * batch picked, or a serialised one with no serials, posts today — so those are
 * warnings beside the row, not errors that stop a save. Inventing a block the
 * API does not have would leave an operator with a document they cannot post
 * and nobody to override it.
 *
 * It IS stricter in one place: a job-work document must name the job worker.
 * The column is nullable and always has been, but a dispatch with nobody
 * holding the goods cannot be settled by anything — the pending quantity it
 * opens can never be matched to a receipt.
 */
export function validateJobWork(
  header: { document_date: string; party_ref: string; default_warehouse_id: number | null; returnable: boolean; expected_return_date: string },
  lines: readonly LineDraft[],
  mode: JobWorkMode,
): JobWorkValidation {
  const fields: Record<string, string> = {}
  const lineKeys = new Set<string>()
  const messages: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.document_date)) {
    fields[JOB_WORK_FIELD.documentDate] = 'Enter the document date.'
    messages.push('Document date is required.')
  }
  const partyRef = toNumber(header.party_ref)
  if (partyRef === null || partyRef <= 0) {
    fields[JOB_WORK_FIELD.jobWorker] = 'Pick the job worker, or type their Books ledger id.'
    messages.push('Job worker is required.')
  }
  if (header.default_warehouse_id === null) {
    fields[JOB_WORK_FIELD.warehouse] = mode === 'out' ? 'Pick the warehouse the material leaves from.' : 'Pick the warehouse the goods are received into.'
    messages.push(mode === 'out' ? 'Source warehouse is required.' : 'Warehouse is required.')
  }
  if (mode === 'out' && header.returnable && header.expected_return_date && !/^\d{4}-\d{2}-\d{2}$/.test(header.expected_return_date)) {
    fields[JOB_WORK_FIELD.expectedReturn] = 'Use a full date.'
    messages.push('Expected return date must be a full date.')
  }

  const active = lines.filter((l) => !(l.item_id === null && l.qty.trim() === ''))
  if (active.length === 0) {
    messages.push(mode === 'out' ? 'Add at least one item to send.' : 'Add at least one item to receive.')
  }

  active.forEach((line, i) => {
    const n = i + 1
    let bad = false
    if (!line.item_id) {
      messages.push(`Line ${n}: pick an item.`)
      bad = true
    }
    const qty = toNumber(line.qty)
    if (qty === null || qty <= 0) {
      messages.push(`Line ${n}: quantity must be greater than zero.`)
      bad = true
    }
    if (mode === 'in') {
      if (!line.direction) {
        messages.push(`Line ${n}: say whether this is received or consumed.`)
        bad = true
      }
      // The Rate column beside it is the value agreed with the job worker — a
      // commercial figure, never a cost — so nothing else on the document can
      // price the goods coming back. Left blank they post into stock at zero.
      if (line.direction === 'in') {
        const cost = toNumber(line.valuation_rate)
        if (cost === null || cost <= 0) {
          messages.push(`Line ${n}: enter the unit cost of the goods coming back.`)
          bad = true
        }
      }
    }
    if (line.serials.length > 0 && qty !== null && line.serials.length !== lineBaseQty(line)) {
      messages.push(`Line ${n}: ${line.serials.length} serial number(s) for a base quantity of ${lineBaseQty(line)}.`)
      bad = true
    }
    if (bad) lineKeys.add(line.key)
  })

  return { fields, lineKeys, messages, ok: messages.length === 0 }
}

/**
 * Notes about a row that the server would nonetheless accept: a batch-tracked
 * item with no batch, a serialised one with no serials. Worth saying, never
 * worth blocking.
 */
export function lineAdvisories(lines: readonly LineDraft[]): SmartWarning[] {
  const out: SmartWarning[] = []
  lines.forEach((line, i) => {
    if (!line.item_id) return
    const name = line.item_name || `Line ${i + 1}`
    if (line.track_batch && line.batch_id === null) {
      out.push({ key: `no-batch-${line.key}`, tone: 'info', blocking: false, message: `${name} is batch tracked and no batch is allocated.` })
    }
    if (line.track_serial && line.serials.length === 0) {
      out.push({ key: `no-serial-${line.key}`, tone: 'info', blocking: false, message: `${name} is serialised and no serial numbers are allocated.` })
    }
  })
  return out
}
