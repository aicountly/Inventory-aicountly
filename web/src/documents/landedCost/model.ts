/**
 * The state a landed cost allocation is edited in, and the arithmetic derived from it.
 *
 * Everything here is pure. The figures it produces are a PREVIEW: the server allocates again from
 * the stored metadata when the document posts, and its answer is the one that reaches stock value.
 * The preview exists so the operator sees the split before committing to it, so it has to round the
 * way the engine rounds — `previewAllocation` in ../landedCost mirrors
 * DocumentPostingService::allocateCharge, residual rule included.
 *
 * What the preview deliberately does NOT model: how much of a receipt is still on hand. Only stock
 * still held absorbs a charge, and how much that is depends on cost layers and the movement ledger,
 * which live on the server. So every "revised value" here is the figure IF ALL OF IT LANDS, said in
 * those words on screen, and posting reports what it could not absorb as a warning.
 */

import { round4 } from '../formModel'
import { previewAllocation } from '../landedCost'
import type { AllocationPreview, ChargeDraft, TargetLine } from '../landedCost'
import type { DocumentLine, DocumentStatus, InventoryDocument } from '../types'
import { POSTED_STATUSES } from '../actions'

/** One valued inward line of a selected receipt, with the context the review table prints. */
export interface AllocationLine extends TargetLine {
  receipt_id: number
  receipt_no: string
  item_id: number
  sku: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  /** What the source voucher billed for this line. Books' commercial figure; never changed here. */
  invoice_amount: number | null
  /** valuation_amount / base_qty — what one unit of this line costs today. */
  current_unit_cost: number
  /** What the line already carries from an earlier allocation (or from the receipt itself). */
  landed_cost_already: number
}

/**
 * Why a receipt can or cannot carry a charge.
 *
 * Every one of these mirrors a refusal in DocumentPostingService::landedCostTargetDocument or
 * ::landedCostTargetLines. The screen says it before the user commits; the server says it again and
 * is the authority. `partially_allocated` is not a refusal — a receipt that already carries freight
 * can carry duty too — it is a note, because allocating the same bill twice is the mistake that
 * looks exactly like allocating a second bill.
 */
export type ReceiptEligibility =
  | 'eligible'
  | 'partially_allocated'
  | 'not_posted'
  | 'reversed'
  | 'unvalued'
  | 'period_locked'
  | 'self'

export const ELIGIBILITY_LABELS: Record<ReceiptEligibility, string> = {
  eligible: 'Eligible',
  partially_allocated: 'Partly allocated',
  not_posted: 'Not posted',
  reversed: 'Reversed',
  unvalued: 'Unvalued',
  period_locked: 'Period locked',
  self: 'This document',
}

/** Long form, shown in the row's tooltip and read out by assistive technology. */
export const ELIGIBILITY_REASONS: Record<ReceiptEligibility, string> = {
  eligible: 'Posted and valued — this receipt can carry a landed cost.',
  partially_allocated:
    'This receipt already carries a landed cost from an earlier allocation. It can take another charge, but check you are not allocating the same bill twice.',
  not_posted:
    'A cost can only be loaded onto stock that has actually been received, so the receipt must be posted first.',
  reversed: 'A reversed receipt no longer holds the stock a cost would be loaded onto.',
  unvalued: 'No line of this receipt was valued, so there is no cost of goods on it to add to.',
  period_locked:
    'This receipt is dated inside a locked period. Loading a cost onto it would change a closing stock that has already been reported, so it is refused rather than done quietly.',
  self: 'A landed cost allocation cannot load itself.',
}

export function isSelectable(eligibility: ReceiptEligibility): boolean {
  return eligibility === 'eligible' || eligibility === 'partially_allocated'
}

/** The valued inward lines of a receipt — exactly the set the server will allocate over. */
export function allocationLinesFrom(doc: InventoryDocument, warehouseName: (id: number | null | undefined) => string): AllocationLine[] {
  const receiptNo = doc.document_no ?? `#${doc.document_id}`
  return doc.lines.filter(isAllocatableLine).map((l) => {
    const baseQty = Number(l.base_qty) || 0
    const valuation = Number(l.valuation_amount ?? 0)
    return {
      line_id: l.line_id,
      label: l.item_label ?? l.item_name ?? `Item #${l.item_id}`,
      base_qty: baseQty,
      valuation_amount: valuation,
      unit_symbol: l.unit_symbol ?? null,
      receipt_id: doc.document_id,
      receipt_no: receiptNo,
      item_id: l.item_id,
      sku: l.item_sku ?? null,
      warehouse_id: l.warehouse_id,
      warehouse_name: l.warehouse_name ?? (l.warehouse_id ? warehouseName(l.warehouse_id) || null : null),
      invoice_amount: l.source_transaction_amount === null || l.source_transaction_amount === undefined ? null : Number(l.source_transaction_amount),
      current_unit_cost: baseQty > 0 ? round4(valuation / baseQty) : 0,
      landed_cost_already: Number(l.landed_cost_amount ?? 0),
    }
  })
}

/**
 * The same filter DocumentPostingService::landedCostTargetLines applies: inward, a real quantity,
 * and valued. A line that was never valued has no cost of goods for a charge to join.
 */
function isAllocatableLine(l: DocumentLine): boolean {
  return l.direction === 'in' && Number(l.base_qty ?? 0) > 0 && l.valuation_rate !== null && l.valuation_rate !== undefined
}

export interface EligibilityInput {
  status: DocumentStatus | string
  documentDate: string
  /** null while the receipt's lines have not been fetched — eligibility stays provisional. */
  lines: AllocationLine[] | null
  /** The landed cost document being edited, so it cannot pick itself. */
  ownDocumentId?: number | null
  documentId: number
  /** Latest `locked_upto_date` in force for the branch, or null. */
  lockedUptoDate?: string | null
}

