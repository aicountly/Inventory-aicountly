import { describe, expect, it } from 'vitest'
import {
  aggregateMovements,
  comparisonFor,
  comparisonHint,
  movementScopeHint,
  movementSummaryOf,
  movementSummaryOverRows,
} from './movementSummary'
import type { MovementListResponse, StockMovementRow } from '../../services/stockViewsApi'

function row(over: Partial<StockMovementRow>): StockMovementRow {
  return {
    movement_id: 1,
    movement_uuid: 'u',
    cmp_id: 1,
    fy_id: 1,
    bo_id: 0,
    document_id: 10,
    line_id: 1,
    document_type: 'MATERIAL_RECEIPT',
    movement_date: '2026-09-19',
    sequence_no: 1,
    item_id: 5,
    warehouse_id: 3,
    location_id: null,
    batch_id: null,
    direction: 'in',
    qty: 10,
    unit_cost: 5,
    value: 50,
    movement_kind: 'physical',
    reversal_of_movement_id: null,
    created_at: null,
    created_by: null,
    item_name: 'Steel rod',
    item_alias: null,
    item_sku: null,
    unit_id: null,
    unit_symbol: 'kg',
    stock_cat_id: null,
    item_grp_id: null,
    cat_name: null,
    warehouse_name: 'Main',
    warehouse_code: null,
    batch_no: null,
    from_warehouse_id: null,
    to_warehouse_id: null,
    from_warehouse_name: null,
    to_warehouse_name: null,
    document_no: 'MR-1',
    document_status: 'posted',
    source_app: null,
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: null,
    party_name: null,
    ...over,
  }
}

function response(over: Partial<MovementListResponse>): MovementListResponse {
  return {
    data: [],
    meta: { total: 0, limit: 25, offset: 0 },
    ...over,
  } as MovementListResponse
}

describe('aggregateMovements', () => {
  it('splits inward from outward by the SIGN of the quantity, not the direction column', () => {
    // A reversal of a receipt is stored `direction: 'in'` with a negative quantity. It is
    // stock leaving, and counting it as inward would report goods arriving that left.
    const rows = [
      row({ movement_id: 1, qty: 10, value: 100 }),
      row({ movement_id: 2, direction: 'in', movement_kind: 'reversal', qty: -4, value: -40 }),
    ]
    const totals = aggregateMovements(rows)
    expect(totals.in_qty).toBe(10)
    expect(totals.out_qty).toBe(4)
    expect(totals.net_qty).toBe(6)
    expect(totals.in_value).toBe(100)
    expect(totals.out_value).toBe(40)
    expect(totals.net_value).toBe(60)
  })

  it('counts distinct items and documents, not rows', () => {
    const totals = aggregateMovements([
      row({ movement_id: 1, item_id: 5, document_id: 10 }),
      row({ movement_id: 2, item_id: 5, document_id: 10 }),
      row({ movement_id: 3, item_id: 7, document_id: 11 }),
    ])
    expect(totals.movements).toBe(3)
    expect(totals.items).toBe(2)
    expect(totals.documents).toBe(2)
  })

  it('rounds to the four decimals the endpoint keeps, so a column of sums stays tidy', () => {
    const totals = aggregateMovements([
      row({ movement_id: 1, qty: 0.1, value: 0.1 }),
      row({ movement_id: 2, qty: 0.2, value: 0.2 }),
    ])
    expect(totals.in_qty).toBe(0.3)
    expect(totals.in_value).toBe(0.3)
  })
})

describe('movementSummaryOf', () => {
  it('prefers the server aggregate, which covers every matching movement', () => {
    const summary = movementSummaryOf(
      response({
        data: [row({ qty: 1, value: 1 })],
        meta: { total: 4000, limit: 25, offset: 0 },
        summary: {
          movements: 4000,
          items: 120,
          documents: 900,
          in_qty: 12450,
          out_qty: 11680,
          net_qty: 770,
          in_value: 900000,
          out_value: 880000,
          net_value: 20000,
          from: '2026-04-01',
          to: '2026-09-19',
          previous: null,
        },
      }),
    )
    // Not 1 — the page held one row and the register still speaks for all 4,000.
    expect(summary.in_qty).toBe(12450)
    expect(summary.net_qty).toBe(770)
    expect(summary.total).toBe(4000)
    expect(summary.whole).toBe(true)
    expect(movementScopeHint(summary)).toBe('matching the filters')
  })

  it('falls back to the rows in hand, and says the figures are the page only', () => {
    const summary = movementSummaryOf(
      response({
        data: [row({ movement_id: 1, qty: 10, value: 100 }), row({ movement_id: 2, qty: -3, value: -30 })],
        meta: { total: 500, limit: 25, offset: 0 },
      }),
    )
    expect(summary.in_qty).toBe(10)
    expect(summary.out_qty).toBe(3)
    expect(summary.whole).toBe(false)
    expect(movementScopeHint(summary)).toBe('this page only')
  })

  it('knows when the page IS the whole result', () => {
    const summary = movementSummaryOf(
      response({ data: [row({})], meta: { total: 1, limit: 25, offset: 0 } }),
    )
    expect(summary.whole).toBe(true)
  })
})

