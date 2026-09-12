import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline'
import type { InventoryDocument } from './types'

const base: InventoryDocument = {
  document_id: 1, document_uuid: 'u', cmp_id: 1, bo_id: 0, fy_id: 1, document_type: 'WRITE_OFF', document_no: 'WO-1', series_id: null, document_date: '2026-04-02', status: 'POSTED', source_app: 'inventory',
  source_document_type: null, source_document_id: null, source_document_uuid: null, source_document_no: null, source_document_date: null, party_ref: null, party_name: null, dest_party_ref: null,
  from_warehouse_id: null, to_warehouse_id: null, dest_bo_id: null, stock_effect: null, returnable: null, expected_return_date: null, movement_reason: null, reason_code: null, narration: null, currency_code: 'INR', exchange_rate: 1,
  metadata: null, accounting_effects: [], reverses_document_id: null, reversed_by_document_id: null, approved_by: 'bob', approved_at: '2026-04-02 10:00:00', posted_by: 'bob', posted_at: '2026-04-02 10:05:00', cancelled_by: null, cancelled_at: null, cancel_reason: null,
  failure_reason: null, version: 1, created_by: 'alice', created_at: '2026-04-02 09:00:00', updated_by: null, updated_at: null, lines: [],
}

describe('buildTimeline', () => {
  it('orders created, approvals, posting and reversal by time and keeps notes', () => {
    const events = buildTimeline(
      { ...base, status: 'REVERSED', cancelled_at: '2026-04-03 08:00:00', cancelled_by: 'carol', cancel_reason: 'wrong warehouse' },
      [{ approval_id: 1, action: 'submitted', actor_uuid: 'alice', notes: 'please check', created_at: '2026-04-02 09:30:00' }, { approval_id: 2, action: 'approved', actor_uuid: 'bob', notes: null, created_at: '2026-04-02 10:00:00' }],
      [{ audit_id: 9, entity_type: 'document', entity_id: 1, action: 'document.update', actor_uuid: 'alice', reason: null, source_app: null, before: null, after: null, meta: null, created_at: '2026-04-02 09:15:00' }],
    )
    expect(events.map((e) => e.label)).toEqual(['Created', 'Edited', 'Submitted for approval', 'Approved', 'Posted', 'Reversed'])
    expect(events[2].note).toBe('please check')
    expect(events[5]).toMatchObject({ actor: 'carol', note: 'wrong warehouse', tone: 'danger' })
  })

  it('falls back to the approved stamp when the approvals trail is missing and reports failures', () => {
    const events = buildTimeline({ ...base, status: 'FAILED', posted_at: null, failure_reason: 'Insufficient stock', updated_at: '2026-04-02 10:06:00' })
    expect(events.map((e) => e.label)).toEqual(['Created', 'Approved', 'Posting failed'])
    expect(events[2].note).toBe('Insufficient stock')
  })
})