/** Why this receipt is or is not selectable, decided the way the server decides it. */
export function eligibilityOf(input: EligibilityInput): ReceiptEligibility {
  if (input.ownDocumentId && input.ownDocumentId === input.documentId) return 'self'
  if (input.status === 'REVERSED') return 'reversed'
  if (!POSTED_STATUSES.includes(input.status as DocumentStatus)) return 'not_posted'
  if (input.lockedUptoDate && input.documentDate && input.documentDate <= input.lockedUptoDate) return 'period_locked'
  // Lines not fetched yet: assume eligible rather than showing a scary badge that will change.
  if (input.lines === null) return 'eligible'
  if (input.lines.length === 0) return 'unvalued'
  return input.lines.some((l) => l.landed_cost_already > 0) ? 'partially_allocated' : 'eligible'
}

/** The lock in force for a branch on a given date, from GET /v1/settings/period-locks. */
export function lockedUptoFor(locks: { bo_id: number; locked_upto_date: string; released_at: string | null }[] | null, boId: number): string | null {
  if (!locks) return null
  let latest: string | null = null
  for (const lock of locks) {
    if (lock.released_at) continue
    if (Number(lock.bo_id) !== 0 && Number(lock.bo_id) !== boId) continue
    if (latest === null || lock.locked_upto_date > latest) latest = lock.locked_upto_date
  }
  return latest
}

// ---------------------------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------------------------

export interface LandedCostSummary {
  receipts: number
  itemLines: number
  warehouses: number
  quantity: number
  /** What the source vouchers billed. Null when no selected line carries a commercial figure. */
  invoiceValue: number | null
  currentValue: number
  landedCost: number
  allocated: number
  /** landedCost − allocated: charges that reach no line at all. */
  unallocated: number
  revisedValue: number
  /** landedCost as a percentage of current stock value; null when there is nothing to divide by. */
  landedCostPercent: number | null
}

export function summarise(lines: AllocationLine[], preview: AllocationPreview): LandedCostSummary {
  let quantity = 0
  let currentValue = 0
  let invoiceValue = 0
  let anyInvoice = false
  const receipts = new Set<number>()
  const warehouses = new Set<number | 'none'>()
  for (const l of lines) {
    quantity = round4(quantity + l.base_qty)
    currentValue = round4(currentValue + l.valuation_amount)
    if (l.invoice_amount !== null) {
      invoiceValue = round4(invoiceValue + l.invoice_amount)
      anyInvoice = true
    }
    receipts.add(l.receipt_id)
    warehouses.add(l.warehouse_id ?? 'none')
  }
  const landedCost = preview.total
  const allocated = preview.allocated
  return {
    receipts: receipts.size,
    itemLines: lines.length,
    warehouses: warehouses.size,
    quantity,
    invoiceValue: anyInvoice ? invoiceValue : null,
    currentValue,
    landedCost,
    allocated,
    unallocated: round4(landedCost - allocated),
    revisedValue: round4(currentValue + allocated),
    landedCostPercent: currentValue > 0 ? round4((landedCost / currentValue) * 100) : null,
  }
}

/** One row of the allocation review: what this line is worth before and after. */
export interface AllocationReviewRow extends AllocationLine {
  allocatedCost: number
  allocatedPerUnit: number
  revisedUnitCost: number
  revisedValue: number
  /** Which basis put the money here. 'mixed' when more than one charge reached the line. */
  basis: string
}

export function reviewRows(lines: AllocationLine[], charges: ChargeDraft[], preview: AllocationPreview): AllocationReviewRow[] {
  return lines.map((l) => {
    const allocated = preview.perLine[l.line_id] ?? 0
    const revisedValue = round4(l.valuation_amount + allocated)
    const bases = new Set<string>()
    for (const charge of charges) {
      const share = preview.byCharge[charge.key]?.[l.line_id]
      if (share !== undefined && Math.abs(share) > 0.00005) bases.add(charge.allocation_basis)
    }
    return {
      ...l,
      allocatedCost: allocated,
      allocatedPerUnit: l.base_qty > 0 ? round4(allocated / l.base_qty) : 0,
      revisedUnitCost: l.base_qty > 0 ? round4(revisedValue / l.base_qty) : 0,
      revisedValue,
      basis: bases.size === 0 ? 'none' : bases.size === 1 ? [...bases][0] : 'mixed',
    }
  })
}

/** Charges grouped by cost type, for the donut and its legend. Largest share first. */
export interface ChargeSlice {
  costType: string
  label: string
  amount: number
  percent: number
}

export function chargeSlices(charges: ChargeDraft[], labels: Record<string, string>): ChargeSlice[] {
  const byType = new Map<string, number>()
  let total = 0
  for (const charge of charges) {
    const amount = Number(charge.amount) || 0
    if (amount <= 0) continue
    byType.set(charge.cost_type, round4((byType.get(charge.cost_type) ?? 0) + amount))
    total = round4(total + amount)
  }
  if (total <= 0) return []
  return [...byType.entries()]
    .map(([costType, amount]) => ({ costType, label: labels[costType] ?? costType, amount, percent: round4((amount / total) * 100) }))
    .sort((a, b) => b.amount - a.amount)
}

/** Everything the page derives from its state in one pass, so nothing is computed twice. */
export interface LandedCostDerived {
  lines: AllocationLine[]
  preview: AllocationPreview
  summary: LandedCostSummary
  rows: AllocationReviewRow[]
}

export function derive(lines: AllocationLine[], charges: ChargeDraft[]): LandedCostDerived {
  const preview = previewAllocation(charges, lines)
  return { lines, preview, summary: summarise(lines, preview), rows: reviewRows(lines, charges, preview) }
}
