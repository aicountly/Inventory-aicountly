import { describe, expect, it } from 'vitest'
import {
  ALLOCATION_BASES,
  LANDED_COST_TYPES,
  allocateCharge,
  chargesFromMetadata,
  chargesToPayload,
  newCharge,
  previewAllocation,
  settleResidual,
  sharesForCharge,
  validateCharges,
} from './landedCost'
import type { ChargeDraft, TargetLine } from './landedCost'
import { newHeader, validateDraft } from './formModel'
import { specForCode, UNAVAILABLE_TYPES } from './registry'

/**
 * The per-line preview the charges block shows before saving has to be the split the server
 * stores. A preview that rounds differently from DocumentPostingService::allocateCharge teaches the
 * operator a number that is not the one in closing stock — and the number that matters is the total:
 * the shares have to sum EXACTLY to the charge, because a rupee lost to rounding is a closing stock
 * that does not tie.
 */

const LINES: TargetLine[] = [
  { line_id: 11, label: 'Cheap', base_qty: 10, valuation_amount: 1000 },
  { line_id: 12, label: 'Dear', base_qty: 10, valuation_amount: 3000 },
]

function charge(partial: Partial<ChargeDraft> = {}): ChargeDraft {
  return newCharge(partial)
}

function total(shares: { amount: number }[]): number {
  return Math.round(shares.reduce((a, s) => a + s.amount, 0) * 10000) / 10000
}

describe('allocateCharge', () => {
  it('spreads in proportion to the weights', () => {
    expect(allocateCharge(400, [
      { line_id: 11, weight: 1000 },
      { line_id: 12, weight: 3000 },
    ])).toEqual([
      { line_id: 11, amount: 100 },
      { line_id: 12, amount: 300 },
    ])
  })

  it('never loses the residual — three equal lines and 100 still add up to 100', () => {
    const shares = allocateCharge(100, [
      { line_id: 11, weight: 1 },
      { line_id: 12, weight: 1 },
      { line_id: 13, weight: 1 },
    ])

    expect(total(shares)).toBe(100)
    // The same split the server produces: the residual goes on the largest, first-wins on a tie.
    expect(shares).toEqual([
      { line_id: 11, amount: 33.3334 },
      { line_id: 12, amount: 33.3333 },
      { line_id: 13, amount: 33.3333 },
    ])
  })

  it('puts the residual on the largest line', () => {
    const shares = allocateCharge(1000, [
      { line_id: 11, weight: 1 },
      { line_id: 12, weight: 1 },
      { line_id: 13, weight: 7 },
    ])

    expect(total(shares)).toBe(1000)
    expect(shares[2].amount).toBe(777.7778)
    expect(shares[0].amount).toBe(111.1111)
  })

  it('ties to the rupee over many awkward lines', () => {
    const weights = Array.from({ length: 17 }, (_, i) => ({ line_id: i + 1, weight: i + 1 }))
    expect(total(allocateCharge(1000.01, weights))).toBe(1000.01)
  })

  it('gives nothing to a line that weighs nothing', () => {
    const shares = allocateCharge(500, [
      { line_id: 11, weight: 1000 },
      { line_id: 12, weight: 0 },
    ])
    expect(shares).toEqual([
      { line_id: 11, amount: 500 },
      { line_id: 12, amount: 0 },
    ])
  })

  it('allocates nothing at all when every line weighs nothing, the way the server refuses it', () => {
    expect(allocateCharge(500, [{ line_id: 11, weight: 0 }])).toEqual([])
    expect(allocateCharge(500, [])).toEqual([])
  })
})

describe('settleResidual', () => {
  it('keeps typed shares and settles only the slack', () => {
    const shares = settleResidual([
      { line_id: 11, amount: 600 },
      { line_id: 12, amount: 399.99 },
    ], 1000)

    expect(total(shares)).toBe(1000)
    expect(shares[0].amount).toBe(600.01)
    expect(shares[1].amount).toBe(399.99)
  })

  it('leaves shares that already tie alone', () => {
    expect(settleResidual([{ line_id: 11, amount: 600 }, { line_id: 12, amount: 400 }], 1000)).toEqual([
      { line_id: 11, amount: 600 },
      { line_id: 12, amount: 400 },
    ])
  })
})

