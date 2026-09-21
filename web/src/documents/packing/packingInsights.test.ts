import { describe, expect, it } from 'vitest'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft } from '../formModel'
import { specForCode } from '../registry'
import { computePackingInsights } from './packingInsights'

const spec = specForCode('PACKING')!

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 1, ...patch }
}

function ok(overrides: Partial<AvailabilityCheckResult> = {}): AvailabilityCheckResult {
  return { index: 0, item_id: 1, requested: 5, available: 10, on_hand: 10, ok: true, ...overrides }
}

describe('computePackingInsights', () => {
  it('reports nothing to check and "not ready" with no lines', () => {
    const out = computePackingInsights({ header: header(), lines: [], spec, availability: {}, checking: false })
    expect(out.readiness.state).toBe('not_ready')
    expect(out.insights).toEqual([{ key: 'empty', tone: 'info', message: 'Add items to see packing insights.' }])
    expect(out.tip).toBeNull()
  })

  it('is ready to dispatch when stock is sufficient, no picks are pending and box info is filled in', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '5' })
    const h = header({ metadata: { package_info: { boxes: 2, dimensions_cm: '40 x 30 x 20' } } })
    const out = computePackingInsights({ header: h, lines: [line], spec, availability: { [line.key]: ok() }, checking: false })
    expect(out.readiness.state).toBe('ready_to_dispatch')
    expect(out.insights).toContainEqual({ key: 'stock-ok', tone: 'success', message: 'All items have sufficient stock.' })
    expect(out.insights).toContainEqual({ key: 'no-dupes', tone: 'success', message: 'No duplicate items found.' })
    expect(out.tip).toBeNull()
  })

  it('drops to "ready to pack" and tips about dimensions when box info is missing', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '5' })
    const out = computePackingInsights({ header: header(), lines: [line], spec, availability: { [line.key]: ok() }, checking: false })
    expect(out.readiness.state).toBe('ready_to_pack')
    expect(out.tip).toMatch(/box dimensions/i)
  })

  it('flags insufficient stock as not ready, with the short line named', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '5' })
    const short = ok({ ok: false, available: 2, short_by: 3 })
    const out = computePackingInsights({ header: header(), lines: [line], spec, availability: { [line.key]: short }, checking: false })
    expect(out.readiness.state).toBe('not_ready')
    expect(out.insights).toContainEqual({ key: 'stock-short', tone: 'danger', message: '1 line has insufficient stock at the selected warehouse.' })
  })

  it('detects duplicate items on the same warehouse', () => {
    const a = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '5' })
    const b = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '2' })
    const out = computePackingInsights({
      header: header(),
      lines: [a, b],
      spec,
      availability: { [a.key]: ok(), [b.key]: ok({ requested: 2 }) },
      checking: false,
    })
    expect(out.insights).toContainEqual({ key: 'dupes', tone: 'warning', message: 'Widget appears on more than one line for the same warehouse.' })
    expect(out.insights.some((i) => i.key === 'no-dupes')).toBe(false)
  })

  it('does not flag the same item across two different warehouses as a duplicate', () => {
    const a = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 1, qty: '5' })
    const b = newLine(spec, { item_id: 1, item_name: 'Widget', warehouse_id: 2, qty: '2' })
    const out = computePackingInsights({
      header: header(),
      lines: [a, b],
      spec,
      availability: { [a.key]: ok(), [b.key]: ok({ requested: 2 }) },
      checking: false,
    })
    expect(out.insights).toContainEqual({ key: 'no-dupes', tone: 'success', message: 'No duplicate items found.' })
  })

  it('is not ready while serial numbers are still short of the line quantity (the server would reject it too)', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Scanner', warehouse_id: 1, qty: '3', track_serial: true, serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const out = computePackingInsights({ header: header(), lines: [line], spec, availability: { [line.key]: ok({ requested: 3 }) }, checking: false })
    expect(out.readiness.state).toBe('not_ready')
    expect(out.insights).toContainEqual({ key: 'serials-pending', tone: 'warning', message: '1 line still needs serial numbers picked.' })
  })

  it('needs attention (not yet not-ready) before any serial has been picked at all', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Scanner', warehouse_id: 1, qty: '3', track_serial: true, serials: [] })
    const out = computePackingInsights({ header: header(), lines: [line], spec, availability: { [line.key]: ok({ requested: 3 }) }, checking: false })
    expect(out.readiness.state).toBe('needs_attention')
    expect(out.insights).toContainEqual({ key: 'serials-pending', tone: 'warning', message: '1 line still needs serial numbers picked.' })
  })

  it('is satisfied once every required serial is picked', () => {
    const line = newLine(spec, {
      item_id: 1,
      item_name: 'Scanner',
      warehouse_id: 1,
      qty: '2',
      track_serial: true,
      serials: [
        { serial_id: 1, serial_no: 'SN-1' },
        { serial_id: 2, serial_no: 'SN-2' },
      ],
    })
    const h = header({ metadata: { package_info: { boxes: 1, dimensions_cm: '10x10x10' } } })
    const out = computePackingInsights({ header: h, lines: [line], spec, availability: { [line.key]: ok({ requested: 2 }) }, checking: false })
    expect(out.insights).toContainEqual({ key: 'serials-ok', tone: 'success', message: 'Serial requirements satisfied.' })
    expect(out.readiness.state).toBe('ready_to_dispatch')
  })

  it('flags a batch-tracked line with no batch chosen', () => {
    const line = newLine(spec, { item_id: 1, item_name: 'Cream', warehouse_id: 1, qty: '5', track_batch: true, batch_id: null })
    const out = computePackingInsights({ header: header(), lines: [line], spec, availability: { [line.key]: ok() }, checking: false })
    expect(out.insights).toContainEqual({ key: 'batch-pending', tone: 'warning', message: '1 line still needs a batch selected.' })
    expect(out.readiness.state).toBe('needs_attention')
  })
})
