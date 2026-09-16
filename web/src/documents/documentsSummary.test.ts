import { describe, expect, it } from 'vitest'
import {
  documentsScopeHint,
  documentsSummaryFor,
  documentsSummaryOverRows,
} from './documentsSummary'
import type { DocumentListResponse } from '../services/documentsApi'
import type { DocumentListRow } from './types'

/*
 * The register's figures are either the server's aggregate over every matching
 * document or the sums of the page it was served — and the screen says which.
 * A page sum presented as a register total is the one failure a reader cannot
 * see, so each branch is held here rather than trusted to the caller.
 */

const KEYS = ['line_count', 'valuation_total'] as const

function row(over: Partial<DocumentListRow> = {}): DocumentListRow {
  return { line_count: 2, valuation_total: 100, ...over } as DocumentListRow
}

function response(over: Partial<DocumentListResponse> = {}): DocumentListResponse {
  return {
    data: [row(), row({ line_count: 3, valuation_total: 250 })],
    meta: { total: 4182, limit: 50, offset: 0 },
    ...over,
  }
}

describe('with the server aggregate', () => {
  const served = response({
    summary: {
      documents: 4182,
      line_count: 9431,
      valuation_total: 812_450.5,
      warehouses_impacted: 7,
    },
  })

  it('takes the sums from the server, not from the rows on the page', () => {
    const s = documentsSummaryFor(served, KEYS)
    expect(s.sums.line_count).toBe(9431)
    expect(s.sums.valuation_total).toBe(812_450.5)
    expect(s.warehousesImpacted).toBe(7)
    expect(s.fromServer).toBe(true)
  })

  it('carries no page caveat, because the figures are not the page', () => {
    const s = documentsSummaryFor(served, KEYS)
    expect(s.isWholeResult).toBe(true)
    expect(documentsScopeHint(s)).toBe('Matching these filters')
  })
})

describe('without it', () => {
  it('totals the served page and says so', () => {
    const s = documentsSummaryFor(response(), KEYS)
    expect(s.sums.line_count).toBe(5)
    expect(s.sums.valuation_total).toBe(350)
    expect(s.fromServer).toBe(false)
    expect(s.isWholeResult).toBe(false)
    expect(documentsScopeHint(s)).toBe('this page only')
  })

  it('has no warehouse count to offer, rather than a wrong one', () => {
    // Warehouses live on the LINES; a page of document rows cannot be counted
    // into an answer, so there is none.
    expect(documentsSummaryFor(response(), KEYS).warehousesImpacted).toBeNull()
  })

  it('drops the caveat when the page happens to be the whole result', () => {
    const s = documentsSummaryFor(response({ meta: { total: 2, limit: 50, offset: 0 } }), KEYS)
    expect(s.isWholeResult).toBe(true)
    expect(documentsScopeHint(s)).toBe('all rows')
  })
})

describe('re-totalled over the rows an export wrote', () => {
  const served = documentsSummaryFor(
    response({
      meta: { total: 3, limit: 50, offset: 0 },
      summary: { documents: 3, line_count: 9, valuation_total: 900, warehouses_impacted: 4 },
    }),
    KEYS,
  )

  it('keeps the server figures when the walk wrote every row', () => {
    const all = [row({ line_count: 3, valuation_total: 300 }), row({ line_count: 3, valuation_total: 300 }), row({ line_count: 3, valuation_total: 300 })]
    const s = documentsSummaryOverRows(served, all, KEYS)
    expect(s.sums.line_count).toBe(9)
    expect(s.sums.valuation_total).toBe(900)
    expect(s.fromServer).toBe(true)
    expect(s.warehousesImpacted).toBe(4)
  })

  it('totals what a capped export actually wrote, and drops the warehouse count', () => {
    /*
     * A sheet carrying one row of three must not print the register's totals
     * under it, and the warehouse count cannot be re-derived from the rows —
     * so it goes rather than being carried over as if it described them.
     */
    const s = documentsSummaryOverRows(served, [row({ line_count: 3, valuation_total: 300 })], KEYS)
    expect(s.sums.line_count).toBe(3)
    expect(s.sums.valuation_total).toBe(300)
    expect(s.fromServer).toBe(false)
    expect(s.warehousesImpacted).toBeNull()
    expect(documentsScopeHint(s)).toBe('this page only')
  })
})
