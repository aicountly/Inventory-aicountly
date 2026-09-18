/**
 * The observations the page makes about an allocation before it is posted.
 *
 * Every one of them is DETERMINISTIC: it is computed from the charges and the selected receipts,
 * here, with no model and no service call. That is deliberate and it is what the card says on
 * screen — "checked on this device". Inventory has no landed-cost analysis endpoint, and inventing
 * findings that read like analysis would be worse than showing none: an operator who trusts a
 * fabricated "this freight looks normal" has been told something nobody checked.
 *
 * The structure is the part that is ready for one. If a real analysis service is added later it
 * returns `Insight[]` with `source: 'service'` and the card renders them beside these; nothing else
 * has to change. Until then `analyse()` is the whole implementation.
 *
 * The four severities are kept apart on purpose, because they are not the same kind of statement:
 *
 *   note       a fact about the figures — "freight is 5.2% of invoice value"
 *   review     a screening threshold was crossed. NOT a finding of error: a high freight
 *              percentage on an air consignment is ordinary, and the card says so.
 *   warning    something that is probably a mistake but is allowed to post
 *   blocker    the server will refuse this, so posting is stopped here first
 *
 * A screening threshold must never be dressed as an accounting error. The bands below are a review
 * aid, not a rule of accounting, and they are stated as such wherever they are shown.
 */

import { round4 } from '../formModel'
import { COST_TYPE_LABELS, chargeAmount } from '../landedCost'
import type { ChargeDraft, LandedCostType } from '../landedCost'
import type { AllocationLine, LandedCostSummary } from './model'

export type InsightSeverity = 'note' | 'review' | 'warning' | 'blocker'

export interface Insight {
  id: string
  severity: InsightSeverity
  /** One line, written to be read on its own. */
  message: string
  /** The chip on the right of the row. */
  status: string
  /** Where it came from. Only 'system' exists today; see the module docblock. */
  source: 'system' | 'service'
  /** Section to scroll to when the row is activated. */
  focus?: 'receipts' | 'charges' | 'review' | 'details'
}

/**
 * Screening bands, as a share of what the goods cost.
 *
 * They are a prompt to look, not a standard. Duty is deliberately absent: a rate that is ordinary
 * for one HSN is extraordinary for another and Inventory holds nothing that would tell them apart,
 * so its percentage is reported as a fact and never flagged.
 */
const REVIEW_BANDS: Partial<Record<LandedCostType, number>> = {
  freight: 15,
  insurance: 3,
  handling: 10,
}

/** Total landed cost above this share of stock value is worth a second look before posting. */
const TOTAL_REVIEW_BAND = 25

export interface AnalysisInput {
  charges: ChargeDraft[]
  lines: AllocationLine[]
  summary: LandedCostSummary
  /** The receipts chosen, for the supplier and already-allocated observations. */
  receipts: { document_id: number; document_no: string; party_ref: number | null; party_name: string | null }[]
  /** Per-charge errors the form already knows about, folded in as blockers. */
  errors?: string[]
}