describe('sharesForCharge', () => {
  it('spreads by value', () => {
    expect(sharesForCharge(charge({ amount: '400', allocation_basis: 'value' }), LINES)).toEqual([
      { line_id: 11, amount: 100 },
      { line_id: 12, amount: 300 },
    ])
  })

  it('spreads by quantity, which ignores what the lines are worth', () => {
    expect(sharesForCharge(charge({ amount: '400', allocation_basis: 'qty' }), LINES)).toEqual([
      { line_id: 11, amount: 200 },
      { line_id: 12, amount: 200 },
    ])
  })

  /**
   * 'equal' is the basis for a per-consignment fee the lines did not earn in proportion to anything
   * Inventory holds — a documentation charge is the same rupees whether the crate holds one line or
   * ten. It is a weight of 1 per line rather than a division, so the same rounding and the same
   * residual placement serve it as every other basis.
   */
  it('splits evenly for the equal basis, whatever the lines are worth', () => {
    expect(sharesForCharge(charge({ amount: '400', allocation_basis: 'equal' }), LINES)).toEqual([
      { line_id: 11, amount: 200 },
      { line_id: 12, amount: 200 },
    ])
  })

  it('still ties to the charge when equal does not divide cleanly', () => {
    const three: TargetLine[] = [...LINES, { line_id: 13, label: 'Third', base_qty: 5, valuation_amount: 500 }]
    const shares = sharesForCharge(charge({ amount: '100', allocation_basis: 'equal' }), three)

    expect(total(shares)).toBe(100)
    expect(shares.map((s) => s.amount)).toEqual([33.3334, 33.3333, 33.3333])
  })

  it('uses the typed shares for manual and direct', () => {
    expect(sharesForCharge(charge({ amount: '100', allocation_basis: 'manual', lines: { 11: '75', 12: '25' } }), LINES)).toEqual([
      { line_id: 11, amount: 75 },
      { line_id: 12, amount: 25 },
    ])
    expect(sharesForCharge(charge({ amount: '134.56', allocation_basis: 'direct', lines: { 12: '134.56' } }), LINES)).toEqual([{ line_id: 12, amount: 134.56 }])
  })

  it('allocates nothing for a charge with no amount', () => {
    expect(sharesForCharge(charge({ amount: '', allocation_basis: 'value' }), LINES)).toEqual([])
    expect(sharesForCharge(charge({ amount: '0', allocation_basis: 'value' }), LINES)).toEqual([])
  })
})

describe('previewAllocation', () => {
  it('adds every charge onto every line it touches', () => {
    const charges = [
      charge({ amount: '400', allocation_basis: 'value', cost_type: 'freight' }),
      charge({ amount: '200', allocation_basis: 'qty', cost_type: 'duty' }),
      charge({ amount: '100', allocation_basis: 'manual', cost_type: 'handling', lines: { 11: '75', 12: '25' } }),
    ]

    const preview = previewAllocation(charges, LINES)

    // The same totals the server integration test asserts for the same three charges.
    expect(preview.perLine[11]).toBe(275)
    expect(preview.perLine[12]).toBe(425)
    expect(preview.total).toBe(700)
    expect(preview.allocated).toBe(700)
  })

  /**
   * A shortfall wider than the entry tolerance is SHOWN, not quietly topped up. The server refuses
   * per-line shares that miss the charge by more than a paisa before it places any residual, so a
   * preview that made 250 look like 400 would show a charge that adds up and then hand the user a
   * 422 on save — and hide the gap that has to be corrected.
   */
  it('reports what is not spread, so an unallocated charge is visible before saving', () => {
    const preview = previewAllocation([charge({ amount: '400', allocation_basis: 'manual', lines: { 11: '250' } })], LINES)

    expect(preview.total).toBe(400)
    expect(preview.allocated).toBe(250)
    expect(preview.perLine[11]).toBe(250)
  })

  it('still settles the paisa of slack the entry tolerance allows', () => {
    const preview = previewAllocation([charge({ amount: '400', allocation_basis: 'manual', lines: { 11: '100', 12: '299.99' } })], LINES)

    expect(preview.allocated).toBe(400)
    expect(preview.perLine[12]).toBe(300)
  })
})

describe('validateCharges', () => {
  it('accepts a complete allocation', () => {
    expect(validateCharges(41, [charge({ amount: '400', allocation_basis: 'value' })], LINES)).toEqual([])
  })

  it('needs a receipt and at least one charge', () => {
    const errors = validateCharges(null, [], LINES)
    expect(errors).toContain('Pick the receipt these charges belong to.')
    expect(errors).toContain('Add at least one charge to allocate.')
  })

  it('refuses a charge with no amount', () => {
    expect(validateCharges(41, [charge({ amount: '' })], LINES)[0]).toContain('amount greater than zero')
  })

  it('refuses manual shares that do not tie to the charge', () => {
    expect(validateCharges(41, [charge({ amount: '100', allocation_basis: 'manual', lines: { 11: '40' } })], LINES)[0]).toContain('add up to 40.00 but the charge is 100.00')
  })

  it('refuses a direct charge spread over more than one line', () => {
    expect(validateCharges(41, [charge({ amount: '100', allocation_basis: 'direct', lines: { 11: '60', 12: '40' } })], LINES)[0]).toContain('cannot name 2')
  })

  it('refuses a basis on which nothing weighs anything', () => {
    const worthless: TargetLine[] = [{ line_id: 11, label: 'Free', base_qty: 5, valuation_amount: 0 }]
    expect(validateCharges(41, [charge({ amount: '100', allocation_basis: 'value' })], worthless)[0]).toContain('weighs nothing on this basis')
  })
})

