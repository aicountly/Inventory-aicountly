import { describe, expect, it } from 'vitest'
import { partiesFromDocuments } from './partyApi'
import type { DocumentListRow } from '../documents/types'

function row(patch: Partial<DocumentListRow>): DocumentListRow {
  return {
    document_id: 1,
    document_uuid: 'u',
    document_type: 'DELIVERY_CHALLAN',
    document_no: 'DC-1',
    document_date: '2026-09-18',
    status: 'POSTED',
    source_app: 'inventory',
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: 1042,
    party_name: 'Acme Ltd',
    from_warehouse_id: null,
    to_warehouse_id: null,
    narration: null,
    posted_at: null,
    created_at: null,
    fy_id: 1,
    bo_id: 0,
    line_count: 2,
    valuation_total: 0,
    ...patch,
  }
}

describe('partiesFromDocuments', () => {
  it('folds repeated documents into one party and counts them', () => {
    const out = partiesFromDocuments([
      row({ document_id: 3, document_no: 'DC-3', document_date: '2026-09-18' }),
      row({ document_id: 2, document_no: 'DC-2', document_date: '2026-08-01' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ party_ref: 1042, party_name: 'Acme Ltd', seen: 2 })
  })

  it('takes the snapshot from the first (newest) document it sees', () => {
    const out = partiesFromDocuments([
      row({ document_no: 'DC-9', document_date: '2026-09-18' }),
      row({ document_no: 'DC-1', document_date: '2025-01-01', party_name: 'Acme Limited (old name)' }),
    ])
    expect(out[0].last_document_no).toBe('DC-9')
    expect(out[0].party_name).toBe('Acme Ltd')
  })

  it('keeps two ledgers apart even when the name matches', () => {
    const out = partiesFromDocuments([row({ party_ref: 1042 }), row({ party_ref: 2001, document_id: 2 })])
    expect(out.map((p) => p.party_ref).sort()).toEqual([1042, 2001])
  })

  it('groups name-only parties by name, case-insensitively', () => {
    const out = partiesFromDocuments([
      row({ party_ref: null, party_name: 'Walk-in' }),
      row({ party_ref: null, party_name: 'walk-in', document_id: 2 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].seen).toBe(2)
  })

  it('skips documents with no party at all', () => {
    expect(partiesFromDocuments([row({ party_ref: null, party_name: null })])).toEqual([])
  })

  it('labels a party that has an id but no name', () => {
    expect(partiesFromDocuments([row({ party_name: null })])[0].party_name).toBe('Ledger #1042')
  })

  it('caps the suggestion list', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ party_ref: i + 1, party_name: `Customer ${i}`, document_id: i + 1 }))
    expect(partiesFromDocuments(rows, 5)).toHaveLength(5)
  })
})
