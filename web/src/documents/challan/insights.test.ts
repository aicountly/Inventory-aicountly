import { describe, expect, it } from 'vitest'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import type { PartyContext } from '../../services/partyApi'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import { EMPTY_TRANSPORT } from './challanMeta'
import type { InsightInput } from './insights'
import { blockingInsights, buildInsights, daysUntil, duplicateLineKeys } from './insights'

const spec = specForCode('DELIVERY_CHALLAN')!
const TODAY = '2026-09-18'

function header(patch: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(spec, TODAY), party_name: 'Acme Ltd', party_ref: '1042', default_warehouse_id: 1, ...patch }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { item_id: 10, item_name: 'Laptop', qty: '5', warehouse_id: 1, ...patch })
}

function input(patch: Partial<InsightInput> = {}): InsightInput {
  return {
    header: header(),
    lines: [line()],
    availability: {},
    checking: false,
    batchFacts: {},
    transport: EMPTY_TRANSPORT,
    party: null,
    today: TODAY,
    ...patch,
  }
}

function ok(key: string, available = 12): Record<string, AvailabilityCheckResult> {
  return { [key]: { index: 0, item_id: 10, requested: 5, available, on_hand: available, ok: true } }
}

function short(key: string, available = 4): Record<string, AvailabilityCheckResult> {
  return { [key]: { index: 0, item_id: 10, requested: 5, available, on_hand: available, ok: false, short_by: 5 - available } }
}

function ids(result: ReturnType<typeof buildInsights>): string[] {
  return result.map((i) => i.id)
}

describe('daysUntil', () => {
  it('measures whole days either side of today', () => {
    expect(daysUntil('2026-09-18', TODAY)).toBe(0)
    expect(daysUntil('2026-09-28', TODAY)).toBe(10)
    expect(daysUntil('2026-09-01', TODAY)).toBe(-17)
  })

  it('is null for anything that is not a plain date', () => {
    expect(daysUntil(null, TODAY)).toBeNull()
    expect(daysUntil('', TODAY)).toBeNull()
    expect(daysUntil('soon', TODAY)).toBeNull()
  })
})

describe('duplicateLineKeys', () => {
  it('finds lines with the same item, warehouse and batch', () => {
    const a = line({ item_id: 10 })
    const b = line({ item_id: 10 })
    const c = line({ item_id: 11 })
    expect(duplicateLineKeys([a, b, c], 1).sort()).toEqual([a.key, b.key].sort())
  })

  it('does not treat two warehouses as a duplicate', () => {
    expect(duplicateLineKeys([line({ warehouse_id: 1 }), line({ warehouse_id: 2 })], 1)).toEqual([])
  })

  it('falls back to the header default when a line names no warehouse', () => {
    const a = line({ warehouse_id: null })
    const b = line({ warehouse_id: 1 })
    expect(duplicateLineKeys([a, b], 1)).toHaveLength(2)
  })
})

