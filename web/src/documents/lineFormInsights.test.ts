import { describe, expect, it } from 'vitest'
import { classifyReason, computeCostConfidence, computePostingReminder, computeRiskChecks } from './lineFormInsights'
import { newHeader, newLine } from './formModel'
import { specForCode } from './registry'
import { todayIso } from '../utils/format'

const WRITE_IN = specForCode('WRITE_IN')!
const WRITE_OFF = specForCode('WRITE_OFF')!
const JOURNAL = specForCode('STOCK_JOURNAL')!
const CONSUMPTION = specForCode('CONSUMPTION')!

describe('classifyReason', () => {
  it('asks for input when nothing has been typed yet', () => {
    const header = newHeader(WRITE_IN, todayIso())
    expect(classifyReason(WRITE_IN, header).label).toBe('Unclassified')
  })

  it('reads an incoming type toward excess / found stock', () => {
    const header = { ...newHeader(WRITE_IN, todayIso()), reason_code: 'FOUND' }
    expect(classifyReason(WRITE_IN, header).label).toBe('Excess Stock')
  })

  it('reads an outgoing type toward damage / loss', () => {
    const header = { ...newHeader(WRITE_OFF, todayIso()), movement_reason: 'Damaged in transit' }
    expect(classifyReason(WRITE_OFF, header).label).toBe('Damage / Loss')
  })

  it('falls back to unclassified when the text matches nothing', () => {
    const header = { ...newHeader(WRITE_IN, todayIso()), narration: 'zzz misc adjustment' }
    expect(classifyReason(WRITE_IN, header).label).toBe('Unclassified')
  })
})

describe('computeCostConfidence', () => {
  it('is pending with no lines yet', () => {
    expect(computeCostConfidence(WRITE_IN, [], undefined).level).toBe('pending')
  })

  it('is automatic for a type with no rate column', () => {
    const lines = [newLine(CONSUMPTION, { item_id: 1, qty: '2' })]
    expect(computeCostConfidence(CONSUMPTION, lines, undefined).level).toBe('auto')
  })

  it('is high once every line carries a positive rate', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '10' }), newLine(WRITE_IN, { item_id: 2, qty: '1', rate: '5' })]
    expect(computeCostConfidence(WRITE_IN, lines, undefined).level).toBe('high')
  })

  it('is medium when only some lines have a cost basis', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '10' }), newLine(WRITE_IN, { item_id: 2, qty: '1', rate: '' })]
    expect(computeCostConfidence(WRITE_IN, lines, undefined).level).toBe('medium')
  })

  it('picks up a reference cost when the rate itself is blank', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '' })]
    const refs = new Map([[1, 42]])
    expect(computeCostConfidence(WRITE_IN, lines, refs).level).toBe('high')
  })

  it('is low when nothing has a cost basis', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '' })]
    expect(computeCostConfidence(WRITE_IN, lines, undefined).level).toBe('low')
  })
})

describe('computeRiskChecks', () => {
  it('is empty with no active lines', () => {
    expect(computeRiskChecks(WRITE_IN, newHeader(WRITE_IN, todayIso()), [])).toEqual([])
  })

  it('flags a zero rate on a quantified line', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, item_name: 'Widget', qty: '2', rate: '' })]
    const risks = computeRiskChecks(WRITE_IN, newHeader(WRITE_IN, todayIso()), lines)
    expect(risks.some((r) => r.id.startsWith('zero-rate'))).toBe(true)
  })

  it('flags a future document date', () => {
    const header = { ...newHeader(WRITE_IN, todayIso()), document_date: '2999-01-01' }
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '10' })]
    const risks = computeRiskChecks(WRITE_IN, header, lines)
    expect(risks.some((r) => r.id === 'future-date')).toBe(true)
  })

  it('flags a missing reason when the type expects one', () => {
    const lines = [newLine(JOURNAL, { item_id: 1, qty: '2', rate: '10', direction: 'in' })]
    const risks = computeRiskChecks(JOURNAL, newHeader(JOURNAL, todayIso()), lines)
    expect(risks.some((r) => r.id === 'missing-reason')).toBe(true)
  })

  it('flags a missing batch for a batch-tracked item', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '10', track_batch: true })]
    const risks = computeRiskChecks(WRITE_IN, newHeader(WRITE_IN, todayIso()), lines)
    expect(risks.some((r) => r.id.startsWith('missing-batch'))).toBe(true)
  })

  it('flags a rate that materially differs from the reference cost', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '100' })]
    const risks = computeRiskChecks(WRITE_IN, newHeader(WRITE_IN, todayIso()), lines, { referenceCosts: new Map([[1, 10]]) })
    expect(risks.some((r) => r.id.startsWith('rate-variance'))).toBe(true)
  })

  it('stays quiet when a rate is close enough to the reference cost', () => {
    const lines = [newLine(WRITE_IN, { item_id: 1, qty: '2', rate: '10.5' })]
    const risks = computeRiskChecks(WRITE_IN, newHeader(WRITE_IN, todayIso()), lines, { referenceCosts: new Map([[1, 10]]) })
    expect(risks.some((r) => r.id.startsWith('rate-variance'))).toBe(false)
  })
})

describe('computePostingReminder', () => {
  it('prompts to add a line first', () => {
    expect(computePostingReminder(newHeader(WRITE_IN, todayIso()), false).badge).toBe('Getting started')
  })

  it('nudges toward a narration once lines exist', () => {
    expect(computePostingReminder(newHeader(WRITE_IN, todayIso()), true).badge).toBe('Best practice')
  })

  it('is happy once a narration is set', () => {
    const header = { ...newHeader(WRITE_IN, todayIso()), narration: 'Found during cycle count.' }
    expect(computePostingReminder(header, true).badge).toBe('Good')
  })
})
