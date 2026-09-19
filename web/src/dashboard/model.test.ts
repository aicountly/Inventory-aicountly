import { describe, expect, it } from 'vitest'
import {
  ageingSeries,
  buildKpiCards,
  documentStatusSeries,
  donutArcs,
  inboundSeries,
  movementSeries,
  outboxSeries,
  postedTypeSeries,
  pendingSeries,
  topShare,
  warehouseSeries,
} from './model'
import type { SeriesItem } from './model'
import type { DashboardData } from '../services/dashboard'
import type {
  MovementAnalysisSummary,
  StockAgeingSummary,
  WarehouseStockSummary,
} from '../services/reportsApi'
import type { ExpirySnapshot, ReplenishmentSnapshot, StockValueSnapshot } from './dashboardApi'

const ASOF = '2026-09-14'

function core(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    as_of: ASOF,
    fy_id: 3,
    bo_id: 0,
    masters: { items: { total: 120, active: 110 }, warehouses: { total: 4, active: 4 } },
    documents: {
      total: 42,
      by_status: { DRAFT: 3, POSTED: 30, PENDING_APPROVAL: 5, FAILED: 4, CANCELLED: 0 },
      pending_approval: 5,
      failed: 4,
      posted_by_type: { SALES_ISSUE: 20, PURCHASE_RECEIPT: 10 },
    },
    stock: {
      negative_stock_rows: 3,
      negative_stock_items: 2,
      near_expiry_batches: 7,
      expired_batches: 1,
      near_expiry_days: 30,
      pending_quantities: { challan: 4, job_work: 2, deferred_purchase: 0 },
    },
    integration: {
      outbox: { PENDING: 6, SENT: 40, ACKED: 38, FAILED: 2, DEAD: 0 },
      outbox_pending: 8,
      outbox_failed: 2,
      inbound: { RECEIVED: 10, PROCESSED: 9, FAILED: 1, IGNORED: 0 },
      unacknowledged_revisions: { count: 3, delta_total: 1250.5 },
      recalculations_in_progress: 1,
    },
    last_reconciliation: null,
    ...overrides,
  }
}

const stock: StockValueSnapshot = {
  summary: {
    items: 88,
    opening_qty: 0,
    in_qty: 500,
    out_qty: 200,
    closing_qty: 300,
    closing_value: 1_24_00_000,
    from: null,
    to: ASOF,
  },
  topItems: [],
  total: 88,
}

const expiry: ExpirySnapshot = {
  summary: {
    as_of: ASOF,
    days: 30,
    until: '2026-10-14',
    include_expired: true,
    batches: 9,
    items: 6,
    on_hand: 420,
    expired_batches: 2,
    expired_qty: 35,
  },
  rows: [],
  expiringSoon: 7,
  expired: 2,
}

const replenishment: ReplenishmentSnapshot = {
  summary: { triggered_total: 12, page_suggested_qty: 90, page_suggested_value: 45000, warehouse_id: null },
  rows: [],
  total: 12,
}

