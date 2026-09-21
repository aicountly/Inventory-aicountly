import { describe, expect, it } from 'vitest'
import { newHeader } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import { newComponentLine, newFinishedLine } from './model'
import type { DisassemblyDraft } from './model'
import { errorsOf, fieldErrors, headerErrors, validateDisassembly, warningsOf } from './validation'
import type { ValidationInput } from './validation'

const spec = specForCode('DISASSEMBLY')!

function draft(patch: Partial<DisassemblyDraft> = {}): DisassemblyDraft {
  return {
    header: { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 3 },
    finished: [newFinishedLine(spec, { key: 'f1', item_id: 1, item_name: 'Laptop', qty: '1', unit_id: 9, warehouse_id: 3 })],
    components: [newComponentLine(spec, { key: 'c1', item_id: 2, item_name: 'Motherboard', qty: '1', unit_id: 9, warehouse_id: 3, valuation_rate: '8500' })],
    ...patch,
  }
}

function input(patch: Partial<ValidationInput> = {}): ValidationInput {
  return {
    draft: draft(),
    availability: {},
    negativeStockPolicy: 'block',
    canOverrideNegative: false,
    overrideNegative: false,
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    lockedUpto: null,
    allowedWarehouseIds: [],
    ...patch,
  }
}

function messages(inp: ValidationInput): string[] {
  return validateDisassembly(inp).map((i) => i.message)
}

describe('validateDisassembly', () => {
  it('passes a complete document', () => {
    expect(errorsOf(validateDisassembly(input()))).toEqual([])
  })

  it('needs a date inside the selected financial year', () => {
    const d = draft()
    d.header.document_date = '2025-01-01'
    expect(messages(input({ draft: d })).join(' ')).toContain('outside the selected financial year')
  })

  it('refuses a date inside a locked period', () => {
    expect(messages(input({ lockedUpto: '2026-09-30' })).join(' ')).toContain('is locked')
  })

  it('needs a default warehouse', () => {
    const d = draft()
    d.header.default_warehouse_id = null
    expect(headerErrors(validateDisassembly(input({ draft: d }))).has('default_warehouse_id')).toBe(true)
  })

  it('needs a finished product and at least one component', () => {
    const empty = draft({ finished: [newFinishedLine(spec)], components: [newComponentLine(spec)] })
    const msgs = messages(input({ draft: empty }))
    expect(msgs).toContain('Pick the finished product you want to disassemble.')
    expect(msgs).toContain('Add at least one component this product breaks into.')
  })

  it('needs a positive quantity on both sides', () => {
    const d = draft()
    d.finished[0].qty = '0'
    d.components[0].qty = '-1'
    const msgs = messages(input({ draft: d })).join(' ')
    expect(msgs).toContain('quantity to disassemble must be greater than zero')
    expect(msgs).toContain('quantity produced must be greater than zero')
  })

  it('requires the batch of a batch-controlled finished product', () => {
    const d = draft()
    d.finished[0].track_batch = true
    expect(messages(input({ draft: d })).join(' ')).toContain('pick the batch being disassembled')
  })

  it('lets a produced component take a new batch automatically', () => {
    const d = draft()
    d.components[0].track_batch = true
    expect(errorsOf(validateDisassembly(input({ draft: d })))).toEqual([])
  })

  it('requires a serial number for every unit being disassembled', () => {
    const d = draft()
    d.finished[0].track_serial = true
    d.finished[0].qty = '3'
    expect(messages(input({ draft: d })).join(' ')).toContain('pick the 3 serial number(s)')
    d.finished[0].serials = [{ serial_id: 1, serial_no: 'A' }]
    expect(messages(input({ draft: d })).join(' ')).toContain('1 serial number(s) picked for a quantity of 3')
  })

  it('rejects the same serial number twice', () => {
    const d = draft()
    d.finished[0].track_serial = true
    d.finished[0].serials = [
      { serial_id: 1, serial_no: 'A' },
      { serial_id: 1, serial_no: 'A' },
    ]
    expect(messages(input({ draft: d })).join(' ')).toContain('selected twice')
  })

  it('blocks a shortfall only when the company blocks negative stock', () => {
    const availability = { f1: { index: 0, item_id: 1, requested: 1, available: 0, on_hand: 0, ok: false, short_by: 1 } }
    const blocked = validateDisassembly(input({ availability }))
    expect(errorsOf(blocked).some((i) => i.message.includes('short by'))).toBe(true)

    const allowed = validateDisassembly(input({ availability, negativeStockPolicy: 'allow' }))
    expect(errorsOf(allowed)).toEqual([])
    expect(warningsOf(allowed).some((i) => i.message.includes('short by'))).toBe(true)
  })

  it('lets a user with the override permission post through a shortfall', () => {
    const availability = { f1: { index: 0, item_id: 1, requested: 1, available: 0, on_hand: 0, ok: false, short_by: 1 } }
    const overridden = validateDisassembly(input({ availability, canOverrideNegative: true, overrideNegative: true }))
    expect(errorsOf(overridden)).toEqual([])
  })

  it('refuses a warehouse the profile cannot post to', () => {
    expect(messages(input({ allowedWarehouseIds: [4] })).join(' ')).toContain('cannot post to that warehouse')
  })

  it('warns, rather than blocks, when a component has no cost', () => {
    const d = draft()
    d.components[0].valuation_rate = ''
    const issues = validateDisassembly(input({ draft: d }))
    expect(errorsOf(issues)).toEqual([])
    expect(warningsOf(issues).some((i) => i.message.includes('no unit cost'))).toBe(true)
  })

  it('keys messages by row and field so a control can render its own', () => {
    const d = draft()
    d.components[0].warehouse_id = null
    const byField = fieldErrors(validateDisassembly(input({ draft: d })))
    expect(byField.get('c1:warehouse')?.severity).toBe('error')
  })
})

describe('narration', () => {
  it('is capped at 500 characters', () => {
    const d = draft()
    d.header.narration = 'x'.repeat(501)
    expect(headerErrors(validateDisassembly(input({ draft: d }))).has('narration')).toBe(true)
  })
})

describe('duplicate components', () => {
  it('warns without blocking', () => {
    const dup: LineDraft = newComponentLine(spec, { key: 'c2', item_id: 2, item_name: 'Motherboard', qty: '1', unit_id: 9, warehouse_id: 3, valuation_rate: '8500' })
    const d = draft()
    d.components.push(dup)
    const issues = validateDisassembly(input({ draft: d }))
    expect(errorsOf(issues)).toEqual([])
    expect(warningsOf(issues).some((i) => i.message.includes('more than one row'))).toBe(true)
  })
})
