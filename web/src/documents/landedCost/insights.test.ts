import { describe, expect, it } from 'vitest'
import { newCharge, previewAllocation } from '../landedCost'
import type { ChargeDraft } from '../landedCost'
import { allClear, analyse, rankInsights } from './insights'
import { summarise } from './model'
import type { AllocationLine } from './model'

/**
 * The observations the sidebar makes.
 *
 * The property that matters most is the one about SEVERITY: a screening threshold must never be
 * dressed as an accounting error. Freight at 18% of invoice value on an air consignment is
 * ordinary, so it is a 'review' and never a 'blocker', and nothing in this module may invent a
 * finding that was not computed from the figures on screen.
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
  return newCharge(partial)
}

function run(charges: ChargeDraft[], lines: AllocationLine[] = [line()], receipts = [{ document_id: 41, document_no: 'GRN-000145', party_ref: 77, party_name: 'Acme' }]) {
  const preview = previewAllocation(charges, lines)
  return analyse({ charges, lines, summary: summarise(lines, preview), receipts })
}

describe('analyse', () => {
  it('reports each charge as a share of invoice value', () => {
    const insights = run([charge({ cost_type: 'freight', amount: '5200', allocation_basis: 'value' })])
    const share = insights.find((i) => i.id.startsWith('share-'))

    expect(share?.message).toContain('5.2% of invoice value')
    expect(share?.severity).toBe('note')
    expect(share?.status).toBe('Normal')
  })

  it('falls back to stock value when no line carries a commercial figure, and says which it used', () => {
    const insights = run([charge({ cost_type: 'freight', amount: '5200', allocation_basis: 'value' })], [line({ invoice_amount: null })])
    expect(insights.find((i) => i.id.startsWith('share-'))?.message).toContain('of stock value')
  })

  /** The band is a prompt to look, not a rule of accounting — so 'review', never 'blocker'. */
  it('flags a freight percentage past the screening band as review, not as an error', () => {
    const insights = run([charge({ cost_type: 'freight', amount: '20000', allocation_basis: 'value' })])
    const share = insights.find((i) => i.id.startsWith('share-'))

    expect(share?.severity).toBe('review')
    expect(share?.status).toBe('Review')
    expect(insights.some((i) => i.severity === 'blocker')).toBe(false)
  })

  /**
   * Duty has no band on purpose: a rate that is ordinary for one HSN is extraordinary for another
   * and Inventory holds nothing that tells them apart, so its percentage is a fact and never a flag.
   */
  it('never flags customs duty as unusual, however large it is', () => {
    const insights = run([
      charge({ cost_type: 'duty', amount: '60000', allocation_basis: 'value' }),
      charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' }),
    ])
    const duty = insights.find((i) => i.message.startsWith('Customs duty is'))

    expect(duty?.severity).toBe('note')
  })

  it('warns when the same cost type is entered twice, without refusing it', () => {
    const insights = run([
      charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' }),
      charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' }),
    ])
    const duplicate = insights.find((i) => i.id === 'duplicate-freight')

    expect(duplicate?.severity).toBe('warning')
    expect(duplicate?.message).toContain('2 separate freight charges')
  })

  it('warns that a receipt already carries a landed cost, which is how a bill allocated twice looks', () => {
    const insights = run([charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' })], [line({ landed_cost_already: 800 })])
    const already = insights.find((i) => i.id === 'already-41')

    expect(already?.severity).toBe('warning')
    expect(already?.message).toContain('GRN-000145 already carries 800.00')
  })

  it('warns when the receipts selected are from different suppliers', () => {
    const insights = run(
      [charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' })],
      [line({ receipt_id: 41 }), line({ line_id: 12, receipt_id: 42, receipt_no: 'GRN-000146' })],
      [
        { document_id: 41, document_no: 'GRN-000145', party_ref: 77, party_name: 'Acme' },
        { document_id: 42, document_no: 'GRN-000146', party_ref: 88, party_name: 'Globex' },
      ],
    )

    expect(insights.find((i) => i.id === 'mixed-suppliers')?.severity).toBe('warning')
  })

  it('asks about duty entered with no freight — goods that crossed a border were carried by someone', () => {
    const insights = run([charge({ cost_type: 'duty', amount: '1000', allocation_basis: 'value' })])
    expect(insights.find((i) => i.id === 'duty-without-freight')?.severity).toBe('review')
  })

  /** Rupees entered that reach no line never become stock value: the one hard stop in this module. */
  it('blocks on a charge that reaches no line', () => {
    const insights = run([charge({ cost_type: 'freight', amount: '400', allocation_basis: 'manual', lines: { 99: '400' } })])
    const unallocated = insights.find((i) => i.id === 'unallocated')

    expect(unallocated?.severity).toBe('blocker')
    expect(unallocated?.status).toBe('Fix')
  })

  it('says nothing at all before anything has been entered', () => {
    expect(run([], [])).toEqual([])
  })

  it('marks every observation as computed here, never as a service finding', () => {
    for (const insight of run([charge({ cost_type: 'freight', amount: '5200', allocation_basis: 'value' })])) {
      expect(insight.source).toBe('system')
    }
  })
})

describe('rankInsights', () => {
  it('puts what must be fixed above what is merely worth a look', () => {
    const insights = run([
      charge({ cost_type: 'freight', amount: '1000', allocation_basis: 'value' }),
      charge({ cost_type: 'freight', amount: '400', allocation_basis: 'manual', lines: { 99: '400' } }),
    ])
    const ranked = rankInsights(insights)

    expect(ranked[0].severity).toBe('blocker')
    expect(ranked.at(-1)?.severity).toBe('note')
  })
})

describe('allClear', () => {
  it('is true when nothing worse than a plain fact was found', () => {
    expect(allClear(run([charge({ cost_type: 'freight', amount: '5200', allocation_basis: 'value' })]))).toBe(true)
  })

  it('is false the moment anything needs a second look', () => {
    expect(allClear(run([charge({ cost_type: 'freight', amount: '30000', allocation_basis: 'value' })]))).toBe(false)
  })
})
