import { describe, expect, it } from 'vitest'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import { assistantSuggestions } from './assistant'

const SPEC = specForCode('MATERIAL_ISSUE')!
const units = [{ unit_id: 1, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }]
const warehouseName = (id: number | null | undefined) => (id ? `WH-${id}` : '')

function header(patch: Record<string, unknown> = {}) {
  return { ...newHeader(SPEC, '2026-09-18'), default_warehouse_id: 1, reason_code: 'PRODUCTION', ...patch }
}

function avail(partial: Partial<AvailabilityCheckResult>): AvailabilityCheckResult {
  return { index: 0, item_id: 1, requested: 0, available: 0, on_hand: 0, ok: true, ...partial }
}

const ids = (list: { id: string }[]) => list.map((s) => s.id)

describe('assistant suggestions', () => {
  it('offers what the screen can do while nothing is entered', () => {
    const out = assistantSuggestions({ header: header(), lines: [newLine(SPEC)], availability: {}, warehouseName })
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((s) => s.tone === 'info')).toBe(true)
  })

  it('asks for a reason code once there are lines', () => {
    const line = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 1 })
    const out = assistantSuggestions({ header: header({ reason_code: '  ' }), lines: [line], availability: {}, warehouseName })
    expect(ids(out)).toContain('reason')
  })

  it('names a batch-tracked line with no batch and a serial count that does not match', () => {
    const batch = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, track_batch: true })
    const serial = newLine(SPEC, { item_id: 6, item_name: 'Ball Bearing', qty: '3', units, unit_id: 1, track_serial: true, serials: [{ serial_id: 1, serial_no: 'SN1' }] })
    const out = assistantSuggestions({ header: header(), lines: [batch, serial], availability: {}, warehouseName })
    expect(ids(out)).toContain(`batch-${batch.key}`)
    const serialTip = out.find((s) => s.id === `serial-${serial.key}`)
    expect(serialTip?.message).toContain('3 serial numbers')
    expect(serialTip?.message).toContain('1 selected')
  })

  it('says nothing about serials once the count matches the base quantity', () => {
    const line = newLine(SPEC, {
      item_id: 6,
      item_name: 'Ball Bearing',
      qty: '2',
      units,
      unit_id: 1,
      track_serial: true,
      serials: [{ serial_id: 1, serial_no: 'SN1' }, { serial_id: 2, serial_no: 'SN2' }],
    })
    const out = assistantSuggestions({ header: header(), lines: [line], availability: {}, warehouseName })
    expect(ids(out)).not.toContain(`serial-${line.key}`)
  })

  it('flags the same item twice out of the same warehouse and batch', () => {
    const a = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '1', units, unit_id: 1, warehouse_id: 1 })
    const b = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 1 })
    const out = assistantSuggestions({ header: header(), lines: [a, b], availability: {}, warehouseName })
    expect(out.some((s) => s.id.startsWith('dup-'))).toBe(true)
  })

  it('cites the row number the grid draws, blank rows included', () => {
    // The grid numbers every row it renders; counting only the filled ones sent
    // the reader to "line 1" when the item was plainly on line 2.
    const blank = newLine(SPEC)
    const a = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '1', units, unit_id: 1, warehouse_id: 1 })
    const b = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 1 })
    const out = assistantSuggestions({ header: header(), lines: [blank, a, b], availability: {}, warehouseName })
    expect(out.find((s) => s.id.startsWith('dup-'))?.message).toContain('line 2')
  })

  it('leaves the same item in two warehouses alone', () => {
    const a = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '1', units, unit_id: 1, warehouse_id: 1 })
    const b = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 2 })
    const out = assistantSuggestions({ header: header(), lines: [a, b], availability: {}, warehouseName })
    expect(out.some((s) => s.id.startsWith('dup-'))).toBe(false)
  })

  it('warns when a line takes most of the stock and escalates when it is short', () => {
    const heavy = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '9', units, unit_id: 1, warehouse_id: 1 })
    const short = newLine(SPEC, { item_id: 6, item_name: 'Ball Bearing', qty: '20', units, unit_id: 1, warehouse_id: 2 })
    const out = assistantSuggestions({
      header: header(),
      lines: [heavy, short],
      availability: {
        [heavy.key]: avail({ requested: 9, available: 10, ok: true }),
        [short.key]: avail({ requested: 20, available: 5, ok: false, short_by: 15 }),
      },
      warehouseName,
    })
    const heavyTip = out.find((s) => s.id === `heavy-${heavy.key}`)
    expect(heavyTip?.tone).toBe('warning')
    expect(heavyTip?.message).toContain('1 left')
    const shortTip = out.find((s) => s.id === `short-${short.key}`)
    expect(shortTip?.tone).toBe('danger')
    expect(shortTip?.message).toContain('WH-2')
    expect(shortTip?.message).toContain('15')
  })

  it('stays quiet about a comfortable line', () => {
    const line = newLine(SPEC, { item_id: 5, item_name: 'Gear Shaft', qty: '2', units, unit_id: 1, warehouse_id: 1 })
    const out = assistantSuggestions({
      header: header(),
      lines: [line],
      availability: { [line.key]: avail({ requested: 2, available: 100, ok: true }) },
      warehouseName,
    })
    // Nothing to say, so it goes back to the resting tips rather than an empty box.
    expect(out.every((s) => s.tone === 'info')).toBe(true)
  })
})