describe('the payload and the round trip', () => {
  it('sends only the per-line shares the basis uses', () => {
    const proRata = chargesToPayload([charge({ amount: '400', allocation_basis: 'value', description: ' Road freight ' })], LINES)
    expect(proRata).toEqual([{ cost_type: 'freight', amount: 400, allocation_basis: 'value', description: 'Road freight' }])

    const manual = chargesToPayload([charge({ amount: '100', allocation_basis: 'manual', lines: { 11: '75', 12: '25' } })], LINES)
    expect(manual[0].lines).toEqual([
      { line_id: 11, amount: 75 },
      { line_id: 12, amount: 25 },
    ])
  })

  it('reads a saved draft back into editable charges', () => {
    const rows = chargesFromMetadata([
      { cost_type: 'duty', amount: 200, allocation_basis: 'qty' },
      { cost_type: 'non_creditable_tax', amount: 134.56, allocation_basis: 'direct', lines: [{ line_id: 12, amount: 134.56 }] },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0].cost_type).toBe('duty')
    expect(rows[0].amount).toBe('200')
    expect(rows[1].lines).toEqual({ 12: '134.56' })
  })

  it('falls back rather than inventing a cost type or a basis that does not exist', () => {
    const rows = chargesFromMetadata([{ cost_type: 'demurrage', amount: 10, allocation_basis: 'weight' }])
    expect(rows[0].cost_type).toBe('other')
    expect(rows[0].allocation_basis).toBe('value')
  })
})

describe('the vocabulary matches the server', () => {
  it('lists the six cost types and the five bases', () => {
    expect([...LANDED_COST_TYPES]).toEqual(['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'])
    expect([...ALLOCATION_BASES]).toEqual(['value', 'qty', 'equal', 'manual', 'direct'])
  })

  /**
   * Weight is the basis a user reaches for and it is deliberately not offered: there is no item
   * weight master to allocate by, so the control would silently fall back to something else.
   */
  it('does not offer weight', () => {
    expect(ALLOCATION_BASES).not.toContain('weight')
  })
})

/**
 * registry.ts declares the server's Config\DocumentTypeRegistry::UNIMPLEMENTED to be the truth and
 * mirrors it. A type the server now implements but the web still hides is a feature nobody can
 * reach; the reverse is a screen that leads to a 422.
 */
describe('the unavailable-type mirror', () => {
  it('is empty, as the server list is', () => {
    expect([...UNAVAILABLE_TYPES]).toEqual([])
  })

  it('offers the landed cost form without item lines', () => {
    const spec = specForCode('LANDED_COST')
    expect(spec).not.toBeNull()
    expect(spec?.formKind).toBe('landed_cost')
    // The charges are not line rates: collecting them in the commercial source_transaction_* pair
    // Books owns was the broken shape of this type before it was built.
    expect(spec?.rate).toBe(false)
  })
})

describe('validateDraft for a landed cost allocation', () => {
  const spec = specForCode('LANDED_COST')!

  it('asks for the receipt and a charge before anything else', () => {
    const errors = validateDraft(newHeader(spec, '2026-04-18'), [], spec)
    expect(errors).toContain('Pick the receipt these landing costs belong to.')
    expect(errors).toContain('Add at least one charge to allocate.')
    expect(errors.some((e) => e.includes('item line'))).toBe(false)
  })

  it('accepts a complete allocation with no item lines at all', () => {
    const header = { ...newHeader(spec, '2026-04-18'), metadata: { target_document_id: 41, charges: [{ cost_type: 'freight', amount: 400, allocation_basis: 'value' }] } }
    expect(validateDraft(header, [], spec)).toEqual([])
  })

  it('catches manual shares that do not tie, the way the server would', () => {
    const header = {
      ...newHeader(spec, '2026-04-18'),
      metadata: { target_document_id: 41, charges: [{ cost_type: 'handling', amount: 100, allocation_basis: 'manual', lines: [{ line_id: 11, amount: 40 }] }] },
    }
    expect(validateDraft(header, [], spec)[0]).toContain('add up to 40.00 but the charge is 100.00')
  })
})
