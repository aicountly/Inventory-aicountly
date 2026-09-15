import { describe, expect, it } from 'vitest'
import { ageInDays, reconciliationVerdict } from './controlsModel'
import type { ReconciliationRun } from '../services/reconciliationApi'

function run(overrides: Partial<ReconciliationRun> = {}): ReconciliationRun {
  return {
    run_id: 1,
    run_uuid: null,
    cmp_id: 1,
    fy_id: 3,
    bo_id: 0,
    as_of_date: '2026-09-15',
    inventory_closing_value: 4862000,
    inventory_closing_qty: 1000,
    books_stock_ledger_balance: 4862000,
    difference: 0,
    status: 'COMPLETED',
    requested_by: 'priya',
    created_at: '2026-09-15T10:42:00Z',
    ...overrides,
  }
}

/**
 * The single most consequential piece of logic on the Controls dashboard.
 *
 * "Books was unreachable" and "the two systems agree" produce identical-looking
 * cards the moment a null difference is formatted as a currency zero, and one
 * of them tells a controller to stand down on a break that is still open.
 */
describe('reconciliationVerdict', () => {
  it('reports a genuine match as aligned', () => {
    const v = reconciliationVerdict(run())
    expect(v.kind).toBe('matched')
    expect(v.matched).toBe(true)
    expect(v.statusLabel).toBe('Completed — aligned')
  })

  it('never says aligned when a difference was found', () => {
    const v = reconciliationVerdict(run({ difference: 12000, books_stock_ledger_balance: 4850000 }))
    expect(v.kind).toBe('difference')
    expect(v.matched).toBe(false)
    // The concept mockup showed "Inventory and Books aligned" beside a ₹12,000
    // difference. This is the wording that makes that impossible.
    expect(v.statusLabel).toBe('Completed — difference found')
    expect(v.statusLabel.toLowerCase()).not.toContain('aligned')
  })

  it('reports an unreachable Books as unavailable, not as a zero difference', () => {
    const v = reconciliationVerdict(run({ status: 'BOOKS_UNAVAILABLE', books_stock_ledger_balance: null, difference: null }))
    expect(v.kind).toBe('unavailable')
    expect(v.state).toBe('unavailable')
    expect(v.matched).toBe(false)
    // No figure at all: a "0" here reads as agreement.
    expect(v.headline).toBeNull()
    expect(v.difference).toBeNull()
    expect(v.explanation).toContain('unknown')
  })

  it('treats a completed run with no recorded difference as unknown, not matched', () => {
    const v = reconciliationVerdict(run({ difference: null }))
    expect(v.matched).toBe(false)
    expect(v.headline).toBeNull()
    expect(v.state).toBe('unavailable')
  })

  it('reports a failed run as failed', () => {
    const v = reconciliationVerdict(run({ status: 'FAILED', difference: null }))
    expect(v.kind).toBe('failed')
    expect(v.matched).toBe(false)
  })

  it('distinguishes never-run from matched', () => {
    const v = reconciliationVerdict(null)
    expect(v.kind).toBe('never_run')
    expect(v.matched).toBe(false)
    expect(v.state).toBe('empty')
  })

  it('treats sub-paisa drift as a match but a real difference as a break', () => {
    expect(reconciliationVerdict(run({ difference: 0.004 })).matched).toBe(true)
    expect(reconciliationVerdict(run({ difference: 0.5 })).matched).toBe(false)
  })

  it('names which side is lower, so the sign convention is never ambiguous', () => {
    expect(reconciliationVerdict(run({ difference: 12000 })).explanation).toContain('Books is lower')
    expect(reconciliationVerdict(run({ difference: -12000 })).explanation).toContain('Books is higher')
  })
})

describe('ageInDays', () => {
  it('counts whole days waited', () => {
    expect(ageInDays('2026-09-08', new Date('2026-09-15T09:00:00Z'))).toBe(7)
  })

  it('never reports a negative age for a future-dated document', () => {
    expect(ageInDays('2026-09-20', new Date('2026-09-15T09:00:00Z'))).toBe(0)
  })

  it('is zero for a missing date rather than NaN', () => {
    expect(ageInDays(null)).toBe(0)
    expect(ageInDays('not a date')).toBe(0)
  })
})
