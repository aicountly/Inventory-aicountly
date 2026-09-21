import { describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import { applyBatchMapping, batchMapping, validateBatchAdjustment } from './batchAdjustmentModel'
import { assistHeadline, buildAssistReport, matchingInLine, unpairedOutLines } from './batchAssist'

const SPEC = specForCode('BATCH_ADJUSTMENT')!

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(SPEC, '2026-09-18'), default_warehouse_id: 1, reason_code: 'DAMAGE', narration: 'Re-lotted after count', ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, {
    item_id: 10,
    item_name: 'Axle Assembly',
    item_sku: 'ITEM-AX45',
    track_batch: true,
    warehouse_id: 1,
    unit_id: 5,
    units: [{ unit_id: 5, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }],
    direction: 'out',
    qty: '10',
    ...patch,
  })
}

function mapped(patch: Partial<LineDraft> = {}): LineDraft {
  const base = line(patch)
  const from = { ...base, ...applyBatchMapping(base, 'from', { batch_id: 101, batch_no: 'BATCH-A' }) }
  return { ...from, ...applyBatchMapping(from, 'to', { batch_id: 102, batch_no: 'BATCH-B' }) }
}

describe('pairing an out line with the in line that receives it', () => {
  it('finds the out line nothing receives', () => {
    const out = mapped()
    expect(unpairedOutLines([out], 1).map((l) => l.key)).toEqual([out.key])
  })

  it('treats a matching in line of the same item, warehouse and quantity as the receipt', () => {
    const out = mapped()
    const inbound = mapped({ direction: 'in' })
    expect(unpairedOutLines([out, inbound], 1)).toEqual([])
  })

  it('does not let one in line answer for two out lines', () => {
    const out = mapped()
    const other = mapped()
    const inbound = mapped({ direction: 'in' })
    expect(unpairedOutLines([out, other, inbound], 1)).toHaveLength(1)
  })

  it('reads a line with no warehouse of its own as being at the document default', () => {
    const out = mapped({ warehouse_id: null })
    const inbound = mapped({ direction: 'in', warehouse_id: 1 })
    expect(unpairedOutLines([out, inbound], 1)).toEqual([])
  })

  it('builds the matching line as the same movement in reverse', () => {
    const out = mapped()
    const receipt = matchingInLine(out, SPEC)
    expect(receipt.key).not.toBe(out.key)
    expect(receipt.direction).toBe('in')
    expect(receipt.item_id).toBe(out.item_id)
    expect(receipt.qty).toBe(out.qty)
    expect(receipt.warehouse_id).toBe(out.warehouse_id)
    // The stored batch is the one the quantity lands on, and the source is remembered beside it.
    expect(receipt.batch_id).toBe(102)
    expect(batchMapping(receipt)).toEqual({ from_batch_id: 101, from_batch_no: 'BATCH-A', to_batch_id: 102, to_batch_no: 'BATCH-B' })
    expect(receipt.description).toBe('Reallocated from BATCH-A')
  })

  it('leaves the destination blank when the out line never named one', () => {
    const base = line()
    const out = { ...base, ...applyBatchMapping(base, 'from', { batch_id: 101, batch_no: 'BATCH-A' }) }
    const receipt = matchingInLine(out, SPEC)
    expect(receipt.batch_id).toBeNull()
    expect(batchMapping(receipt).from_batch_id).toBe(101)
  })
})

describe('what Batch Assist reports', () => {
  it('says nothing about an untouched document', () => {
    const report = buildAssistReport(header(), [newLine(SPEC)], [])
    expect(report.items).toEqual([])
    expect(report.headline).toBe('Nothing to flag on this document yet.')
  })

  it('carries every validation issue through, split by severity', () => {
    const broken = line({ item_id: null, qty: '0' })
    const issues = validateBatchAdjustment({ header: header(), lines: [broken] })
    const report = buildAssistReport(header(), [broken], issues)
    expect(report.critical).toBe(issues.filter((i) => i.severity === 'error').length)
    expect(report.items.filter((i) => i.severity === 'critical').every((i) => i.action?.kind === 'focus' || i.lineKey === null)).toBe(true)
  })

  it('offers the matching in line as a one-click fix', () => {
    const out = mapped()
    const report = buildAssistReport(header(), [out], [])
    const pair = report.items.find((i) => i.action?.kind === 'pair')
    expect(pair).toBeTruthy()
    expect(pair?.action).toEqual({ kind: 'pair', lineKey: out.key })
  })

  it('asks for a reason code and a narration when the document has neither', () => {
    const report = buildAssistReport(header({ reason_code: '', narration: '' }), [mapped()], [])
    expect(report.items.map((i) => i.id)).toContain('reason-code')
    expect(report.items.map((i) => i.id)).toContain('narration')
  })

  it('confirms a balanced pair rather than only complaining', () => {
    const lines = [mapped(), mapped({ direction: 'in' })]
    const report = buildAssistReport(header(), lines, [])
    expect(report.items.map((i) => i.id)).toContain('balanced')
    expect(report.critical).toBe(0)
  })

  it('reports how far the serial mapping has got', () => {
    const lines = [mapped({ track_serial: true, qty: '3' })]
    const report = buildAssistReport(header(), lines, [])
    expect(report.items.find((i) => i.id === 'serials-progress')?.title).toBe('0 of 3 serial numbers mapped.')
  })

  it('writes the headline the header strip shows', () => {
    expect(assistHeadline(2, 0, 3)).toBe('We found 2 potential issues and 3 suggestions.')
    expect(assistHeadline(0, 1, 0)).toBe('We found 1 potential issue.')
    expect(assistHeadline(0, 0, 1)).toBe('We found 1 suggestion.')
    expect(assistHeadline(0, 0, 0)).toBe('Nothing to flag on this document yet.')
  })
})
