import { describe, expect, it } from 'vitest'
import { newHeader, newLine, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import { validateJobWorkOutward } from './jobWorkValidation'

const SPEC = specForCode('JOB_WORK_OUT')!

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(SPEC, '2026-09-18'), returnable: true, party_ref: '501', default_warehouse_id: 3, ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, { item_id: 90, qty: '10', warehouse_id: 3, ...patch })
}

describe('validateJobWorkOutward', () => {
  it('passes a complete dispatch', () => {
    const result = validateJobWorkOutward(header(), [line()])
    expect(result.ok).toBe(true)
    expect(result.firstSection).toBeNull()
    expect(result.header).toEqual({})
    expect(result.lines).toEqual({})
  })

  it('names the job worker, the warehouse and the date', () => {
    const result = validateJobWorkOutward(
      header({ party_ref: '', default_warehouse_id: null, document_date: '' }),
      [line()],
    )
    expect(result.ok).toBe(false)
    expect(result.header.party_ref).toBeTruthy()
    expect(result.header.default_warehouse_id).toBeTruthy()
    expect(result.header.document_date).toBeTruthy()
    expect(result.firstSection).toBe('document')
  })

  it('requires at least one line, and points at the lines', () => {
    const result = validateJobWorkOutward(header(), [newLine(SPEC)])
    expect(result.ok).toBe(false)
    expect(result.header.lines).toBeTruthy()
    expect(result.firstSection).toBe('lines')
  })

  it('flags the field on the line that is wrong', () => {
    const bad = line({ item_id: null, qty: '0' })
    const result = validateJobWorkOutward(header(), [bad])
    expect(result.lines[bad.key]).toEqual({ item: true, qty: true })
    expect(result.firstSection).toBe('lines')
  })

  it('flags a serial count that does not match the quantity', () => {
    const bad = line({ qty: '3', track_serial: true, serials: [{ serial_id: 1, serial_no: 'A' }] })
    const result = validateJobWorkOutward(header(), [bad])
    expect(result.lines[bad.key]?.serials).toBe(true)
  })

  it('accepts a line that leans on the header warehouse', () => {
    const result = validateJobWorkOutward(header({ default_warehouse_id: 7 }), [line({ warehouse_id: null })])
    expect(result.ok).toBe(true)
  })

  /**
   * An edited draft can carry a return date that has since passed, and refusing the save would
   * push the user to erase what was actually agreed with the job worker just to get it out.
   */
  it('warns about a return date before the document date without blocking', () => {
    const result = validateJobWorkOutward(header({ expected_return_date: '2026-09-01' }), [line()])
    expect(result.warnings.expected_return_date).toBeTruthy()
    expect(result.header.expected_return_date).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it('blocks a return date that is not a date at all', () => {
    const result = validateJobWorkOutward(header({ expected_return_date: 'next week' }), [line()])
    expect(result.header.expected_return_date).toBeTruthy()
    expect(result.ok).toBe(false)
  })

  /**
   * The server is the authority (DocumentService refuses with 422). This screen only says WHERE
   * each problem is, so it must never let through a draft the shared validator would stop.
   */
  it('never passes a draft that validateDraft would reject', () => {
    const cases: [HeaderDraft, LineDraft[]][] = [
      [header({ party_ref: '' }), [line()]],
      [header({ document_date: '' }), [line()]],
      [header(), [newLine(SPEC)]],
      [header(), [line({ item_id: null })]],
      [header(), [line({ qty: '0' })]],
      [header(), [line({ qty: '3', track_serial: true, serials: [{ serial_id: 1, serial_no: 'A' }] })]],
    ]
    for (const [h, ls] of cases) {
      const mine = validateJobWorkOutward(h, ls)
      const shared = validateDraft(h, ls, SPEC)
      if (shared.length > 0) expect(mine.ok, `shared validator said: ${shared.join(' / ')}`).toBe(false)
    }
  })
})
