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
  const set = stockBalanceRegister.insights!(summary, response)
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
    const { by } = insightsFor([row()])
    expect(by('negative').hint).toBe('All good!')
    expect(by('sync').hint).toBe('Data up to date')
    expect(by('insights').hint).toBe('No additional issues detected')
  })

  /*
   * The fifth tile is called "Insights", never "AI insights".
   *
   * There is no insights service in Inventory to call. The tile counts rows
   * that are already on screen, so these pin both the wording and the fact
   * that it says something the four tiles beside it do not.
   */
  it('reports held stock as an insight, additive to the other tiles', () => {
    const { by } = insightsFor([
      row({ reserved_qty: 4 }),
      row({ balance_id: 2, packed_qty: 1 }),
      row({ balance_id: 3, job_worker_qty: 2 }),
      row({ balance_id: 4 }),
    ])
    expect(by('insights').label).toBe('Insights')
    expect(by('insights').hint).toBe('3 rows reserved, packed or at a job worker')
  })

  it('never claims a machine analysed anything', () => {
    const { set } = insightsFor([row()])
    const labels = set.items.map((i) => String(i.label))
    expect(labels).toContain('Insights')
    expect(labels.some((l) => /\bAI\b/i.test(l))).toBe(false)
  })

  /** The one that matters. */
  it('refuses to clear a register it has only seen one page of', () => {
    const { by, set } = insightsFor([row(), row({ balance_id: 2 })], 800)
    expect(by('negative').label).toBe('0 negative stock alerts')
    expect(by('negative').hint).toBe('None on this page')
    expect(by('skus').hint).toBe('On this page')
    expect(by('sync').hint).toBe('Figures cover this page')
    expect(set.note, 'no all-clear over 2 rows of 800').toBeUndefined()
    // The insight is scoped for the same reason every other hint here is.
    expect(by('insights').hint).toBe('No additional issues detected · this page')
  })

  it('claims nothing about an empty result', () => {
    const { set, by } = insightsFor([])
    expect(set.note).toBeUndefined()
    expect(by('insights').hint).toBe('No additional issues detected')
  })
})
