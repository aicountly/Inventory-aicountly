import { describe, expect, it } from 'vitest'
import type { PendingRow } from '../../services/stockApi'
import type { DocumentListRow } from '../types'
import { buildJobWorkerOptions, filterJobWorkers, parseLedgerId, pendingForItem } from './jobWorkers'

function doc(partial: Partial<DocumentListRow>): DocumentListRow {
  return {
    document_id: 1,
    document_uuid: 'u',
    document_type: 'JOB_WORK_OUT',
    document_no: 'JWO-1',
    document_date: '2026-05-01',
    status: 'POSTED',
    source_app: 'inventory',
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: 501,
    party_name: 'Precision Turning Co',
    from_warehouse_id: null,
    to_warehouse_id: null,
    narration: null,
    posted_at: null,
    created_at: null,
    fy_id: 1,
    bo_id: 0,
    line_count: 2,
    valuation_total: 0,
    ...partial,
  }
}

function pending(partial: Partial<PendingRow>): PendingRow {
  return {
    pending_id: 1,
    cmp_id: 1,
    fy_id: 1,
    document_id: 1,
    line_id: 1,
    pending_kind: 'job_work',
    direction: 'out',
    item_id: 90,
    item_name: 'Steel rod',
    unit_id: 1,
    unit_symbol: 'Nos',
    warehouse_id: 3,
    warehouse_name: 'Main',
    party_ref: 501,
    qty_original: 100,
    qty_settled: 40,
    qty_open: 60,
    status: 'partial',
    document_no: 'JWO-1',
    document_date: '2026-05-01',
    document_type: 'JOB_WORK_OUT',
    ...partial,
  }
}

describe('buildJobWorkerOptions', () => {
  it('folds documents and pending rows into one entry per ledger', () => {
    const options = buildJobWorkerOptions(
      [doc({ document_id: 1, party_ref: 501 }), doc({ document_id: 2, party_ref: 501, document_date: '2026-06-02', document_no: 'JWO-2' })],
      [pending({ pending_id: 1, party_ref: 501, qty_open: 60 }), pending({ pending_id: 2, party_ref: 501, item_id: 91, qty_open: 15 })],
    )
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      party_ref: 501,
      party_name: 'Precision Turning Co',
      documents: 2,
      pending_qty: 75,
      pending_lines: 2,
      pending_items: 2,
    })
  })

  it('reports the latest document, not whichever row came back first', () => {
    const [option] = buildJobWorkerOptions(
      [
        doc({ document_id: 1, document_date: '2026-06-02', document_no: 'JWO-2', party_name: 'Renamed Ltd' }),
        doc({ document_id: 2, document_date: '2026-05-01', document_no: 'JWO-1', party_name: 'Old Name' }),
      ],
      [],
    )
    expect(option.last_document_date).toBe('2026-06-02')
    expect(option.last_document_no).toBe('JWO-2')
    expect(option.party_name).toBe('Renamed Ltd')
  })

  it('keeps a job worker that has pending stock but no document in the window', () => {
    const options = buildJobWorkerOptions([], [pending({ party_ref: 777, qty_open: 5 })])
    expect(options.map((o) => o.party_ref)).toEqual([777])
    expect(options[0].documents).toBe(0)
  })

  it('puts whoever still holds material first', () => {
    const options = buildJobWorkerOptions(
      [
        doc({ document_id: 1, party_ref: 501, document_date: '2026-01-01' }),
        doc({ document_id: 2, party_ref: 502, document_date: '2026-09-01', party_name: 'Recent Co' }),
      ],
      [pending({ party_ref: 501, qty_open: 60 })],
    )
    expect(options.map((o) => o.party_ref)).toEqual([501, 502])
  })

  it('ignores rows with no usable ledger id', () => {
    expect(buildJobWorkerOptions([doc({ party_ref: null }), doc({ party_ref: 0 })], [])).toEqual([])
  })
})

describe('filterJobWorkers', () => {
  const options = buildJobWorkerOptions(
    [doc({ party_ref: 501, party_name: 'Precision Turning Co' }), doc({ document_id: 2, party_ref: 620, party_name: 'Anand Plating' })],
    [],
  )

  it('matches on name, case-insensitively', () => {
    expect(filterJobWorkers(options, 'plating').map((o) => o.party_ref)).toEqual([620])
  })

  it('matches on the ledger id', () => {
    expect(filterJobWorkers(options, '501').map((o) => o.party_ref)).toEqual([501])
  })

  it('keeps everything for an empty query', () => {
    expect(filterJobWorkers(options, '   ')).toHaveLength(2)
  })
})

describe('parseLedgerId', () => {
  it('takes a plain positive integer', () => {
    expect(parseLedgerId('1042')).toBe(1042)
    expect(parseLedgerId(' 77 ')).toBe(77)
  })

  it('refuses anything that is not one', () => {
    expect(parseLedgerId('')).toBeNull()
    expect(parseLedgerId('0')).toBeNull()
    expect(parseLedgerId('12.5')).toBeNull()
    expect(parseLedgerId('Precision')).toBeNull()
    expect(parseLedgerId('-4')).toBeNull()
  })
})

describe('pendingForItem', () => {
  const rows = [
    pending({ pending_id: 1, party_ref: 501, item_id: 90, qty_open: 60, document_date: '2026-05-01' }),
    pending({ pending_id: 2, party_ref: 501, item_id: 90, qty_open: 15, document_date: '2026-03-10' }),
    pending({ pending_id: 3, party_ref: 502, item_id: 90, qty_open: 99 }),
  ]

  it('adds up only this job worker and this item, from the oldest dispatch', () => {
    expect(pendingForItem(rows, 501, 90)).toEqual({ qty_open: 75, lines: 2, since: '2026-03-10' })
  })

  it('is null when nothing is open, so the caller prints nothing at all', () => {
    expect(pendingForItem(rows, 501, 91)).toBeNull()
    expect(pendingForItem(rows, null, 90)).toBeNull()
    expect(pendingForItem(rows, 501, null)).toBeNull()
  })
})
