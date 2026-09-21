import { describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import { validateMaterialIssue } from './validation'

const SPEC = specForCode('MATERIAL_ISSUE')!
const units = [{ unit_id: 1, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }]
const FY = { from: '2026-04-01', to: '2027-03-31' }

function header(patch: Record<string, unknown> = {}) {
  return { ...newHeader(SPEC, '2026-09-18'), default_warehouse_id: 1, reason_code: 'PRODUCTION', ...patch }
}

function goodLine(patch: Record<string, unknown> = {}) {
  return newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 1, ...patch })
}

describe('validateMaterialIssue', () => {
  it('passes a complete issue', () => {
    const v = validateMaterialIssue(header(), [goodLine()], { requireReason: true, fyRange: FY })
    expect(v.ok).toBe(true)
    expect(v.messages).toEqual([])
  })

  it('needs a reason code to post but not to save a draft', () => {
    const h = header({ reason_code: '' })
    expect(validateMaterialIssue(h, [goodLine()], { requireReason: false }).ok).toBe(true)
    const post = validateMaterialIssue(h, [goodLine()], { requireReason: true })
    expect(post.ok).toBe(false)
    expect(post.fieldErrors.reason_code).toContain('required to post')
  })

  it('places the message on the field it belongs to', () => {
    const v = validateMaterialIssue(header({ document_date: '', default_warehouse_id: null }), [], { requireReason: false })
    expect(Object.keys(v.fieldErrors).sort()).toEqual(['default_warehouse_id', 'document_date', 'lines'])
  })

  it('holds the date inside the open financial year', () => {
    const early = validateMaterialIssue(header({ document_date: '2026-03-31' }), [goodLine()], { requireReason: false, fyRange: FY })
    expect(early.fieldErrors.document_date).toContain('outside the open financial year')
    const inside = validateMaterialIssue(header({ document_date: '2026-04-01' }), [goodLine()], { requireReason: false, fyRange: FY })
    expect(inside.fieldErrors.document_date).toBeUndefined()
  })

  it('skips the range check when the financial year is not known yet', () => {
    const v = validateMaterialIssue(header({ document_date: '2020-01-01' }), [goodLine()], { requireReason: false, fyRange: { from: '', to: '' } })
    expect(v.fieldErrors.document_date).toBeUndefined()
  })

  it('reports line problems against the line key', () => {
    const noItem = newLine(SPEC, { qty: '1' })
    const noQty = goodLine({ qty: '0' })
    const noBatch = goodLine({ track_batch: true })
    const wrongSerials = goodLine({ track_serial: true, serials: [{ serial_id: 1, serial_no: 'SN1' }] })
    const v = validateMaterialIssue(header(), [noItem, noQty, noBatch, wrongSerials], { requireReason: true })
    expect(v.lineErrors[noItem.key]).toBe('Pick an item.')
    expect(v.lineErrors[noQty.key]).toContain('greater than zero')
    expect(v.lineErrors[noBatch.key]).toContain('batch-tracked')
    expect(v.lineErrors[wrongSerials.key]).toContain('Pick 2 serial numbers')
  })

  it('ignores blank lines but refuses a document made only of them', () => {
    const v = validateMaterialIssue(header(), [newLine(SPEC), newLine(SPEC)], { requireReason: false })
    expect(v.fieldErrors.lines).toContain('at least one item')
    expect(Object.keys(v.lineErrors)).toEqual([])
  })

  it('accepts a line with no warehouse when the header supplies one', () => {
    const v = validateMaterialIssue(header(), [goodLine({ warehouse_id: null })], { requireReason: true })
    expect(v.ok).toBe(true)
  })

  it('refuses a line with no warehouse anywhere', () => {
    const line = goodLine({ warehouse_id: null })
    const v = validateMaterialIssue(header({ default_warehouse_id: null }), [line], { requireReason: false })
    expect(v.lineErrors[line.key]).toContain('warehouse')
  })
})
