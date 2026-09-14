import { describe, expect, it } from 'vitest'
import { newHeader, newLine, toPayload } from './formModel'
import { specForCode } from './registry'

const JOB_WORK_OUT = specForCode('JOB_WORK_OUT')!

/**
 * Table 4 of FORM GST ITC-04 declares the value the goods went out at. Nothing is costed on a
 * dispatch — the stock never leaves the principal's ownership — so the only place that value can
 * come from is the challan itself, and without the field on the form the quarterly return can
 * only ever be filed at 0.00 against real quantities.
 */
describe('job work outward challan value', () => {
  it('offers a value on the dispatch challan', () => {
    expect(JOB_WORK_OUT.rate).toBe(true)
  })

  it('is a commercial value, not a valuation', () => {
    expect(JOB_WORK_OUT.valuation).toBe(false)
    expect(JOB_WORK_OUT.valuationRate).toBe(false)
  })

  it('sends the entered value with the challan', () => {
    const header = { ...newHeader(JOB_WORK_OUT, '2026-05-14'), party_ref: '501', default_warehouse_id: 3 }
    const lines = [
      newLine(JOB_WORK_OUT, { item_id: 90, qty: '120', rate: '800' }),
      newLine(JOB_WORK_OUT, { item_id: 91, qty: '20', rate: '450', amount: '9000' }),
    ]

    const p = toPayload(header, lines, JOB_WORK_OUT)

    expect(p.lines[0]).toMatchObject({ item_id: 90, qty: 120, rate: 800, amount: 96000 })
    expect(p.lines[1]).toMatchObject({ item_id: 91, qty: 20, rate: 450, amount: 9000 })
    expect(p.lines[0].valuation_rate).toBeUndefined()
  })
})
