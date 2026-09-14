import { describe, expect, it } from 'vitest'
import { buildQuery, drill } from './kpiNavigation'
import { REPORT_CONFIGS } from '../reports/configs'
import { REGISTER_CONFIGS } from '../registers/configs'

/**
 * The point of these tests is not that the strings look right — it is that
 * every drill-down target is a filter the destination actually reads. A card
 * that navigates somewhere showing a different number is worse than a card that
 * does not navigate at all, so the report links are checked against the real
 * ReportConfig filter keys rather than against a hand-written list.
 */

/** Params ReportPage keeps for every report, on top of the config's own filters. */
const REPORT_BASE_PARAMS = new Set(['sort', 'order', 'page', 'limit', 'q'])

function parse(url: string): { path: string; params: URLSearchParams } {
  const [path, query = ''] = url.split('?')
  return { path, params: new URLSearchParams(query) }
}

function assertReportLink(url: string, reportPath: string) {
  const { path, params } = parse(url)
  expect(path).toBe(`/reports/${reportPath}`)
  const config = REPORT_CONFIGS.find((c) => c.path === reportPath)
  expect(config, `no report config for ${reportPath}`).toBeTruthy()
  const allowed = new Set([...REPORT_BASE_PARAMS, ...config!.filters.map((f) => f.key)])
  for (const key of params.keys()) {
    expect(allowed.has(key), `${reportPath} would ignore ?${key}`).toBe(true)
  }
}

/** Same check for a native register: /registers/<path> renders through the same engine. */
function assertRegisterLink(url: string, registerPath: string) {
  const { path, params } = parse(url)
  expect(path).toBe(`/registers/${registerPath}`)
  const config = REGISTER_CONFIGS.find((c) => (c.routePath ?? c.path) === registerPath)
  expect(config, `no register config for ${registerPath}`).toBeTruthy()
  const allowed = new Set([...REPORT_BASE_PARAMS, ...config!.filters.map((f) => f.key)])
  for (const key of params.keys()) {
    expect(allowed.has(key), `${registerPath} would ignore ?${key}`).toBe(true)
  }
}

describe('buildQuery', () => {
  it('drops empty values so a cleared filter leaves no trace', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: undefined })).toBe('?a=1')
  })

  it('encodes booleans as the 1/0 the API and the toggles use', () => {
    expect(buildQuery({ nonzero: true, expired: false })).toBe('?nonzero=1&expired=0')
  })

  it('returns an empty string, not a bare "?", when nothing survives', () => {
    expect(buildQuery({ a: null })).toBe('')
  })

  it('escapes values', () => {
    expect(buildQuery({ q: 'a b&c' })).toBe('?q=a+b%26c')
  })
})

describe('report drill-downs only use filters the report declares', () => {
  const asOf = '2026-09-14'

  it('stock summary links', () => {
    assertReportLink(drill.stockValue({ asOf }), 'stock-summary')
    assertReportLink(drill.stockQty({ asOf }), 'stock-summary')
    assertReportLink(drill.itemsInStock({ asOf }), 'stock-summary')
  })

  it('sends negative stock to the register built on the table the card counts', () => {
    // The card counts inv_stock_balances; the movement-derived stock summary is
    // a different computation and would show a different set of rows.
    assertRegisterLink(drill.negativeStock(), 'stock-balances')
  })

  it('warehouse stock links', () => {
    assertReportLink(drill.warehouseStock({ asOf }), 'warehouse-stock')
    assertReportLink(drill.warehouseStock({ asOf, warehouseId: 7 }), 'warehouse-stock')
  })

  it('ageing links', () => {
    assertReportLink(drill.stockAgeing({ asOf }), 'stock-ageing')
  })

  it('movement links', () => {
    assertReportLink(drill.movementAnalysis({ from: '2026-04-01', to: asOf }), 'movement-analysis')
    assertReportLink(drill.movementAnalysis({ from: '2026-04-01', to: asOf, cls: 'dead' }), 'movement-analysis')
  })

  it('expiry links', () => {
    assertReportLink(drill.nearExpiry({ days: 30 }), 'near-expiry')
    assertReportLink(drill.expiredBatches(), 'near-expiry')
  })

  it('replenishment links', () => {
    assertReportLink(drill.replenishment(), 'replenishment')
    assertReportLink(drill.replenishment({ itemId: 12 }), 'replenishment')
  })
})

