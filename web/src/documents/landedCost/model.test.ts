import { describe, expect, it } from 'vitest'
import { newCharge, previewAllocation } from '../landedCost'
import type { ChargeDraft } from '../landedCost'
import type { InventoryDocument } from '../types'
import { allocationLinesFrom, chargeSlices, derive, eligibilityOf, isSelectable, lockedUptoFor, reviewRows, summarise } from './model'
import type { AllocationLine } from './model'

/**
 * The figures the screen shows before anything is posted.
 *
 * The rule the whole page rests on: what is on screen has to be what reaches stock value. So these
 * pin the totals, the per-line effect and the eligibility decisions against the same refusals the
 * server makes — a preview that disagrees with the engine is worse than no preview at all.
 */

const WAREHOUSE = (id: number | null | undefined) => (id ? `Warehouse ${id}` : '')

function line(partial: Partial<AllocationLine> = {}): AllocationLine {
  return {
    line_id: 11,
    label: 'Industrial bearing',
    base_qty: 500,
    valuation_amount: 100000,
    unit_symbol: 'Pcs',
    receipt_id: 41,
    receipt_no: 'GRN-000145',
    item_id: 5,
    sku: 'BRG-6205',
    warehouse_id: 1,
    warehouse_name: 'Main',
    invoice_amount: 100000,
    current_unit_cost: 200,
    landed_cost_already: 0,
    ...partial,
  }
}

function charge(partial: Partial<ChargeDraft> = {}): ChargeDraft {
  return newCharge(partial)
}

describe('allocationLinesFrom', () => {
  /** The same filter DocumentPostingService::landedCostTargetLines applies. */
  it('keeps only valued inward lines with a real quantity', () => {
    const doc = {
      document_id: 41,
      document_no: 'GRN-000145',
      lines: [
        { line_id: 11, item_id: 5, item_label: 'Valued inward', direction: 'in', base_qty: 10, valuation_rate: 100, valuation_amount: 1000, warehouse_id: 1, item_sku: 'A-1', source_transaction_amount: 900, landed_cost_amount: 0 },
        { line_id: 12, item_id: 6, item_label: 'Outward', direction: 'out', base_qty: 4, valuation_rate: 100, valuation_amount: 400 },
        { line_id: 13, item_id: 7, item_label: 'Unvalued', direction: 'in', base_qty: 4, valuation_rate: null, valuation_amount: null },
        { line_id: 14, item_id: 8, item_label: 'No quantity', direction: 'in', base_qty: 0, valuation_rate: 100, valuation_amount: 0 },
      ],
    } as unknown as InventoryDocument

    const lines = allocationLinesFrom(doc, WAREHOUSE)

    expect(lines.map((l) => l.line_id)).toEqual([11])
    expect(lines[0].current_unit_cost).toBe(100)
    expect(lines[0].receipt_no).toBe('GRN-000145')
    expect(lines[0].invoice_amount).toBe(900)
  })

  it('names the warehouse from reference data when the line does not carry one', () => {
    const doc = {
      document_id: 41,
      document_no: 'GRN-1',
      lines: [{ line_id: 11, item_id: 5, direction: 'in', base_qty: 1, valuation_rate: 5, valuation_amount: 5, warehouse_id: 7 }],
    } as unknown as InventoryDocument

    expect(allocationLinesFrom(doc, WAREHOUSE)[0].warehouse_name).toBe('Warehouse 7')
  })
})

