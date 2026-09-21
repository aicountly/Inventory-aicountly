import { describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import {
  blockingSummary,
  issuesByField,
  readExtras,
  receiptTotals,
  validateReceipt,
  writeExtras,
} from './receiptModel'

/*
 * The rules a receipt is held to, away from the screen that shows them.
 *
 * Two of them are stricter than the server on purpose — a line with no
 * warehouse and a batch-tracked item with no batch both post happily today and
 * leave stock nobody can find — so the tests below also pin the other half of
 * that bargain: neither rule is applied while the user is only saving a draft.
 */

const spec = specForCode('MATERIAL_RECEIPT') as DocumentTypeSpec

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 3, ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { item_id: 11, item_name: 'Cement OPC 53', warehouse_id: 3, qty: '10', rate: '420', amount: '4200', ...patch })
}

describe('receipt extras', () => {
  it('round-trips the gate details through the document metadata', () => {
    const stored = writeExtras({}, { transporter_name: ' Blue Dart ', gate_entry_no: 'GE-1', vehicle_no: 'MH12AB3456', quality_checked: true })
    expect(stored).toEqual({ transporter_name: 'Blue Dart', gate_entry_no: 'GE-1', vehicle_no: 'MH12AB3456', quality_checked: true })
    expect(readExtras(stored)).toEqual({ transporter_name: 'Blue Dart', gate_entry_no: 'GE-1', vehicle_no: 'MH12AB3456', quality_checked: true })
  })

  it('stores nothing for a field that was left blank', () => {
    const stored = writeExtras({ narration_hint: 'kept' }, { transporter_name: '', gate_entry_no: '  ', vehicle_no: '', quality_checked: false })
    expect(stored).toEqual({ narration_hint: 'kept' })
  })

  it('drops the quality flag when it is turned back off', () => {
    const on = writeExtras({}, { transporter_name: '', gate_entry_no: '', vehicle_no: '', quality_checked: true })
    const off = writeExtras(on, { transporter_name: '', gate_entry_no: '', vehicle_no: '', quality_checked: false })
    expect('quality_checked' in off).toBe(false)
  })
})

describe('receipt totals', () => {
  it('adds up the lines and leaves other charges to the landed cost document', () => {
    const totals = receiptTotals([line(), line({ qty: '5', rate: '62.5', amount: '312.5' })], spec)
    expect(totals.lines).toBe(2)
    expect(totals.quantity).toBe(15)
    expect(totals.amount).toBe(4512.5)
    expect(totals.otherCharges).toBe(0)
    expect(totals.net).toBe(4512.5)
  })

  it('ignores the blank row the form always keeps at the end', () => {
    expect(receiptTotals([line(), newLine(spec)], spec).lines).toBe(1)
  })
})

describe('validating a receipt', () => {
  it('will not post a receipt with no items on it', () => {
    const result = validateReceipt(header(), [newLine(spec)], { forPost: true })
    expect(result.ok).toBe(false)
    expect(result.header.map((i) => i.message)).toContain('Add at least one item to receive.')
  })

  it('needs a date, whichever button was pressed', () => {
    for (const forPost of [true, false]) {
      const result = validateReceipt(header({ document_date: '' }), [line()], { forPost })
      expect(result.header.some((i) => i.field === 'document_date' && i.level === 'error')).toBe(true)
    }
  })

  it('asks for an item and a quantity on every line that carries anything', () => {
    const result = validateReceipt(header(), [line({ item_id: null, item_name: '' }), line({ qty: '0' })], { forPost: false })
    expect(result.lines.filter((i) => i.field === 'item' && i.level === 'error')).toHaveLength(1)
    expect(result.lines.filter((i) => i.field === 'qty' && i.level === 'error')).toHaveLength(1)
  })

  it('refuses to post stock into no warehouse at all', () => {
    const draft = [line({ warehouse_id: null })]
    const posting = validateReceipt(header({ default_warehouse_id: null }), draft, { forPost: true })
    expect(posting.lines.some((i) => i.field === 'warehouse' && i.level === 'error')).toBe(true)

    const saving = validateReceipt(header({ default_warehouse_id: null }), draft, { forPost: false })
    expect(saving.lines.some((i) => i.field === 'warehouse')).toBe(false)
  })

  it('does not ask for a warehouse the user has none of', () => {
    const result = validateReceipt(header({ default_warehouse_id: null }), [line({ warehouse_id: null })], { forPost: true, hasWarehouses: false })
    expect(result.lines.some((i) => i.field === 'warehouse')).toBe(false)
  })

  it('refuses to post a batch-tracked item into no batch, but still saves the draft', () => {
    const draft = [line({ track_batch: true })]
    expect(validateReceipt(header(), draft, { forPost: true }).lines.some((i) => i.field === 'batch' && i.level === 'error')).toBe(true)
    expect(validateReceipt(header(), draft, { forPost: false }).lines.some((i) => i.field === 'batch')).toBe(false)
  })

  it('warns — never blocks — when a receipt line carries no cost', () => {
    const result = validateReceipt(header(), [line({ rate: '', amount: '' })], { forPost: true })
    const issue = result.lines.find((i) => i.field === 'rate')
    expect(issue?.level).toBe('warning')
    expect(result.ok).toBe(true)
  })

  it('counts serial numbers against the base quantity on a draft as well', () => {
    const draft = [
      line({
        track_serial: true,
        qty: '3',
        serials: [
          { serial_id: 1, serial_no: 'SN1' },
          { serial_id: 2, serial_no: 'SN2' },
        ],
      }),
    ]
    for (const forPost of [true, false]) {
      const result = validateReceipt(header(), draft, { forPost })
      expect(result.lines.some((i) => i.field === 'serials' && i.level === 'error')).toBe(true)
    }
  })

  it('points out the same item arriving twice into the same bucket', () => {
    const result = validateReceipt(header(), [line(), line()], { forPost: true })
    const duplicate = result.lines.find((i) => i.field === 'item' && i.level === 'warning')
    expect(duplicate?.message).toContain('line 1')
    expect(result.ok).toBe(true)
  })

  it('rejects a ledger id that is not a number a ledger could have', () => {
    const result = validateReceipt(header({ party_ref: '0' }), [line()], { forPost: false })
    expect(result.header.some((i) => i.field === 'party_ref')).toBe(true)
  })

  it('names the first thing to fix for the action bar', () => {
    const empty = validateReceipt(header(), [newLine(spec)], { forPost: true })
    expect(blockingSummary(empty)).toBe('Add at least one item to receive.')

    const lineProblem = validateReceipt(header(), [line({ qty: '' })], { forPost: true })
    expect(blockingSummary(lineProblem)).toBe('Line 1: Quantity must be more than zero.')

    expect(blockingSummary(validateReceipt(header(), [line()], { forPost: true }))).toBeNull()
  })

  it('indexes a line’s issues by the field they belong on', () => {
    const bad = line({ item_id: null, item_name: '', qty: '0' })
    const result = validateReceipt(header(), [bad], { forPost: true })
    const byField = issuesByField(result.lines, bad.key)
    expect(byField.item?.level).toBe('error')
    expect(byField.qty?.level).toBe('error')
  })
})