describe('buildKpiCards', () => {
  const loaded = buildKpiCards({ asOf: ASOF, nearExpiryDays: 30, core: core(), stock, expiry, replenishment })

  it('produces the eight headline figures', () => {
    expect(loaded.map((c) => c.key)).toEqual([
      'stock_value',
      'stock_qty',
      'items_in_stock',
      'reorder',
      'negative_stock',
      'expiring',
      'expired',
      'pending_approval',
    ])
  })

  it('gives every card a drill-down destination — no dead numbers', () => {
    for (const card of loaded) {
      expect(card.to, `${card.key} has nowhere to go`).toBeTruthy()
    }
  })

  it('formats each figure for its own unit', () => {
    expect(loaded[0].value).toBe('₹1.24 Cr')
    expect(loaded[1].value).toBe('300')
    expect(loaded[2].value).toBe('88')
    expect(loaded[3].value).toBe('12')
  })

  it('reads the expiry split off one payload rather than counting twice', () => {
    expect(loaded.find((c) => c.key === 'expiring')?.value).toBe('7')
    expect(loaded.find((c) => c.key === 'expired')?.value).toBe('2')
  })

  it('leaves a value null while its source is still loading, instead of showing a zero', () => {
    const partial = buildKpiCards({
      asOf: ASOF,
      nearExpiryDays: 30,
      core: null,
      stock: null,
      expiry: null,
      replenishment: null,
    })
    expect(partial.every((c) => c.value === null)).toBe(true)
    // …but the destinations are known up front, so the card is clickable as
    // soon as it renders.
    expect(partial.every((c) => Boolean(c.to))).toBe(true)
  })

  it('never fabricates a comparison figure', () => {
    // KpiCardSpec deliberately has no `previous`: the API sends no prior period,
    // so StatCard must render its hint line and no delta arrow.
    for (const card of loaded) {
      expect(card).not.toHaveProperty('previous')
    }
  })

  it('flags only the counts that need acting on', () => {
    const attention = loaded.filter((c) => c.attention).map((c) => c.key)
    expect(attention).toEqual(['reorder', 'negative_stock', 'expiring', 'expired', 'pending_approval'])
  })

  it('drops the alarm tone when the problem count is zero', () => {
    const clean = buildKpiCards({
      asOf: ASOF,
      nearExpiryDays: 30,
      core: core({
        documents: {
          total: 0,
          by_status: {},
          pending_approval: 0,
          failed: 0,
          posted_by_type: {},
        },
        stock: {
          negative_stock_rows: 0,
          negative_stock_items: 0,
          near_expiry_batches: 0,
          expired_batches: 0,
          near_expiry_days: 30,
          pending_quantities: {},
        },
      }),
      stock,
      expiry: { ...expiry, expiringSoon: 0, expired: 0 },
      replenishment: { ...replenishment, summary: { ...replenishment.summary, triggered_total: 0 } },
    })
    expect(clean.find((c) => c.key === 'negative_stock')?.tone).toBe('neutral')
    expect(clean.find((c) => c.key === 'expired')?.tone).toBe('neutral')
    expect(clean.some((c) => c.attention)).toBe(false)
  })

  it('counts the rows its register lists, not what nets out between warehouses', () => {
    // -5 in one warehouse and +12 in another: no item is net negative, but the
    // stock balance register the card opens with ?negative=1 lists that row.
    const netted = buildKpiCards({
      asOf: ASOF,
      nearExpiryDays: 30,
      core: core({
        stock: {
          negative_stock_rows: 1,
          negative_stock_items: 0,
          near_expiry_batches: 0,
          expired_batches: 0,
          near_expiry_days: 30,
          pending_quantities: {},
        },
      }),
      stock,
      expiry,
      replenishment,
    })
    const card = netted.find((c) => c.key === 'negative_stock')
    expect(card?.value, 'the headline is the row the register shows').toBe('1')
    expect(card?.tone).toBe('danger')
    expect(card?.attention).toBe(true)
    expect(card?.hint).toBe('0 items net below zero once warehouses offset')
  })

  it('names the window the expiry card counted', () => {
    const cards = buildKpiCards({ asOf: ASOF, nearExpiryDays: 90, core: core(), stock, expiry, replenishment })
    const card = cards.find((c) => c.key === 'expiring')!
    expect(card.label).toBe('Expiring in 90d')
    expect(card.to).toContain('days=90')
  })
})

describe('warehouseSeries', () => {
  const summary: WarehouseStockSummary = {
    rows: 3,
    items: 3,
    warehouses: 3,
    active_warehouses: 2,
    closing_qty: 300,
    closing_value: 1000,
    reserved_qty: 0,
    available_qty: 300,
    by_warehouse: [
      { warehouse_id: 2, warehouse_name: 'Pune', closing_qty: 100, closing_value: 250, items: 1 },
      { warehouse_id: 1, warehouse_name: 'Mumbai', closing_qty: 150, closing_value: 600, items: 1 },
      { warehouse_id: null, warehouse_name: null, closing_qty: 50, closing_value: 150, items: 1 },
    ],
    health: { negative: 0, out: 0, reorder: 0, low: 0, overstocked: 0, healthy: 3 },
    health_items: { negative: 0, out: 0, reorder: 0, low: 0, overstocked: 0, healthy: 3 },
    health_filter: null,
    method: 'AS_PER_MASTER',
    live_buckets: true,
    currency: 'INR',
    to: ASOF,
  }

  it('orders by value, biggest first', () => {
    expect(warehouseSeries(summary, ASOF).map((s) => s.label)).toEqual(['Mumbai', 'Pune', 'No warehouse'])
  })

  it('shares are of the company total, not of the visible page', () => {
    const series = warehouseSeries(summary, ASOF)
    expect(series[0].share).toBeCloseTo(60)
    expect(series[1].share).toBeCloseTo(25)
  })

  it('links each warehouse to its own register slice', () => {
    const series = warehouseSeries(summary, ASOF)
    expect(series[0].to).toContain('warehouse_id=1')
    expect(series[0].to).toContain(`to=${ASOF}`)
  })

  it('is empty, not a crash, before the request lands', () => {
    expect(warehouseSeries(null, ASOF)).toEqual([])
  })
})

