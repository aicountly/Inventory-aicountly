import { describe, expect, it, vi } from 'vitest'
import {
  DOCUMENT_REGISTER_COLUMNS,
  DOCUMENT_REGISTER_FILTERS,
  DOCUMENT_REGISTER_SORTABLE,
  documentsRegister,
  serverSortableOnly,
} from './documentsRegister'
import { NATIVE_DOCUMENT_TYPES, SOURCED_DOCUMENT_TYPES } from './registry'
import type { DocumentsSummary } from './documentsSummary'
import type { ReportColumn } from '../reports/types'
import type { ReportResponse } from '../services/reportsApi'
import type { DocumentListRow } from './types'

/*
 * The three declarations `documentsRegister` makes about itself, held as a
 * contract rather than as a comment.
 *
 * Each of these used to be prose in the file and nothing else: the sort
 * whitelist was a doc-comment beside hand-written `sortKey` values, and the
 * "valuation" note was a claim about a column that was emitted unconditionally.
 */

vi.mock('../services/documentsApi', () => ({ documentsApi: { list: vi.fn() } }))

function summary(over: Partial<DocumentsSummary> = {}): DocumentsSummary {
  return {
    total: 4182,
    pageRows: 50,
    sums: { line_count: 120, valuation_total: 98_500 },
    isWholeResult: false,
    fromServer: false,
    warehousesImpacted: null,
    ...over,
  }
}

/** The envelope the engine hands `summary` / `kpis`; only the summary is read. */
function response(s: DocumentsSummary): ReportResponse<DocumentListRow, DocumentsSummary> {
  return { data: [], meta: { total: s.total, limit: 50, offset: 0 }, summary: s, report: 'documents' }
}

describe('the sort whitelist is enforced, not documented', () => {
  it('leaves no column carrying a sort key DocumentsController does not honour', () => {
    const sortKeys = DOCUMENT_REGISTER_COLUMNS.map((c) => c.sortKey).filter(Boolean) as string[]
    expect(sortKeys.length).toBeGreaterThan(0)
    for (const key of sortKeys) {
      expect(DOCUMENT_REGISTER_SORTABLE.has(key), `${key} is sortable server-side`).toBe(true)
    }
  })

  it('strips the sort control from a column added with one by default', () => {
    /*
     * `textColumn('party_name', 'Party')` defaults to `sortable = true`. The
     * server silently falls back to document_date for any key outside its
     * whitelist, so such a column would move the arrow, re-fetch, and hand back
     * the same rows under a header claiming they are sorted by party.
     */
    const added: ReportColumn<{ party_name: string }>[] = [
      { key: 'party_name', header: 'Party', sortKey: 'party_name' },
      { key: 'document_no', header: 'Number', sortKey: 'document_no' },
    ]

    const guarded = serverSortableOnly(added)

    expect(guarded[0].sortKey).toBeUndefined()
    expect(guarded[1].sortKey).toBe('document_no')
    // Everything else about the column survives untouched.
    expect(guarded[0].header).toBe('Party')
  })
})

describe('a register of a type that is never valued shows no valuation', () => {
  /** valuation => false in Config\DocumentTypeRegistry, and not VALUES_MOVED_STOCK. */
  const UNVALUED = ['DELIVERY_CHALLAN', 'JOB_WORK_OUT', 'PACKING']

  it.each(UNVALUED)('%s: no column, no card, no total, and the description says why', (code) => {
    const config = documentsRegister(code)

    expect(config.columns.map((c) => c.key)).not.toContain('valuation_total')
    expect(config.kpis?.(summary(), response(summary())).map((k) => k.key)).not.toContain('valuation')
    expect(config.summary?.(summary(), response(summary())).map((i) => i.label)).not.toContain('Valuation')

    const totals = config.totals?.(summary(), []) ?? {}
    expect(Object.keys(totals)).not.toContain('valuation_total')
    // Lines still total — the register is not gutted, only the figure that is
    // structurally zero for this type is gone.
    expect(String(totals.line_count)).toBe('120')

    expect(config.description).toMatch(/carries no valuation/i)
    expect(config.description).not.toMatch(/what the stock cost/i)
  })

  it('keeps it for an inward challan, whose settled receipts DO carry valuation', () => {
    // Config\DocumentTypeRegistry::VALUES_MOVED_STOCK — a settle_deferred or
    // physical inward challan opens a cost layer like any other receipt.
    const config = documentsRegister('INWARD_CHALLAN')
    expect(config.columns.map((c) => c.key)).toContain('valuation_total')
    expect(config.kpis?.(summary(), response(summary())).map((k) => k.key)).toContain('valuation')
  })

  it.each(['STOCK_TRANSFER', 'PRODUCTION', 'PHYSICAL_ADJUSTMENT', 'JOB_WORK_IN'])(
    'keeps it for %s, which is valued',
    (code) => {
      expect(documentsRegister(code).columns.map((c) => c.key)).toContain('valuation_total')
    },
  )

  it('keeps it on the all-types register, where most rows are valued', () => {
    const config = documentsRegister(null)
    expect(config.columns.map((c) => c.key)).toContain('valuation_total')
    expect(config.kpis?.(summary(), response(summary())).map((k) => k.key)).toContain('valuation')
  })

  it('keeps it for a code the client registry does not know', () => {
    // Saying nothing beats hiding a figure that may well be real.
    expect(documentsRegister('SALES_ISSUE').columns.map((c) => c.key)).toContain('valuation_total')
  })
})

describe('the Type filter can still reach a Books-sourced document', () => {
  it('declares document_type as the shared filter kind', () => {
    const filter = DOCUMENT_REGISTER_FILTERS.find((f) => f.key === 'document_type')
    expect(filter?.kind).toBe('document_type')
  })

  it('offers the sourced codes in the fallback, not only the native ones', () => {
    /*
     * `useDocumentTypeOptions` falls back to these two lists together while
     * GET /v1/document-types is in flight or has failed. The screen this
     * replaced listed the sourced codes from a static optgroup, so it could
     * never lose them; the fallback has to match that or a reader cannot filter
     * down to the Sales Issues that arrived from Books on the one screen built
     * to show both products' documents.
     */
    const codes = [...NATIVE_DOCUMENT_TYPES, ...SOURCED_DOCUMENT_TYPES].map((t) => t.code)
    for (const code of [
      'SALES_ISSUE',
      'PURCHASE_RECEIPT',
      'SALES_RETURN',
      'PURCHASE_RETURN',
      'JOURNAL_ADJUSTMENT',
      'RESERVATION',
      'RESERVATION_RELEASE',
    ]) {
      expect(codes, code).toContain(code)
    }
    expect(codes).toContain('STOCK_TRANSFER')
    expect(new Set(codes).size).toBe(codes.length)
  })
})