describe('buildInsights', () => {
  it('asks for a customer and for lines when the challan is empty', () => {
    const result = buildInsights(input({ header: header({ party_name: '', party_ref: '' }), lines: [] }))
    expect(ids(result)).toEqual(expect.arrayContaining(['no-lines', 'no-customer']))
    expect(blockingInsights(result).length).toBeGreaterThan(0)
  })

  it('warns when a customer name carries no ledger id', () => {
    const result = buildInsights(input({ header: header({ party_ref: '' }) }))
    expect(ids(result)).toContain('no-ledger')
    expect(ids(result)).not.toContain('no-customer')
  })

  it('confirms stock only once every line has been checked', () => {
    const l = line()
    expect(ids(buildInsights(input({ lines: [l], availability: ok(l.key) })))).toContain('stock-ok')
    expect(ids(buildInsights(input({ lines: [l], availability: {} })))).not.toContain('stock-ok')
    expect(ids(buildInsights(input({ lines: [l], availability: ok(l.key), checking: true })))).not.toContain('stock-ok')
  })

  it('reports a shortfall against the line it belongs to', () => {
    const l = line()
    const result = buildInsights(input({ lines: [l], availability: short(l.key) }))
    const shortfall = result.find((i) => i.id === 'short-stock')
    expect(shortfall?.lineKeys).toEqual([l.key])
    expect(shortfall?.message).toContain('short by 1')
  })

  it('is stricter about a shortfall when the challan moves stock now', () => {
    const l = line()
    const pending = buildInsights(input({ lines: [l], availability: short(l.key) })).find((i) => i.id === 'short-stock')
    const physical = buildInsights(input({ header: header({ stock_effect: 'physical' }), lines: [l], availability: short(l.key) })).find((i) => i.id === 'short-stock')
    expect(pending?.tone).toBe('warning')
    expect(physical?.tone).toBe('danger')
  })

  it('blocks when a serial-tracked line is not fully serialised', () => {
    const l = line({ track_serial: true, qty: '2', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const result = buildInsights(input({ lines: [l] }))
    const serials = result.find((i) => i.id === 'serials')
    expect(serials?.blocking).toBe(true)
    expect(serials?.message).toContain('1 of 2')
  })

  it('says nothing about serials when the line is complete', () => {
    const l = line({ track_serial: true, qty: '1', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    expect(ids(buildInsights(input({ lines: [l] })))).not.toContain('serials')
  })

  it('flags an expired batch and, separately, one close to expiry', () => {
    const l = line()
    const expired = buildInsights(input({ lines: [l], batchFacts: { [l.key]: { batch_no: 'B1', expiry_date: '2026-09-01', available: 5 } } }))
    expect(ids(expired)).toContain('batch-expired')
    const near = buildInsights(input({ lines: [l], batchFacts: { [l.key]: { batch_no: 'B1', expiry_date: '2026-10-01', available: 5 } } }))
    expect(ids(near)).toContain('batch-near-expiry')
    expect(ids(near)).not.toContain('batch-expired')
  })

  it('asks for a return date only when the goods are expected back', () => {
    expect(ids(buildInsights(input({ header: header({ returnable: true }) })))).toContain('return-date')
    expect(ids(buildInsights(input({ header: header({ returnable: true, expected_return_date: '2026-10-10' }) })))).not.toContain('return-date')
    expect(ids(buildInsights(input()))).not.toContain('return-date')
  })

  it('mentions transport only while there is something to dispatch', () => {
    expect(ids(buildInsights(input()))).toContain('transport')
    expect(ids(buildInsights(input({ transport: { ...EMPTY_TRANSPORT, vehicle_no: 'MH12AB1234' } })))).not.toContain('transport')
    expect(ids(buildInsights(input({ lines: [] })))).not.toContain('transport')
  })

  it('reports the customer’s open challans only when the API answered with some', () => {
    const party: PartyContext = {
      party_ref: 1042,
      open_challan_qty: 45,
      open_challan_lines: 3,
      open_challan_documents: 2,
      documents_on_record: 12,
      last_document_date: '2026-09-01',
      last_document_no: 'DC-1',
      last_document_type: 'Delivery Challan / Dispatch',
      commercial_available: false,
    }
    expect(buildInsights(input({ party })).find((i) => i.id === 'party-open')?.message).toContain('2 earlier challans')
    expect(ids(buildInsights(input({ party: null })))).not.toContain('party-open')
    expect(ids(buildInsights(input({ party: { ...party, open_challan_documents: 0 } })))).not.toContain('party-open')
  })

  it('always explains what posting will do, in the selected mode', () => {
    expect(buildInsights(input()).find((i) => i.id === 'effect')?.message).toContain('pending quantity only')
    expect(buildInsights(input({ header: header({ stock_effect: 'physical' }) })).find((i) => i.id === 'effect')?.message).toContain('moves the stock out now')
  })

  it('notices lines dispatching from more than one warehouse', () => {
    const result = buildInsights(input({ lines: [line({ warehouse_id: 1 }), line({ item_id: 11, warehouse_id: 2 })] }))
    expect(ids(result)).toContain('mixed-warehouse')
  })
})
