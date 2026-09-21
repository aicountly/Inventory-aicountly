import { describe, expect, it } from 'vitest'
import { newHeader } from '../formModel'
import { specForCode } from '../registry'
import { buildInsights } from './insights'
import type { InsightInput } from './insights'
import { newComponentLine, newFinishedLine } from './model'

const spec = specForCode('DISASSEMBLY')!

function input(patch: Partial<InsightInput> = {}): InsightInput {
  return {
    draft: {
      header: { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 3 },
      finished: [newFinishedLine(spec, { key: 'f1', item_id: 1, item_name: 'Laptop', qty: '1', unit_id: 9, warehouse_id: 3 })],
      components: [newComponentLine(spec, { key: 'c1', item_id: 2, item_name: 'Motherboard', qty: '1', unit_id: 9, warehouse_id: 3, valuation_rate: '8500' })],
    },
    availability: { f1: { index: 0, item_id: 1, requested: 1, available: 12, on_hand: 12, ok: true } },
    checkingAvailability: false,
    bomName: null,
    bomsForParent: 0,
    costsLoading: false,
    itemsWithoutCost: 0,
    ...patch,
  }
}

function textOf(inp: InsightInput, id: string): string {
  return buildInsights(inp).find((i) => i.id === id)?.text ?? ''
}

describe('buildInsights', () => {
  it('reports availability from the check that actually ran', () => {
    expect(textOf(input(), 'availability')).toContain('Stock confirmed')
    const short = input({ availability: { f1: { index: 0, item_id: 1, requested: 5, available: 2, on_hand: 2, ok: false, short_by: 3 } } })
    expect(textOf(short, 'availability')).toContain('short by 3')
    expect(buildInsights(short).find((i) => i.id === 'availability')?.tone).toBe('risk')
  })

  it('never claims a check it has not made', () => {
    const fresh = input({ draft: { ...input().draft, finished: [newFinishedLine(spec)] }, availability: {} })
    expect(textOf(fresh, 'availability')).toContain('Pick the finished product')
  })

  it('says whether a bill of materials exists for this item', () => {
    expect(textOf(input({ bomsForParent: 2 }), 'bom')).toContain('2 bills of materials found')
    expect(textOf(input({ bomsForParent: 0 }), 'bom')).toContain('No bill of materials')
    expect(textOf(input({ bomName: 'Laptop Pro build' }), 'bom')).toContain('Laptop Pro build')
  })

  it('only reports batch health for batch-controlled items', () => {
    expect(textOf(input(), 'batch')).toContain('No batch-controlled item')
    const tracked = input()
    tracked.draft.finished[0].track_batch = true
    expect(textOf(tracked, 'batch')).toContain('no batch selected')
    tracked.draft.finished[0].batch_id = 5
    expect(textOf(tracked, 'batch')).toContain('No batch shortages')
  })

  it('checks serial counts against the quantity', () => {
    const serial = input()
    serial.draft.finished[0].track_serial = true
    serial.draft.finished[0].qty = '2'
    expect(textOf(serial, 'serial')).toContain('still need')
    serial.draft.finished[0].serials = [
      { serial_id: 1, serial_no: 'A' },
      { serial_id: 2, serial_no: 'B' },
    ]
    expect(textOf(serial, 'serial')).toContain('match the quantity')
  })

  it('counts the components that carry no cost', () => {
    const uncosted = input()
    uncosted.draft.components[0].valuation_rate = ''
    expect(textOf(uncosted, 'cost')).toContain('1 component has no unit cost')
  })
})
