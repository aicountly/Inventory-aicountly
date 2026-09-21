import { describe, expect, it } from 'vitest'
import type { AuditLogRow } from '../../../services/auditApi'
import type { ItemFormOptions } from '../../../services/items'
import { describeBatch, fieldLabel, formatWhen, groupBulkEdits } from './bulkEditHistory'

/**
 * Turning per-item audit rows back into the operations that wrote them.
 *
 * The endpoint writes one row per item, all sharing the request id the server
 * stamps on the HTTP request, so "12 items · today" is those twelve rows
 * grouped — not a figure this screen remembers. Where the rows of one batch
 * disagree about the field or the value, the summary says so rather than
 * picking one row and speaking for the rest.
 */

const options: ItemFormOptions = {
  item_groups: [{ item_grp_id: 5, grp_name: 'Electronics', grp_alias: null, is_primary: 1, parent_grp_id: null }],
  stock_categories: [],
  brands: [],
  units: [],
  warehouses: [],
  valuation_methods: ['FIFO'],
  default_valuation_method: 'FIFO',
  negative_stock_policies: [],
  itc_eligibility_options: [],
}

let nextId = 1
function row(partial: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    audit_id: nextId++,
    cmp_id: 1,
    entity_type: 'item',
    entity_id: 1,
    entity_uuid: null,
    action: 'item.bulk_update',
    actor_uuid: 'member-1',
    source_app: null,
    source_document_type: null,
    source_document_id: null,
    source_document_uuid: null,
    reason: null,
    approval_ref: null,
    reversal_ref: null,
    before: null,
    after: null,
    meta: null,
    request_id: 'req-1',
    ip_address: null,
    created_at: '2026-06-12 10:24:00',
    ...partial,
  }
}

describe('grouping', () => {
  it('turns one row per item back into one operation', () => {
    const batches = groupBulkEdits([
      row({ entity_id: 1, after: { hsn_sac: '998877' }, meta: { fields: ['hsn_sac'] } }),
      row({ entity_id: 2, after: { hsn_sac: '998877' }, meta: { fields: ['hsn_sac'] } }),
    ])
    expect(batches).toHaveLength(1)
    expect(batches[0].itemCount).toBe(2)
    expect(batches[0].field).toBe('hsn_sac')
    expect(batches[0].value).toBe('998877')
  })

  it('keeps separate requests separate', () => {
    const batches = groupBulkEdits([
      row({ request_id: 'req-1', entity_id: 1, after: { mrp: 100 }, meta: { fields: ['mrp'] } }),
      row({ request_id: 'req-2', entity_id: 2, after: { mrp: 120 }, meta: { fields: ['mrp'] } }),
    ])
    expect(batches).toHaveLength(2)
  })

  it('does not sweep rows with no request id into one imaginary operation', () => {
    const batches = groupBulkEdits([
      row({ request_id: null, entity_id: 1, created_at: '2026-06-12 10:24:00' }),
      row({ request_id: null, entity_id: 2, created_at: '2026-06-05 09:00:00' }),
    ])
    expect(batches).toHaveLength(2)
  })

  it('counts an item once even if it appears twice', () => {
    const batches = groupBulkEdits([row({ entity_id: 7 }), row({ entity_id: 7 })])
    expect(batches[0].itemCount).toBe(1)
  })

  it('orders the newest operation first', () => {
    const batches = groupBulkEdits([
      row({ request_id: 'old', created_at: '2026-06-01 08:00:00' }),
      row({ request_id: 'new', created_at: '2026-06-12 10:24:00' }),
    ])
    expect(batches.map((b) => b.id)).toEqual(['new', 'old'])
  })

  it('reads the changed field from `after` when meta does not carry it', () => {
    const batches = groupBulkEdits([row({ after: { brand_id: 8 }, meta: null })])
    expect(batches[0].field).toBe('brand_id')
  })
})

describe('describing a batch', () => {
  it('names the field and the value in the reader’s words', () => {
    const [batch] = groupBulkEdits([row({ after: { item_grp_id: 5 }, meta: { fields: ['item_grp_id'] } })])
    expect(describeBatch(batch, options)).toBe('Item group set to Electronics')
  })

  it('says a value was cleared rather than set to nothing', () => {
    const [batch] = groupBulkEdits([row({ after: { mrp: null }, meta: { fields: ['mrp'] } })])
    expect(describeBatch(batch, options)).toBe('MRP cleared')
  })

  it('refuses to speak for rows that disagree', () => {
    const [batch] = groupBulkEdits([
      row({ entity_id: 1, after: { mrp: 100 }, meta: { fields: ['mrp'] } }),
      row({ entity_id: 2, after: { mrp: 200 }, meta: { fields: ['mrp'] } }),
    ])
    expect(batch.value).toBeNull()
    expect(describeBatch(batch, options)).toBe('MRP updated')
  })

  it('says "several fields" when the batch touched more than one', () => {
    const [batch] = groupBulkEdits([
      row({ entity_id: 1, after: { mrp: 100 }, meta: { fields: ['mrp'] } }),
      row({ entity_id: 2, after: { brand_id: 8 }, meta: { fields: ['brand_id'] } }),
    ])
    expect(batch.field).toBeNull()
    expect(fieldLabel(batch.field)).toBe('Several fields')
  })
})

describe('when it happened', () => {
  const now = new Date(2026, 5, 12, 18, 0, 0)

  it('says Today for something recorded today', () => {
    expect(formatWhen('2026-06-12 10:24:00', now)).toBe('Today, 10:24')
  })

  it('gives the full date for anything else', () => {
    expect(formatWhen('2026-06-05 09:00:00', now)).toBe('05 Jun 2026, 09:00')
  })

  it('degrades to the empty marker rather than to a wrong word', () => {
    expect(formatWhen(null, now)).toBe('—')
    expect(formatWhen('not a date', now)).toBe('—')
  })
})
