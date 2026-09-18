import { describe, expect, it } from 'vitest'
import { newCharge, previewAllocation } from '../landedCost'
import type { ChargeDraft } from '../landedCost'
import { summarise } from './model'
import type { AllocationLine, ReceiptEligibility } from './model'
import { blockingIssues, isReadyToPost, readinessChecks } from './readiness'
import type { ReadinessInput } from './readiness'

/**
 * The gate in front of the Post button.
 *
 * Every check here mirrors a refusal DocumentPostingService makes, so the operator learns it before
 * committing rather than from a 422 afterwards. The tests are written against that correspondence:
 * if the server would refuse it, this list must say so first, and if the server would allow it, the
 * list must not stand in the way.
 */

function line(partial: Partial<AllocationLine> = {}): AllocationLine {
  return {
    line_id: 11,
    label: 'Bearing',
    base_qty: 100,
    valuation_amount: 100000,
    unit_symbol: 'Pcs',
    receipt_id: 41,
    receipt_no: 'GRN-000145',
    item_id: 5,
    sku: 'BRG',
    warehouse_id: 1,
    warehouse_name: 'Main',
    invoice_amount: 100000,
    current_unit_cost: 1000,
    landed_cost_already: 0,
    ...partial,
  }
}

function charge(partial: Partial<ChargeDraft> = {}): ChargeDraft {
  return newCharge({ amount: '1000', allocation_basis: 'value', ...partial })
}

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  const lines = overrides.lines ?? [line()]
  const charges = overrides.charges ?? [charge()]
  return {
    documentDate: '2026-09-18',
    warehouseId: 1,
    selected: [{ document_id: 41, document_no: 'GRN-000145', eligibility: 'eligible' as ReceiptEligibility, stale: false }],
    charges,
    lines,
    summary: summarise(lines, previewAllocation(charges, lines)),
    chargeErrors: [],
    lockedUptoDate: null,
    linesLoaded: true,
    canPost: true,
    ...overrides,
  }
}

function check(checks: ReturnType<typeof readinessChecks>, id: string) {
  return checks.find((c) => c.id === id)
}

describe('readinessChecks', () => {
  it('passes a complete allocation', () => {
    const checks = readinessChecks(input())
    expect(blockingIssues(checks)).toEqual([])
    expect(isReadyToPost(checks)).toBe(true)
  })

  it('needs a date and a warehouse', () => {
    const checks = readinessChecks(input({ documentDate: '', warehouseId: null }))
    expect(check(checks, 'date')?.state).toBe('blocked')
    expect(check(checks, 'warehouse')?.state).toBe('blocked')
    expect(isReadyToPost(checks)).toBe(false)
  })

  it('refuses to post into a locked period, naming the date it is locked to', () => {
    const checks = readinessChecks(input({ lockedUptoDate: '2026-09-30' }))
    expect(check(checks, 'period')?.state).toBe('blocked')
    expect(check(checks, 'period')?.detail).toContain('2026-09-30')
  })

  it('needs at least one receipt', () => {
    const checks = readinessChecks(input({ selected: [], lines: [] }))
    expect(check(checks, 'receipts')?.state).toBe('blocked')
  })

  it('refuses while any selected receipt cannot carry a cost, and names it', () => {
    const checks = readinessChecks(
      input({
        selected: [
          { document_id: 41, document_no: 'GRN-000145', eligibility: 'eligible', stale: false },
          { document_id: 42, document_no: 'GRN-000146', eligibility: 'period_locked', stale: false },
        ],
      }),
    )

    expect(check(checks, 'ineligible')?.state).toBe('blocked')
    expect(check(checks, 'ineligible')?.detail).toContain('GRN-000146')
  })

  /**
   * The optimistic-lock check. A receipt whose version moved may have been re-posted, re-valued or
   * reversed, and spreading a bill over figures that are no longer there is exactly the silent
   * mis-statement this refusal exists to prevent.
   */
  it('refuses a receipt that changed after the allocation was prepared', () => {
    const checks = readinessChecks(input({ selected: [{ document_id: 41, document_no: 'GRN-000145', eligibility: 'eligible', stale: true }] }))

    expect(check(checks, 'stale')?.state).toBe('blocked')
    expect(check(checks, 'stale')?.detail).toContain('Refresh the allocation before posting')
  })

  it('needs at least one charge, and a charge of zero is not one', () => {
    expect(check(readinessChecks(input({ charges: [] })), 'charges')?.state).toBe('blocked')

    const zero = readinessChecks(input({ charges: [charge({ amount: '0' })] }))
    expect(check(zero, 'charges')?.state).toBe('blocked')
    expect(check(zero, 'charges')?.detail).toContain('allocates nothing')
  })

  it('surfaces the first charge problem rather than repeating all of them', () => {
    const checks = readinessChecks(input({ chargeErrors: ['Charge 1: the per-line shares add up to 250.00 but the charge is 400.00'] }))
    expect(check(checks, 'charge-errors')?.detail).toContain('250.00')
  })

  it('waits rather than refusing while the receipt lines are still being read', () => {
    const checks = readinessChecks(input({ linesLoaded: false }))
    expect(check(checks, 'lines')?.state).toBe('pending')
    expect(isReadyToPost(checks)).toBe(false)
  })

  it('refuses when no selected receipt has a valued inward line', () => {
    const checks = readinessChecks(input({ lines: [], charges: [charge()] }))
    expect(check(checks, 'lines')?.state).toBe('blocked')
  })

  it('refuses while any of the charge reaches no line', () => {
    const lines = [line()]
    const charges = [charge({ amount: '400', allocation_basis: 'manual', lines: { 99: '400' } })]
    const checks = readinessChecks(input({ lines, charges, summary: summarise(lines, previewAllocation(charges, lines)) }))

    expect(check(checks, 'reconciled')?.state).toBe('blocked')
    expect(check(checks, 'reconciled')?.detail).toContain('400.00')
  })

  /** Hiding the button would leave the user guessing; saying so lets them hand it on. */
  it('says plainly when the profile cannot post, and offers the draft instead', () => {
    const checks = readinessChecks(input({ canPost: false }))
    expect(check(checks, 'permission')?.state).toBe('blocked')
    expect(check(checks, 'permission')?.detail).toContain('saved as a draft')
  })

  it('gives every blocking check somewhere to scroll to', () => {
    const checks = readinessChecks(input({ documentDate: '', warehouseId: null, selected: [], lines: [], charges: [] }))
    for (const issue of blockingIssues(checks)) {
      expect(issue.focus, `${issue.id} has nowhere to send the user`).toBeTruthy()
    }
  })
})
