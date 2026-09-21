/**
 * Posting readiness: the checklist beside the form, and the gate in front of the Post button.
 *
 * Each check mirrors a refusal the server would make, so the operator learns it here rather than
 * from a 422 after committing. The server still validates everything — this list can be stale, it
 * cannot see a period lock that was taken a second ago, and it is not the authority for any of it.
 *
 * A check carries a `focus` so its row can scroll to the thing that needs attention: a checklist
 * that says "warehouse is required" and leaves the user to find the field is a list of complaints,
 * not a tool.
 */

import { round4 } from '../formModel'
import { chargeAmount } from '../landedCost'
import type { ChargeDraft } from '../landedCost'
import type { AllocationLine, LandedCostSummary, ReceiptEligibility } from './model'
import { isSelectable } from './model'

export type CheckState = 'ok' | 'blocked' | 'warning' | 'pending'

export interface ReadinessCheck {
  id: string
  label: string
  state: CheckState
  /** Shown when the check is not `ok`; what to do about it. */
  detail?: string
  focus?: 'details' | 'receipts' | 'charges' | 'review'
}

export interface ReadinessInput {
  documentDate: string
  warehouseId: number | null
  selected: { document_id: number; document_no: string; eligibility: ReceiptEligibility; stale: boolean }[]
  charges: ChargeDraft[]
  lines: AllocationLine[]
  summary: LandedCostSummary
  /** Per-charge problems from validateCharges(). */
  chargeErrors: string[]
  /** Latest unreleased lock date in force for the branch, or null. */
  lockedUptoDate: string | null
  /** False while the selected receipts' lines are still being fetched. */
  linesLoaded: boolean
  canPost: boolean
}

export function readinessChecks(input: ReadinessInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = []

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(input.documentDate)
  checks.push({
    id: 'date',
    label: 'Document date',
    state: dateOk ? 'ok' : 'blocked',
    detail: dateOk ? undefined : 'Enter the date this allocation is made on.',
    focus: 'details',
  })

  checks.push({
    id: 'warehouse',
    label: 'Default warehouse',
    state: input.warehouseId === null ? 'blocked' : 'ok',
    detail: input.warehouseId === null ? 'Pick the warehouse this allocation is raised in.' : undefined,
    focus: 'details',
  })

  // The allocation's OWN date against the lock, which assertDateAllowed checks first. Each selected
  // receipt's date is checked separately, by eligibility, because the engine checks that too.
  const ownDateLocked = Boolean(input.lockedUptoDate && dateOk && input.documentDate <= input.lockedUptoDate)
  checks.push({
    id: 'period',
    label: 'Inventory period open',
    state: ownDateLocked ? 'blocked' : 'ok',
    detail: ownDateLocked ? `The period up to ${input.lockedUptoDate} is locked, so nothing can be posted into it.` : undefined,
    focus: 'details',
  })

  const usable = input.selected.filter((r) => isSelectable(r.eligibility))
  checks.push({
    id: 'receipts',
    label: usable.length === 1 ? '1 receipt selected' : `${usable.length} receipts selected`,
    state: usable.length === 0 ? 'blocked' : 'ok',
    detail: usable.length === 0 ? 'Choose at least one posted, valued receipt to load these costs onto.' : undefined,
    focus: 'receipts',
  })

  const ineligible = input.selected.filter((r) => !isSelectable(r.eligibility))
  if (ineligible.length > 0) {
    checks.push({
      id: 'ineligible',
      label: 'Every selected receipt is eligible',
      state: 'blocked',
      detail: `${ineligible.map((r) => r.document_no).join(', ')} cannot carry a cost. Remove ${ineligible.length === 1 ? 'it' : 'them'} from the selection.`,
      focus: 'receipts',
    })
  }

  // The optimistic-locking check. A receipt whose version moved after it was loaded may have been
  // re-posted, re-valued or reversed, and allocating over the figures on screen would spread the
  // bill across quantities that are no longer there.
  const stale = input.selected.filter((r) => r.stale)
  if (stale.length > 0) {
    checks.push({
      id: 'stale',
      label: 'Receipt data is current',
      state: 'blocked',
      detail: `${stale.map((r) => r.document_no).join(', ')} changed after this allocation was prepared. Refresh the allocation before posting.`,
      focus: 'receipts',
    })
  }

  const priced = input.charges.filter((c) => chargeAmount(c) > 0)
  checks.push({
    id: 'charges',
    label: priced.length === 1 ? '1 charge line' : `${priced.length} charge lines`,
    state: input.charges.length === 0 ? 'blocked' : priced.length === 0 ? 'blocked' : 'ok',
    detail:
      input.charges.length === 0
        ? 'Add the freight, duty or other charge this allocation spreads.'
        : priced.length === 0
          ? 'Every charge is zero. A charge of zero allocates nothing.'
          : undefined,
    focus: 'charges',
  })

  if (input.chargeErrors.length > 0) {
    checks.push({
      id: 'charge-errors',
      label: 'Charges are valid',
      state: 'blocked',
      detail: input.chargeErrors[0],
      focus: 'charges',
    })
  }

  if (!input.linesLoaded) {
    checks.push({ id: 'lines', label: 'Receipt lines loaded', state: 'pending', detail: 'Reading the lines of the selected receipts…', focus: 'receipts' })
  } else if (input.lines.length === 0 && usable.length > 0) {
    checks.push({
      id: 'lines',
      label: 'Receipt lines loaded',
      state: 'blocked',
      detail: 'No selected receipt has a valued inward line, so there is no cost of goods to add to.',
      focus: 'receipts',
    })
  }

  const reconciled = Math.abs(input.summary.unallocated) <= 0.005
  if (input.summary.landedCost > 0) {
    checks.push({
      id: 'reconciled',
      label: 'Allocation reconciled',
      state: reconciled ? 'ok' : 'blocked',
      detail: reconciled ? undefined : `${round4(Math.abs(input.summary.unallocated)).toFixed(2)} of the charges reaches no line.`,
      focus: 'review',
    })
  }

  if (!input.canPost) {
    checks.push({
      id: 'permission',
      label: 'Permission to post',
      state: 'blocked',
      detail: 'Your access profile cannot post a landed cost allocation. It can still be saved as a draft for someone who can.',
      focus: 'details',
    })
  }

  return checks
}

export function blockingIssues(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks.filter((c) => c.state === 'blocked')
}

export function isReadyToPost(checks: ReadinessCheck[]): boolean {
  return checks.every((c) => c.state === 'ok' || c.state === 'warning')
}
