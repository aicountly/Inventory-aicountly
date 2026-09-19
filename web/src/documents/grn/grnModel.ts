/**
 * Everything the Inward Challan / GRN screen derives from its draft — totals, purchase-order
 * matching, the stock-impact wording and the Notes & Alerts list.
 *
 * Pure on purpose. The receiving screen shows a running picture of a consignment (what matches
 * the order, what exceeds it, which batch is missing, which serial count is short) and that
 * picture has to be the same one the validator uses when Save & Post is pressed. Keeping it here,
 * with no React and no fetching, is what makes it testable and what stops the summary card and
 * the posting guard from drifting apart.
 *
 * None of it is authoritative: the server validates the document again on create and on post.
 */

import { isBlankLine, lineBaseQty, round4, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import { formatQty, toNumber } from '../../utils/format'

// ---------------------------------------------------------------------------
// Workflow tags
// ---------------------------------------------------------------------------

/**
 * Labels the receiving clerk can put on a consignment.
 *
 * Metadata only — they group and explain a receipt, they never change how it posts. Anything
 * that DOES change posting is the Stock effect field beside them, which is deliberately not a
 * tag: a document must never move stock differently because of a word someone attached to it.
 */
export const GRN_TAGS = [
  'Against Purchase Order',
  'Direct GRN',
  'Sample Goods',
  'Job Work Receipt',
  'Return from Customer',
] as const

export function toggleTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

export const NARRATION_MAX = 500

// ---------------------------------------------------------------------------
// Stock effect
// ---------------------------------------------------------------------------

export type StockImpactTone = 'pending' | 'receives' | 'settles'

export interface StockImpact {
  tone: StockImpactTone
  /** The word on the summary tile. */
  label: string
  /** One line under the Save & Post confirmation. */
  detail: string
}

export function stockImpact(stockEffect: string): StockImpact {
  switch (stockEffect) {
    case 'physical':
      return {
        tone: 'receives',
        label: 'Receives stock',
        detail: 'Stock moves into the warehouse now, and the quantity is still recorded as pending against the supplier.',
      }
    case 'settle_deferred':
      return {
        tone: 'settles',
        label: 'Settles purchase',
        detail: 'Goods are received against a purchase that was already invoiced, and the open quantity on it closes by what you receive.',
      }
    default:
      return {
        tone: 'pending',
        label: 'Pending',
        detail: 'Stock will remain pending until the challan is accepted or converted — nothing moves into the warehouse yet.',
      }
  }
}

// ---------------------------------------------------------------------------
// Purchase-order matching
// ---------------------------------------------------------------------------

export type PoMatchStatus = 'matched' | 'partial' | 'excess' | 'unlinked'

export interface PoLink {
  poLineId: string | null
  poNo: string | null
  /** Quantity still open on the order line when it was pulled in. */
  qtyOpen: number | null
  pendingId: number | null
}

/** The purchase-order link a line carries, read back out of its metadata. */
export function poLink(line: LineDraft): PoLink {
  const meta = line.metadata ?? {}
  const poLineId = typeof meta.po_line_id === 'string' && meta.po_line_id ? meta.po_line_id : null
  const poNo = typeof meta.po_no === 'string' && meta.po_no ? meta.po_no : null
  const pendingId = toNumber(meta.settlement_pending_id)
  return { poLineId, poNo, qtyOpen: toNumber(meta.po_qty_open), pendingId }
}

/** How the received quantity compares with what the order still had open. */
export function poMatchStatus(line: LineDraft): PoMatchStatus {
  const link = poLink(line)
  if (link.poLineId === null || link.qtyOpen === null) return 'unlinked'
  const qty = toNumber(line.qty)
  if (qty === null || qty <= 0) return 'partial'
  if (qty > link.qtyOpen) return 'excess'
  return qty === link.qtyOpen ? 'matched' : 'partial'
}

export const PO_MATCH_LABEL: Record<PoMatchStatus, string> = {
  matched: 'Matched',
  partial: 'Partial',
  excess: 'Excess',
  unlinked: 'Not in PO',
}

/** Lines pulled from an order that are being received above what it still had open. */
export function overReceivedLines(lines: LineDraft[]): LineDraft[] {
  return lines.filter((l) => !isBlankLine(l) && poMatchStatus(l) === 'excess')
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface GrnTotals {
  /** Lines with something on them. */
  items: number
  /** Sum of the entered quantities, in the units entered. */
  quantity: number
  /** Sum of qty × rate. */
  amount: number
  /** Lines that still have no item picked. */
  incomplete: number
}

export function grnTotals(lines: LineDraft[]): GrnTotals {
  const totals: GrnTotals = { items: 0, quantity: 0, amount: 0, incomplete: 0 }
  for (const line of lines) {
    if (isBlankLine(line)) continue
    totals.items += 1
    if (line.item_id === null) totals.incomplete += 1
    totals.quantity = round4(totals.quantity + (toNumber(line.qty) ?? 0))
    const rate = toNumber(line.rate)
    const amount = toNumber(line.amount) ?? (rate !== null ? round4((toNumber(line.qty) ?? 0) * rate) : 0)
    totals.amount = round4(totals.amount + amount)
  }
  return totals
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type GrnAlertTone = 'success' | 'info' | 'warning' | 'danger'

export interface GrnAlert {
  id: string
  tone: GrnAlertTone
  message: string
  /** Lines the alert is about, so the table can highlight them. */
  lineKeys?: string[]
}

export interface GrnAlertContext {
  header: HeaderDraft
  lines: LineDraft[]
  /** Today, or the working date, as YYYY-MM-DD. Expiry is judged against it. */
  today: string
  /** The selected financial year, from Manage. */
  fyRange?: { from: string; to: string }
}

function activeLines(lines: LineDraft[]): LineDraft[] {
  return lines.filter((l) => !isBlankLine(l))
}

/** Serial numbers entered more than once across the whole document. */
export function duplicateSerials(lines: LineDraft[]): string[] {
  const seen = new Map<string, number>()
  for (const line of lines) {
    for (const serial of line.serials) {
      const key = (serial.serial_no ?? `#${serial.serial_id}`).trim().toLowerCase()
      if (!key) continue
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key)
}

/**
 * The Notes & Alerts panel.
 *
 * Ordered worst first, so the one thing that will stop a post is the first thing read. Each entry
 * is derived from the draft alone — nothing here reports a state the screen cannot show.
 */
export function grnAlerts({ header, lines, today, fyRange }: GrnAlertContext): GrnAlert[] {
  const alerts: GrnAlert[] = []
  const active = activeLines(lines)

  // --- blocking-shaped problems -------------------------------------------
  const missingBatch = active.filter((l) => l.track_batch && l.batch_id === null)
  if (missingBatch.length > 0) {
    alerts.push({
      id: 'batch-missing',
      tone: 'danger',
      message: `${missingBatch.length} batch-tracked item${missingBatch.length === 1 ? '' : 's'} still need${missingBatch.length === 1 ? 's' : ''} a batch.`,
      lineKeys: missingBatch.map((l) => l.key),
    })
  } else if (active.some((l) => l.track_batch)) {
    alerts.push({ id: 'batch-ok', tone: 'success', message: 'All items have valid batches.' })
  }

  const serialShort = active.filter((l) => l.track_serial && lineBaseQty(l) > 0 && l.serials.length !== lineBaseQty(l))
  if (serialShort.length > 0) {
    alerts.push({
      id: 'serial-count',
      tone: 'danger',
      message:
        serialShort.length === 1
          ? '1 serialised line does not have one serial number per unit.'
          : `${serialShort.length} serialised lines do not have one serial number per unit.`,
      lineKeys: serialShort.map((l) => l.key),
    })
  }

  const dupes = duplicateSerials(active)
  if (dupes.length > 0) {
    alerts.push({ id: 'serial-duplicate', tone: 'danger', message: `${dupes.length} serial number${dupes.length === 1 ? ' is' : 's are'} used on more than one line.` })
  }

  if (fyRange?.from && fyRange?.to && header.document_date && (header.document_date < fyRange.from || header.document_date > fyRange.to)) {
    alerts.push({ id: 'fy-range', tone: 'danger', message: 'The document date falls outside the selected financial year.' })
  }

  const excess = overReceivedLines(active)
  if (excess.length > 0) {
    alerts.push({
      id: 'po-excess',
      tone: 'warning',
      message: `${excess.length} item${excess.length === 1 ? '' : 's'} exceed the remaining purchase-order quantity.`,
      lineKeys: excess.map((l) => l.key),
    })
  }

  const expired = active.filter((l) => l.expiry_date !== null && l.expiry_date !== '' && l.expiry_date < today)
  if (expired.length > 0) {
    alerts.push({
      id: 'expiry-past',
      tone: 'warning',
      message: `${expired.length} batch${expired.length === 1 ? '' : 'es'} being received ${expired.length === 1 ? 'has' : 'have'} already expired.`,
      lineKeys: expired.map((l) => l.key),
    })
  }

  // --- context ------------------------------------------------------------
  const impact = stockImpact(header.stock_effect)
  if (impact.tone === 'pending') {
    alerts.push({ id: 'stock-pending', tone: 'warning', message: 'Stock will be updated as pending (Challan only).' })
  } else if (impact.tone === 'receives') {
    alerts.push({ id: 'stock-physical', tone: 'info', message: 'Stock moves into the warehouse as soon as this document posts.' })
  } else {
    alerts.push({ id: 'stock-settles', tone: 'info', message: 'This receipt settles the open quantity on the linked purchase.' })
  }

  const linked = active.filter((l) => poLink(l).poLineId !== null)
  if (linked.length > 0) {
    alerts.push({ id: 'po-matched', tone: 'info', message: `${linked.length} item${linked.length === 1 ? '' : 's'} match open purchase orders.` })
  }

  if (!header.party_ref.trim()) {
    alerts.push({
      id: 'supplier-unlinked',
      tone: 'warning',
      message: 'No supplier ledger is linked, so this receipt will not be matched to the supplier’s pending quantities.',
    })
  }

  return alerts
}

/** True when nothing in the list should stop a post. */
export function hasBlockingAlert(alerts: GrnAlert[]): boolean {
  return alerts.some((a) => a.tone === 'danger')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface GrnValidationContext {
  spec: DocumentTypeSpec
  fyRange?: { from: string; to: string }
}

/**
 * Everything `validateDraft` checks, plus what only a goods receipt knows: a batch-tracked item
 * needs a batch, a serialised line needs one serial per unit, the date belongs to the open
 * financial year and a serial cannot be received twice on one document.
 *
 * An expiry already in the past is NOT here either: short-dated stock is received against a debit
 * note every day, so it is reported in the alerts panel and left out of the way of posting.
 * Over-receipt against a purchase order is NOT here: receiving more than was ordered happens, the
 * server does not refuse it, and the screen's job is to say so loudly — which the alert above and
 * the posting dialog both do — not to block a true statement about what arrived.
 */
export function validateGrn(header: HeaderDraft, lines: LineDraft[], { spec, fyRange }: GrnValidationContext): string[] {
  const errors = validateDraft(header, lines, spec)
  const active = activeLines(lines)

  if (fyRange?.from && fyRange?.to && header.document_date && (header.document_date < fyRange.from || header.document_date > fyRange.to)) {
    errors.push(`Document date must fall inside the selected financial year (${fyRange.from} to ${fyRange.to}).`)
  }

  active.forEach((line, i) => {
    const n = i + 1
    if (line.track_batch && line.batch_id === null) {
      errors.push(`Line ${n}: ${line.item_name || 'this item'} is batch-tracked — pick or create a batch.`)
    }
    if (line.track_serial) {
      const required = lineBaseQty(line)
      if (required > 0 && line.serials.length !== required) {
        errors.push(`Line ${n}: ${line.serials.length} serial number(s) captured for ${formatQty(required)} unit(s).`)
      }
    }
  })

  for (const duplicate of duplicateSerials(active)) {
    errors.push(`Serial number ${duplicate} appears on more than one line.`)
  }

  return errors
}