describe('eligibilityOf', () => {
  const base = { status: 'POSTED', documentDate: '2026-09-15', documentId: 41, lines: [line()] }

  it('accepts a posted, valued receipt', () => {
    expect(eligibilityOf(base)).toBe('eligible')
  })

  it('refuses a receipt that is not posted, whatever else is true of it', () => {
    expect(eligibilityOf({ ...base, status: 'DRAFT' })).toBe('not_posted')
    expect(eligibilityOf({ ...base, status: 'CANCELLED' })).toBe('not_posted')
  })

  it('refuses a reversed receipt, which no longer holds the stock', () => {
    expect(eligibilityOf({ ...base, status: 'REVERSED' })).toBe('reversed')
  })

  it('refuses a receipt with no valued inward line', () => {
    expect(eligibilityOf({ ...base, lines: [] })).toBe('unvalued')
  })

  /**
   * The lock is checked on the RECEIPT's date, not the allocation's, because posting rewrites the
   * receipt's stored valuation and the cost layer it opened — both inside the receipt's period.
   */
  it('refuses a receipt dated inside a locked period', () => {
    expect(eligibilityOf({ ...base, lockedUptoDate: '2026-09-30' })).toBe('period_locked')
    expect(eligibilityOf({ ...base, lockedUptoDate: '2026-08-31' })).toBe('eligible')
  })

  it('refuses the allocation loading itself', () => {
    expect(eligibilityOf({ ...base, ownDocumentId: 41 })).toBe('self')
  })

  /** A receipt that already carries freight can carry duty: a note, not a refusal. */
  it('notes a receipt that already carries a landed cost without refusing it', () => {
    const eligibility = eligibilityOf({ ...base, lines: [line({ landed_cost_already: 800 })] })
    expect(eligibility).toBe('partially_allocated')
    expect(isSelectable(eligibility)).toBe(true)
  })

  it('stays provisional while the lines are still being read', () => {
    expect(eligibilityOf({ ...base, lines: null })).toBe('eligible')
  })
})

describe('lockedUptoFor', () => {
  const locks = [
    { bo_id: 0, locked_upto_date: '2026-03-31', released_at: null },
    { bo_id: 2, locked_upto_date: '2026-06-30', released_at: null },
    { bo_id: 2, locked_upto_date: '2026-12-31', released_at: '2026-09-01 10:00:00' },
  ]

  it('takes the latest lock in force for the branch, company-wide locks included', () => {
    expect(lockedUptoFor(locks, 2)).toBe('2026-06-30')
  })

  it('ignores another branch’s lock', () => {
    expect(lockedUptoFor(locks, 5)).toBe('2026-03-31')
  })

  it('ignores a released lock, however late it ran', () => {
    expect(lockedUptoFor(locks, 2)).not.toBe('2026-12-31')
  })

  it('answers nothing when the locks were never read', () => {
    expect(lockedUptoFor(null, 1)).toBeNull()
  })
})

describe('summarise', () => {
  const lines = [
    line({ line_id: 11, base_qty: 500, valuation_amount: 100000, invoice_amount: 100000, receipt_id: 41, warehouse_id: 1 }),
    line({ line_id: 12, base_qty: 300, valuation_amount: 20000, invoice_amount: 20000, receipt_id: 42, warehouse_id: 1 }),
  ]

  it('counts receipts, lines and warehouses distinctly', () => {
    const s = summarise(lines, previewAllocation([], lines))
    expect(s.receipts).toBe(2)
    expect(s.itemLines).toBe(2)
    expect(s.warehouses).toBe(1)
    expect(s.quantity).toBe(800)
    expect(s.currentValue).toBe(120000)
    expect(s.invoiceValue).toBe(120000)
  })

  it('adds the charges to stock value and reports the uplift as a percentage', () => {
    const preview = previewAllocation([charge({ amount: '12000', allocation_basis: 'value' })], lines)
    const s = summarise(lines, preview)

    expect(s.landedCost).toBe(12000)
    expect(s.allocated).toBe(12000)
    expect(s.unallocated).toBe(0)
    expect(s.revisedValue).toBe(132000)
    expect(s.landedCostPercent).toBe(10)
  })

  /** Rupees entered that reach no line are the failure the whole screen exists to prevent. */
  it('reports a charge that reaches no line rather than hiding it in the total', () => {
    const s = summarise(lines, previewAllocation([charge({ amount: '400', allocation_basis: 'manual', lines: { 11: '250' } })], lines))

    expect(s.landedCost).toBe(400)
    expect(s.allocated).toBe(250)
    expect(s.unallocated).toBe(150)
  })

  it('says nothing rather than zero when no line carries a commercial figure', () => {
    expect(summarise([line({ invoice_amount: null })], previewAllocation([], [])).invoiceValue).toBeNull()
  })

  it('divides by nothing safely', () => {
    expect(summarise([], previewAllocation([], [])).landedCostPercent).toBeNull()
  })
})