describe('the comparison a KPI card is allowed to draw', () => {
  const served = {
    movements: 100,
    items: 5,
    documents: 20,
    in_qty: 400,
    out_qty: 300,
    net_qty: 100,
    in_value: 4000,
    out_value: 3000,
    net_value: 1000,
    from: '2026-09-01',
    to: '2026-09-30',
  }

  it('passes the server figure through when there is a real window behind it', () => {
    const summary = movementSummaryOf(
      response({
        data: [],
        meta: { total: 100, limit: 25, offset: 0 },
        summary: {
          ...served,
          previous: { ...served, movements: 80, in_qty: 320, from: '2026-08-02', to: '2026-08-31' },
        },
      }),
    )
    expect(comparisonFor(summary, 'movements')).toBe(80)
    expect(comparisonFor(summary, 'in_qty')).toBe(320)
    expect(comparisonHint(summary)).toBe('vs 02 Aug 2026 – 31 Aug 2026')
  })

  it('draws nothing against an empty window — "up ∞%" is not a measurement', () => {
    const summary = movementSummaryOf(
      response({
        data: [],
        meta: { total: 100, limit: 25, offset: 0 },
        summary: {
          ...served,
          previous: { ...served, movements: 0, in_qty: 0, from: '2026-08-02', to: '2026-08-31' },
        },
      }),
    )
    expect(comparisonFor(summary, 'movements')).toBeNull()
    expect(comparisonHint(summary)).toBe('matching the filters')
  })

  it('draws nothing at all when the endpoint sent no comparison', () => {
    const summary = movementSummaryOf(
      response({ data: [], meta: { total: 100, limit: 25, offset: 0 }, summary: { ...served, previous: null } }),
    )
    expect(comparisonFor(summary, 'net_qty')).toBeNull()
  })

  it('never compares a page figure against a whole-window figure', () => {
    // No server aggregate, so the current figure covers 25 rows. A percentage against a
    // window measured over all of them would be a ratio between two different questions.
    const summary = movementSummaryOf(
      response({ data: [row({})], meta: { total: 500, limit: 25, offset: 0 } }),
    )
    expect(summary.previous).toBeNull()
    expect(comparisonFor(summary, 'movements')).toBeNull()
  })
})

describe('movementSummaryOverRows', () => {
  it('re-totals for an export, and drops the chart and the comparison it no longer describes', () => {
    const base = movementSummaryOf(
      response({
        data: [row({})],
        meta: { total: 2, limit: 25, offset: 0 },
        summary: {
          movements: 2,
          items: 1,
          documents: 1,
          in_qty: 10,
          out_qty: 3,
          net_qty: 7,
          in_value: 100,
          out_value: 30,
          net_value: 70,
          from: '2026-04-01',
          to: '2026-09-19',
          previous: { movements: 1, items: 1, documents: 1, in_qty: 1, out_qty: 0, net_qty: 1, in_value: 1, out_value: 0, net_value: 1, from: '2025-10-11', to: '2026-03-31' },
        },
        trend: { bucket: 'week', from: null, to: null, truncated: false, points: [] },
      }),
    )
    const exported = movementSummaryOverRows(base, [
      row({ movement_id: 1, qty: 10, value: 100 }),
      row({ movement_id: 2, qty: -3, value: -30 }),
    ])
    expect(exported.in_qty).toBe(10)
    expect(exported.out_qty).toBe(3)
    expect(exported.pageRows).toBe(2)
    // The export walked every page, so its figures ARE the whole filtered set.
    expect(exported.whole).toBe(true)
    expect(exported.previous).toBeNull()
    expect(exported.trend).toBeNull()
  })
})