describe('ageingSeries', () => {
  const summary: StockAgeingSummary = {
    items: 10,
    total_qty: 100,
    total_value: 1000,
    buckets: {
      '0_30': { qty: 40, value: 500 },
      '31_60': { qty: 20, value: 250 },
      '61_90': { qty: 10, value: 150 },
      '91_180': { qty: 20, value: 100 },
      '180_plus': { qty: 10, value: 0 },
    },
    bucket_labels: {
      '0_30': '0-30 days',
      '31_60': '31-60 days',
      '61_90': '61-90 days',
      '91_180': '91-180 days',
      '180_plus': '180+ days',
    },
    as_of: ASOF,
  }

  it('keeps the buckets in age order, including empty ones', () => {
    const series = ageingSeries(summary, ASOF)
    expect(series.map((s) => s.key)).toEqual(['0_30', '31_60', '61_90', '91_180', '180_plus'])
    expect(series[4].value).toBe(0)
  })

  it('escalates the tone as stock gets older', () => {
    expect(ageingSeries(summary, ASOF).map((s) => s.tone)).toEqual([
      'success',
      'info',
      'warning',
      'danger',
      'critical',
    ])
  })

  it('scales the bar against the biggest bucket and the share against the total', () => {
    const series = ageingSeries(summary, ASOF)
    expect(series[0].scale).toBe(100)
    expect(series[1].scale).toBe(50)
    expect(series[0].share).toBeCloseTo(50)
  })

  it('shows the quantity behind the value', () => {
    expect(ageingSeries(summary, ASOF)[0].sub).toBe('40 units')
  })
})

describe('movementSeries', () => {
  const summary: MovementAnalysisSummary = {
    from: '2026-04-01',
    to: ASOF,
    thresholds: { fast_days: 30, slow_days: 90, dead_days: 180 },
    by_class: {
      fast: { items: 20, on_hand: 500, period_out_qty: 300 },
      slow: { items: 10, on_hand: 200, period_out_qty: 40 },
      non_moving: { items: 5, on_hand: 90, period_out_qty: 0 },
      dead: { items: 5, on_hand: 60, period_out_qty: 0 },
    },
  }

  it('keeps fast → dead order and links each class to its filtered register', () => {
    const series = movementSeries(summary)
    expect(series.map((s) => s.key)).toEqual(['fast', 'slow', 'non_moving', 'dead'])
    expect(series[3].to).toContain('class=dead')
    expect(series[3].to).toContain('from=2026-04-01')
  })

  it('shares add up across the four classes', () => {
    const series = movementSeries(summary)
    expect(series.reduce((a, s) => a + s.share, 0)).toBeCloseTo(100)
  })
})

describe('documentStatusSeries', () => {
  it('drops zero-count statuses and sorts by count', () => {
    const series = documentStatusSeries(core().documents.by_status)
    expect(series.map((s) => s.key)).toEqual(['POSTED', 'PENDING_APPROVAL', 'FAILED', 'DRAFT'])
  })

  it('labels statuses in human words but links with the API value', () => {
    const failed = documentStatusSeries(core().documents.by_status).find((s) => s.key === 'FAILED')!
    expect(failed.label).toBe('Failed')
    expect(failed.to).toBe('/documents?status=FAILED')
  })

  it('handles a missing payload', () => {
    expect(documentStatusSeries(null)).toEqual([])
    expect(documentStatusSeries({})).toEqual([])
  })
})

describe('the masters counters still reach the page', () => {
  it('says how many warehouses the quantity is spread across', () => {
    const card = buildKpiCards({
      asOf: ASOF,
      nearExpiryDays: 30,
      core: core(),
      stock,
      expiry,
      replenishment,
    }).find((c) => c.key === 'stock_qty')!
    expect(card.hint).toBe('Base units across 4 active warehouses')
  })

  it('falls back to a figure-free hint until the payload lands', () => {
    const card = buildKpiCards({
      asOf: ASOF,
      nearExpiryDays: 30,
      core: null,
      stock,
      expiry,
      replenishment,
    }).find((c) => c.key === 'stock_qty')!
    expect(card.hint).toBe('Base units across all warehouses')
  })
})