describe('reviewRows', () => {
  const lines = [
    line({ line_id: 11, base_qty: 500, valuation_amount: 100000 }),
    line({ line_id: 12, base_qty: 300, valuation_amount: 20000 }),
  ]

  /** The worked example from the design: 500 units at 200, taking 8,092 of a by-value split. */
  it('gives the per-unit uplift and the new unit cost for every line', () => {
    const charges = [charge({ amount: '9710.4', allocation_basis: 'value' })]
    const rows = reviewRows(lines, charges, previewAllocation(charges, lines))

    expect(rows[0].allocatedCost).toBe(8092)
    expect(rows[0].allocatedPerUnit).toBe(16.184)
    expect(rows[0].revisedUnitCost).toBe(216.184)
    expect(rows[0].revisedValue).toBe(108092)
    expect(rows[0].basis).toBe('value')
  })

  it('calls a line mixed when more than one basis reached it', () => {
    const charges = [charge({ amount: '400', allocation_basis: 'value' }), charge({ amount: '200', allocation_basis: 'qty' })]
    expect(reviewRows(lines, charges, previewAllocation(charges, lines))[0].basis).toBe('mixed')
  })

  it('says none for a line no charge reached', () => {
    const charges = [charge({ amount: '400', allocation_basis: 'direct', lines: { 12: '400' } })]
    expect(reviewRows(lines, charges, previewAllocation(charges, lines))[0].basis).toBe('none')
  })

  it('never divides by a zero quantity', () => {
    const rows = reviewRows([line({ base_qty: 0, valuation_amount: 0 })], [], previewAllocation([], []))
    expect(rows[0].revisedUnitCost).toBe(0)
    expect(Number.isFinite(rows[0].allocatedPerUnit)).toBe(true)
  })
})

describe('chargeSlices', () => {
  const labels = { freight: 'Freight', duty: 'Customs duty', insurance: 'Insurance' }

  it('groups by cost type, largest first, with shares that add to a hundred', () => {
    const slices = chargeSlices(
      [
        charge({ cost_type: 'insurance', amount: '3500' }),
        charge({ cost_type: 'freight', amount: '28000' }),
        charge({ cost_type: 'duty', amount: '12500' }),
      ],
      labels,
    )

    expect(slices.map((s) => s.costType)).toEqual(['freight', 'duty', 'insurance'])
    expect(slices[0].percent).toBeCloseTo(63.64, 1)
    expect(slices.reduce((a, s) => a + s.percent, 0)).toBeCloseTo(100, 4)
  })

  it('folds two charges of the same type into one slice', () => {
    const slices = chargeSlices([charge({ cost_type: 'freight', amount: '100' }), charge({ cost_type: 'freight', amount: '300' })], labels)
    expect(slices).toHaveLength(1)
    expect(slices[0].amount).toBe(400)
  })

  it('shows nothing rather than an empty ring when no charge is priced', () => {
    expect(chargeSlices([charge({ amount: '' }), charge({ amount: '0' })], labels)).toEqual([])
  })
})

describe('derive', () => {
  it('produces the preview, the totals and the rows from one pass', () => {
    const lines = [line({ line_id: 11, base_qty: 10, valuation_amount: 1000 })]
    const out = derive(lines, [charge({ amount: '100', allocation_basis: 'value' })])

    expect(out.summary.landedCost).toBe(100)
    expect(out.rows[0].allocatedCost).toBe(100)
    expect(out.preview.perLine[11]).toBe(100)
  })
})
