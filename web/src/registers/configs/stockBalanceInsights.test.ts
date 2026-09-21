import { describe, expect, it } from 'vitest'
import { stockBalanceRegister } from './stockRegisters'
import { pageSummaryFor } from './pageSummary'
import type { PageSummary } from './pageSummary'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import type { ReportResponse } from '../../services/reportsApi'

/**
 * The at-a-glance strip states counts, and `/v1/stock-balances` sends no
 * aggregate over the filtered set — so every figure up there is a count of the
 * rows THIS page carried. These tests pin the wording that keeps that honest.
 *
 * The failure they exist to prevent: page 1 of 40 happens to hold no negative
 * row, the strip reads "0 negative stock alerts · All good!", and the twelve
 * negative rows on page 7 go unlooked-at.
 */

const SUM_KEYS = ['on_hand_qty', 'reserved_qty', 'packed_qty', 'available_qty'] as const

function row(over: Partial<StockBalanceGridRow> = {}): StockBalanceGridRow {
  return {
    balance_id: 1,
    cmp_id: 1,
    item_id: 1,
    warehouse_id: 1,
    batch_id: null,
    on_hand_qty: 10,
    reserved_qty: 0,
    committed_qty: 0,
    packed_qty: 0,
    in_transit_qty: 0,
    job_worker_qty: 0,
    quality_hold_qty: 0,
    damaged_qty: 0,
    blocked_qty: 0,
    expected_qty: 0,
    last_movement_at: null,
    item_name: 'Widget',
    item_sku: 'W-1',
    warehouse_name: 'Main store',
    batch_no: null,
    available_qty: 10,
    ...over,
  }
}

/** The register's own summary, built exactly as its `fetch` builds it. */
function respond(rows: StockBalanceGridRow[], total = rows.length) {
  const response = {
    data: rows,
    meta: { total, limit: rows.length || 1, offset: 0 },
  }
  const summary = pageSummaryFor(response, SUM_KEYS)
  return {
    summary,
    response: { ...response, summary, report: 'stock_balances' } as ReportResponse<
      StockBalanceGridRow,
      PageSummary
    >,
  }
}

function insightsFor(rows: StockBalanceGridRow[], total = rows.length) {
  const { summary, response } = respond(rows, total)
  // Called the way ReportPage calls it: the third argument carries the filters
  // the register was asked, which this register's insights do not read.
  const set = stockBalanceRegister.insights!(summary, response, {
    summary,
    rows,
    values: {},
    query: {},
    loading: false,
  })
  const by = (key: string) => set.items.find((i) => i.key === key)!
  return { set, by }
}

describe('the stock balance at-a-glance strip', () => {
  it('counts distinct SKUs, not rows — one item in two bins is one SKU', () => {
    const { by } = insightsFor([
      row({ balance_id: 1, item_id: 7, warehouse_id: 1 }),
      row({ balance_id: 2, item_id: 7, warehouse_id: 2, warehouse_name: 'Overflow' }),
    ])
    expect(by('skus').label).toBe('1 SKU in view')
    expect(by('warehouses').label).toBe('2 warehouses')
  })

  it('names the warehouses it is counting', () => {
    const { by } = insightsFor([
      row({ balance_id: 1, warehouse_id: 1, warehouse_name: 'Main store' }),
      row({ balance_id: 2, warehouse_id: 2, warehouse_name: 'Overflow' }),
    ])
    expect(by('warehouses').hint).toBe('Main store · Overflow')
  })

  it('counts a row below zero as an alert, on the server\'s own tolerance', () => {
    const { by } = insightsFor([row({ on_hand_qty: -4 }), row({ balance_id: 2, on_hand_qty: 3 })])
    expect(by('negative').label).toBe('1 negative stock alert')
    expect(by('negative').hint).toBe('Review required')
    expect(by('negative').tone).toBe('danger')
  })

  it('does not call a rounding crumb below zero a negative balance', () => {
    // StockBalanceService::NEGATIVE_ON_HAND_EPSILON is -0.00005.
    const { by } = insightsFor([row({ on_hand_qty: -0.00001 })])
    expect(by('negative').label).toBe('0 negative stock alerts')
  })

  it('says "All good!" only when the page IS the whole register', () => {
    const { by, set } = insightsFor([row()])
    expect(by('negative').hint).toBe('All good!')
    expect(by('sync').hint).toBe('Data up to date')
    expect(set.note).toBe('Your inventory. In perfect balance.')
  })

  /** The one that matters. */
  it('refuses to clear a register it has only seen one page of', () => {
    const { by, set } = insightsFor([row(), row({ balance_id: 2 })], 800)
    expect(by('negative').label).toBe('0 negative stock alerts')
    expect(by('negative').hint).toBe('None on this page')
    expect(by('skus').hint).toBe('On this page')
    expect(by('sync').hint).toBe('Figures cover this page')
    expect(set.note, 'no all-clear over 2 rows of 800').toBeUndefined()
  })

  it('claims nothing about an empty result', () => {
    const { set } = insightsFor([])
    expect(set.note).toBeUndefined()
  })
})