describe('postedTypeSeries', () => {
  it('shows what was actually raised, biggest first, and links each type', () => {
    const series = postedTypeSeries(core().documents.posted_by_type)
    expect(series.map((s) => s.key)).toEqual(['SALES_ISSUE', 'PURCHASE_RECEIPT'])
    expect(series[0].to).toBe('/documents?document_type=SALES_ISSUE')
    expect(series[0].label).not.toBe('SALES_ISSUE')
  })

  it('keeps the share honest when the list is capped', () => {
    const many = { A: 10, B: 8, C: 6, D: 4, E: 3, F: 2, G: 1 }
    const series = postedTypeSeries(many, 3)
    expect(series).toHaveLength(3)
    // 10 of 34, not 10 of the 24 on screen.
    expect(series[0].share).toBeCloseTo((10 / 34) * 100, 5)
  })

  it('handles a missing payload', () => {
    expect(postedTypeSeries(null)).toEqual([])
    expect(postedTypeSeries({})).toEqual([])
  })
})

describe('inboundSeries', () => {
  it('reports the half of the sync that comes from Books', () => {
    const series = inboundSeries(core().integration.inbound)
    expect(series.map((s) => s.key)).toEqual(['RECEIVED', 'PROCESSED', 'FAILED'])
    expect(series.find((s) => s.key === 'FAILED')?.tone).toBe('critical')
  })

  it('links nowhere, because there is no inbound screen to land on', () => {
    expect(inboundSeries(core().integration.inbound).every((s) => s.to === undefined)).toBe(true)
  })
})

describe('outboxSeries / pendingSeries', () => {
  it('colours a dead outbox event as critical and a failure as a warning', () => {
    const series = outboxSeries(core().integration.outbox)
    expect(series.find((s) => s.key === 'FAILED')?.tone).toBe('warning')
    expect(series.find((s) => s.key === 'DEAD')).toBeUndefined() // zero rows drop out
  })

  it('links pending quantities by kind', () => {
    const series = pendingSeries(core().stock.pending_quantities)
    expect(series.map((s) => s.key)).toEqual(['challan', 'job_work'])
    expect(series[0].to).toBe('/registers/pending-quantities?kind=challan')
  })
})

describe('donutArcs', () => {
  const item = (key: string, value: number): SeriesItem => ({
    key,
    label: key,
    value,
    display: String(value),
    share: 0,
    scale: 0,
    tone: 'primary',
  })

  it('lays arcs end to end around the circle', () => {
    const arcs = donutArcs([item('a', 50), item('b', 30), item('c', 20)])
    expect(arcs.map((a) => Math.round(a.percent))).toEqual([50, 30, 20])
    expect(arcs.map((a) => Math.round(a.offset))).toEqual([0, 50, 80])
    const last = arcs[arcs.length - 1]
    expect(last.offset + last.percent).toBeCloseTo(100)
  })

  it('sorts biggest first so the eye starts at the largest slice', () => {
    expect(donutArcs([item('small', 10), item('big', 90)]).map((a) => a.key)).toEqual(['big', 'small'])
  })

  it('drops zero and negative slices, which a donut cannot draw', () => {
    const arcs = donutArcs([item('a', 50), item('zero', 0), item('neg', -10)])
    expect(arcs.map((a) => a.key)).toEqual(['a'])
    expect(arcs[0].percent).toBeCloseTo(100)
  })

  it('rolls the long tail into one "Other" slice so the legend stays readable', () => {
    const arcs = donutArcs(
      [item('a', 50), item('b', 40), item('c', 30), item('d', 20), item('e', 10), item('f', 5), item('g', 5)],
      6,
    )
    expect(arcs).toHaveLength(6)
    expect(arcs[5].key).toBe('__other__')
    // 5 real slices + the tail: f(5) and g(5) out of a 160 total.
    expect(arcs[5].label).toBe('Other (2)')
    expect(arcs[5].percent).toBeCloseTo((10 / 160) * 100)
  })

  it('does not roll a tail of one — that would hide a real slice behind "Other"', () => {
    const arcs = donutArcs([item('a', 50), item('b', 40), item('c', 30)], 3)
    expect(arcs.map((a) => a.key)).toEqual(['a', 'b', 'c'])
  })

  it('is empty for an empty series', () => {
    expect(donutArcs([])).toEqual([])
  })
})

describe('topShare', () => {
  const item = (key: string, value: number): SeriesItem => ({
    key,
    label: key,
    value,
    display: '',
    share: 0,
    scale: 0,
    tone: 'primary',
  })

  it('names the biggest slice and its share of the whole', () => {
    expect(topShare([item('a', 30), item('b', 70)])).toEqual({ label: 'b', share: 70 })
  })

  it('is null when there is nothing positive to report', () => {
    expect(topShare([])).toBeNull()
    expect(topShare([item('a', 0)])).toBeNull()
  })
})
