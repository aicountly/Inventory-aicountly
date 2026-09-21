import { describe, expect, it } from 'vitest'
import { buildSerialLifecycle, lifecycleChanges } from './serialLifecycle'
import type { SerialHistoryEvent } from '../services/masters'

const NAMES = {
  warehouses: { '12': 'Main Warehouse', '13': 'Delhi Warehouse' },
  locations: { '4': 'R-01-A1' },
  batches: { '7': 'B-MBP-2026' },
}

describe('lifecycleChanges', () => {
  it('reports only the fields a reader came to see', () => {
    // updated_at differs on every single update and would bury the one change
    // that matters.
    const changes = lifecycleChanges(
      { status: 'expected', warehouse_id: 12, updated_at: '2026-09-01 10:00:00', updated_by: 'a' },
      { status: 'in_stock', warehouse_id: 12, updated_at: '2026-09-02 11:00:00', updated_by: 'b' },
      NAMES,
    )
    expect(changes).toEqual([
      { field: 'status', label: 'Status', before: 'Expected', after: 'In stock' },
    ])
  })

  it('resolves an id to the name the screen shows', () => {
    const changes = lifecycleChanges({ warehouse_id: 12 }, { warehouse_id: 13 }, NAMES)
    expect(changes[0]).toEqual({ field: 'warehouse_id', label: 'Warehouse', before: 'Main Warehouse', after: 'Delhi Warehouse' })
  })

  it('falls back to the id rather than pretending it knows the name', () => {
    const changes = lifecycleChanges({ warehouse_id: 99 }, { warehouse_id: 98 }, NAMES)
    expect(changes[0].before).toBe('#99')
    expect(changes[0].after).toBe('#98')
  })

  it('does not report a change when only the type differs', () => {
    expect(lifecycleChanges({ warehouse_id: 12 }, { warehouse_id: '12' }, NAMES)).toEqual([])
  })

  it('writes a cleared value as an em dash, not as "null"', () => {
    const changes = lifecycleChanges({ warranty_until: '2028-04-15' }, { warranty_until: null }, NAMES)
    expect(changes[0]).toEqual({ field: 'warranty_until', label: 'Warranty until', before: '2028-04-15', after: '—' })
  })

  it('has nothing to compare when one side was not recorded', () => {
    expect(lifecycleChanges(null, { status: 'in_stock' }, NAMES)).toEqual([])
  })
})

describe('buildSerialLifecycle', () => {
  const created: SerialHistoryEvent = {
    kind: 'audit',
    ref_id: 1,
    at: '2026-04-02 09:00:00',
    action: 'serial.create',
    actor_uuid: 'user-a',
    source_app: 'inventory',
    reason: null,
    before: null,
    after: { status: 'expected', warehouse_id: 12 },
  }
  const received: SerialHistoryEvent = {
    kind: 'document',
    ref_id: 55,
    at: '2026-04-05',
    document_id: 55,
    document_no: 'MR-0007',
    document_type: 'material_receipt',
    document_status: 'POSTED',
    direction: 'in',
    qty: 1,
    warehouse_name: 'Main Warehouse',
    dest_warehouse_name: null,
    location_code: 'R-01-A1',
  }
  const scrapped: SerialHistoryEvent = {
    kind: 'audit',
    ref_id: 2,
    at: '2026-08-01 15:30:00',
    action: 'serial.update',
    actor_uuid: 'user-b',
    source_app: 'inventory',
    reason: 'Damaged in handling',
    before: { status: 'in_stock', warehouse_id: 12 },
    after: { status: 'scrapped', warehouse_id: 12 },
  }

  it('keeps the order the server merged the two streams in', () => {
    // A browser that re-orders an audit trail is a browser that can disagree
    // with the audit trail.
    const entries = buildSerialLifecycle([created, received, scrapped], NAMES)
    expect(entries.map((e) => e.at)).toEqual(['2026-04-02 09:00:00', '2026-04-05', '2026-08-01 15:30:00'])
  })

  it('names the registration and the receipt in the words of the operation', () => {
    const entries = buildSerialLifecycle([created, received], NAMES)
    expect(entries[0].title).toBe('Serial number registered')
    expect(entries[1].title).toBe('Received on material receipt')
    expect(entries[1].detail).toBe('MR-0007 · into Main Warehouse · R-01-A1')
    expect(entries[1].documentId).toBe(55)
  })

  it('puts a status change in the headline instead of "Details edited"', () => {
    const [entry] = buildSerialLifecycle([scrapped], NAMES)
    expect(entry.title).toBe('Status changed to Scrapped')
    expect(entry.tone).toBe('danger')
    expect(entry.detail).toBe('Damaged in handling')
  })

  it('gives every entry a key that survives two events sharing a timestamp', () => {
    const entries = buildSerialLifecycle([created, created], NAMES)
    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
  })

  it('shows a transfer as a move between two warehouses', () => {
    const transfer: SerialHistoryEvent = {
      ...received,
      ref_id: 61,
      document_id: 61,
      document_no: 'ST-0012',
      document_type: 'stock_transfer',
      direction: 'out',
      warehouse_name: 'Main Warehouse',
      dest_warehouse_name: 'Delhi Warehouse',
      location_code: null,
    }
    const [entry] = buildSerialLifecycle([transfer], NAMES)
    expect(entry.title).toBe('Issued on stock transfer')
    expect(entry.detail).toBe('ST-0012 · from Main Warehouse · → Delhi Warehouse')
  })
})