describe('the figure and its destination agree', () => {
  const asOf = '2026-09-14'

  it('carries the as-at date, so the register total matches the card', () => {
    expect(parse(drill.stockValue({ asOf })).params.get('to')).toBe(asOf)
    expect(parse(drill.stockAgeing({ asOf })).params.get('as_of')).toBe(asOf)
    expect(parse(drill.warehouseStock({ asOf })).params.get('to')).toBe(asOf)
  })

  it('sorts the dearest item first for a value card and the largest for a quantity card', () => {
    expect(parse(drill.stockValue({ asOf })).params.get('sort')).toBe('closing_value')
    expect(parse(drill.stockValue({ asOf })).params.get('order')).toBe('desc')
    expect(parse(drill.stockQty({ asOf })).params.get('sort')).toBe('closing_qty')
  })

  it('filters the negative-stock drill-down to the rows below zero, most negative first', () => {
    const { params } = parse(drill.negativeStock())
    expect(params.get('negative')).toBe('1')
    expect(params.get('sort')).toBe('on_hand_qty')
    expect(params.get('order')).toBe('asc')
  })

  it('separates "expiring" from "expired": a window for one, expired-only for the other', () => {
    expect(parse(drill.nearExpiry({ days: 45 })).params.get('include_expired')).toBe('0')
    expect(parse(drill.nearExpiry({ days: 45 })).params.get('days')).toBe('45')
    // Not include_expired=1, which lists everything expiring in the window too
    // and leaves the register unable to reproduce the card's count.
    expect(parse(drill.expiredBatches()).params.get('expired_only')).toBe('1')
    expect(parse(drill.expiredBatches()).params.get('days')).toBeNull()
  })

  it('narrows movement analysis to the class that was clicked', () => {
    expect(parse(drill.movementAnalysis({ from: 'a', to: 'b', cls: 'dead' })).params.get('class')).toBe('dead')
  })

  it('keeps only_triggered on for the reorder card', () => {
    expect(parse(drill.replenishment()).params.get('only_triggered')).toBe('1')
  })
})

describe('list-screen drill-downs use each page FILTER_KEYS vocabulary', () => {
  it('documents by status', () => {
    expect(drill.documents({ status: 'FAILED' })).toBe('/documents?status=FAILED')
    expect(drill.documents()).toBe('/documents')
    expect(drill.document(42)).toBe('/documents/42')
  })

  it('stock ledger, movements and balances — the registers, not the retired pages', () => {
    expect(drill.itemLedger(9, { from: '2026-04-01', to: '2026-09-14' })).toBe(
      '/registers/stock-ledger?item_id=9&from=2026-04-01&to=2026-09-14',
    )
    expect(drill.stockMovements({ itemId: 9 })).toBe('/registers/movement-register?item_id=9')
    expect(drill.stockBalances({ warehouseId: 3 })).toBe(
      '/registers/stock-balances?warehouse_id=3&nonzero=1',
    )
    // Every key above has to be one the destination register declares.
    assertRegisterLink(drill.itemLedger(9, { from: '2026-04-01', to: '2026-09-14', warehouseId: 3 }), 'stock-ledger')
    assertRegisterLink(drill.stockMovements({ itemId: 9, documentId: 44, warehouseId: 3 }), 'movement-register')
    assertRegisterLink(drill.stockBalances({ warehouseId: 3, itemId: 9 }), 'stock-balances')
  })

  it('integration, valuation and reconciliation', () => {
    expect(drill.outbox('PENDING')).toBe('/integration/outbox?status=PENDING')
    expect(drill.revisions()).toBe('/valuation/revisions?acknowledged=0')
    expect(drill.recalculations('RUNNING')).toBe('/valuation/recalculations?status=RUNNING')
    expect(drill.reconciliationRun(5)).toBe('/reconciliation/5')
  })

  it('pending quantities by kind', () => {
    expect(drill.pendingQuantities('challan')).toBe('/registers/pending-quantities?kind=challan')
    expect(drill.pendingQuantities()).toBe('/registers/pending-quantities')
    assertRegisterLink(drill.pendingQuantities('challan'), 'pending-quantities')
  })

  it('does not attach an item status filter the items list would ignore', () => {
    expect(drill.items()).toBe('/items')
  })
})