export function analyse({ charges, lines, summary, receipts, errors = [] }: AnalysisInput): Insight[] {
  const out: Insight[] = []
  const priced = charges.filter((c) => chargeAmount(c) > 0)

  // The denominator is what the goods cost. Invoice value is the commercial figure and is the one
  // an operator recognises, but it is not always present on a line — fall back rather than divide
  // by nothing and print a percentage that means something else.
  const base = summary.invoiceValue && summary.invoiceValue > 0 ? summary.invoiceValue : summary.currentValue
  const baseLabel = summary.invoiceValue && summary.invoiceValue > 0 ? 'invoice value' : 'stock value'

  for (const charge of priced) {
    const amount = chargeAmount(charge)
    if (base <= 0) continue
    const pct = round4((amount / base) * 100)
    const band = REVIEW_BANDS[charge.cost_type]
    const over = band !== undefined && pct > band
    out.push({
      id: `share-${charge.key}`,
      severity: over ? 'review' : 'note',
      message: `${COST_TYPE_LABELS[charge.cost_type]} is ${pct.toFixed(1)}% of ${baseLabel}`,
      status: over ? 'Review' : 'Normal',
      source: 'system',
      focus: 'charges',
    })
  }

  if (base > 0 && summary.landedCost > 0) {
    const pct = round4((summary.landedCost / base) * 100)
    out.push({
      id: 'total-share',
      severity: pct > TOTAL_REVIEW_BAND ? 'review' : 'note',
      message: `Total landed cost is ${pct.toFixed(1)}% of ${baseLabel}`,
      status: pct > TOTAL_REVIEW_BAND ? 'Review' : 'Normal',
      source: 'system',
      focus: 'charges',
    })
  }

  // Two rows of the same cost type. Legitimate — two freight bills on one consignment — so it is a
  // warning that names the total, never a refusal.
  const byType = new Map<LandedCostType, ChargeDraft[]>()
  for (const charge of priced) byType.set(charge.cost_type, [...(byType.get(charge.cost_type) ?? []), charge])
  for (const [costType, group] of byType) {
    if (group.length < 2) continue
    const total = group.reduce((sum, c) => round4(sum + chargeAmount(c)), 0)
    out.push({
      id: `duplicate-${costType}`,
      severity: 'warning',
      message: `${group.length} separate ${COST_TYPE_LABELS[costType].toLowerCase()} charges totalling ${total.toFixed(2)} — check one is not entered twice`,
      status: 'Check',
      source: 'system',
      focus: 'charges',
    })
  }

  // A receipt that already carries a landed cost. The same bill allocated twice looks exactly like
  // a second bill, and this is the only place the difference can be noticed before posting.
  const alreadyLoaded = new Map<number, number>()
  for (const line of lines) {
    if (line.landed_cost_already > 0) {
      alreadyLoaded.set(line.receipt_id, round4((alreadyLoaded.get(line.receipt_id) ?? 0) + line.landed_cost_already))
    }
  }
  for (const [receiptId, amount] of alreadyLoaded) {
    const receipt = receipts.find((r) => r.document_id === receiptId)
    out.push({
      id: `already-${receiptId}`,
      severity: 'warning',
      message: `${receipt?.document_no ?? `Receipt #${receiptId}`} already carries ${amount.toFixed(2)} of landed cost — check this bill has not been allocated before`,
      status: 'Check',
      source: 'system',
      focus: 'receipts',
    })
  }

  // Receipts from different suppliers under one bill. Allowed — a consolidator's freight invoice
  // covers whatever was on the container — but worth saying out loud.
  const parties = new Set(receipts.map((r) => r.party_ref).filter((p): p is number => p !== null && p > 0))
  if (parties.size > 1) {
    out.push({
      id: 'mixed-suppliers',
      severity: 'warning',
      message: `The ${receipts.length} receipts selected are from ${parties.size} different suppliers`,
      status: 'Check',
      source: 'system',
      focus: 'receipts',
    })
  }

  // An import consignment with duty but no freight. Duty implies the goods crossed a border, and
  // goods that crossed a border were carried by someone.
  const types = new Set(priced.map((c) => c.cost_type))
  if (types.has('duty') && !types.has('freight')) {
    out.push({
      id: 'duty-without-freight',
      severity: 'review',
      message: 'Customs duty is entered but no freight — an imported consignment usually carries both',
      status: 'Review',
      source: 'system',
      focus: 'charges',
    })
  }

  // Charges that reach no line at all. These are rupees that were entered and will not be
  // capitalised, which is the failure the whole screen exists to prevent.
  if (Math.abs(summary.unallocated) > 0.005) {
    out.push({
      id: 'unallocated',
      severity: 'blocker',
      message: `${summary.unallocated.toFixed(2)} of the charges reaches no line — a charge that is not allocated never reaches stock value`,
      status: 'Fix',
      source: 'system',
      focus: 'review',
    })
  }

  for (const [i, message] of errors.entries()) {
    out.push({ id: `error-${i}`, severity: 'blocker', message, status: 'Fix', source: 'system', focus: 'charges' })
  }

  return out
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { blocker: 0, warning: 1, review: 2, note: 3 }

/** Most serious first; within a severity, the order they were produced in. */
export function rankInsights(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** True when nothing worse than a plain fact was found. */
export function allClear(insights: Insight[]): boolean {
  return insights.every((i) => i.severity === 'note')
}
