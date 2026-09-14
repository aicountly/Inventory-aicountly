import { describe, expect, it } from 'vitest'
import { newHeader, newLine, validateDraft } from './formModel'
import { specForCode } from './registry'

const JOB_WORK_IN = specForCode('JOB_WORK_IN')!

/**
 * A job-work receipt form shows two money columns: Rate, the value agreed with the job worker that
 * the challan declares and FORM GST ITC-04 files, and Unit cost (in), what the goods coming back
 * cost. Only the second is a cost, and nothing else on the document can supply it — so a blank cost
 * column used to submit happily and post the receipt into stock at zero.
 */
describe('a job-work receipt is priced before it is submitted', () => {
  const header = () => ({ ...newHeader(JOB_WORK_IN, '2026-04-01'), party_ref: '55', party_name: 'Shree Finishers' })
  const inward = (valuation_rate: string) => newLine(JOB_WORK_IN, { item_id: 90, qty: '10', direction: 'in', rate: '1250', valuation_rate })

  it('refuses goods coming back with no unit cost', () => {
    expect(validateDraft(header(), [inward('')], JOB_WORK_IN)).toEqual(['Line 1: enter the unit cost of the goods coming back.'])
    expect(validateDraft(header(), [inward('0')], JOB_WORK_IN)).toEqual(['Line 1: enter the unit cost of the goods coming back.'])
  })

  it('does not accept the challan rate as the cost', () => {
    const errors = validateDraft(header(), [inward('')], JOB_WORK_IN)
    expect(errors).toHaveLength(1)
  })

  it('accepts a receipt whose cost is typed', () => {
    expect(validateDraft(header(), [inward('610')], JOB_WORK_IN)).toEqual([])
  })

  it('leaves the components consumed at the job worker alone — the engine costs those', () => {
    const consumed = newLine(JOB_WORK_IN, { item_id: 91, qty: '120', direction: 'out' })
    expect(validateDraft(header(), [inward('610'), consumed], JOB_WORK_IN)).toEqual([])
  })
})
