import { describe, expect, it } from 'vitest'
import type {
  CostLayerDistribution,
  CostLayerRow,
  CostLayersSummary,
  RecalcJob,
  ValuationRevision,
} from '../../../services/valuationApi'
import {
  activityEvents,
  costSpread,
  daysBetween,
  deriveInsight,
  detectExceptions,
  distributionSegments,
  openLayerCount,
  periodFor,
  periodOptions,
  toTime,
  weightedAverageCost,
} from './costLayersModel'

/**
 * The arithmetic the cost-layers screen prints.
 *
 * Every case below is one the valuation API can actually produce: a layer
 * migrated from Books with no opening quantity, an issue that went below zero,
 * a receipt entered a fortnight after its date, an item with exactly one layer.
 * The screen is only as honest as these.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 3, 20, 12, 0, 0) // 20 Apr 2026

function layer(over: Partial<CostLayerRow> = {}): CostLayerRow {
  return {
    layer_id: 1,
    fy_id: 3,
    item_id: 12,
    warehouse_id: 1,
    batch_id: null,
    layer_kind: 'receipt',
    qty_received: 1000,
    qty_remaining: 600,
    unit_cost: 1.25,
    received_at: '2026-04-12 10:05:00',
    source_document_id: 501,
    source_line_id: 9,
    created_at: '2026-04-12 10:05:00',
    warehouse_name: 'Main Warehouse',
    source_document_no: 'GRN-2026-0412',
    source_document_type: 'PURCHASE_RECEIPT',
    source_document_date: '2026-04-12',
    qty_consumed: 400,
    remaining_value: 750,
    consumptions: [],
    ...over,
  }
}

function summary(over: Partial<CostLayersSummary> = {}): CostLayersSummary {
  return {
    open_qty: 600,
    open_value: 750,
    backorder_qty: 0,
    layer_count: 4,
    received_qty: 4000,
    received_value: 8000,
    unit_cost_min: 1,
    unit_cost_max: 3,
    unit_cost_avg: 2,
    first_received_at: '2026-04-01 00:00:00',
    last_received_at: '2026-04-12 10:05:00',
    ...over,
  }
}

describe('toTime / daysBetween', () => {
  it('reads the space-separated timestamps the API sends', () => {
    expect(toTime('2026-04-12 10:05:00')).toBe(Date.parse('2026-04-12T10:05:00'))
  })

  it('returns null rather than NaN for anything unreadable', () => {
    expect(toTime(null)).toBeNull()
    expect(toTime('')).toBeNull()
    expect(toTime('not a date')).toBeNull()
  })

  it('floors the gap to whole days', () => {
    expect(daysBetween(NOW - DAY * 3 - 1000, NOW)).toBe(3)
  })
})

describe('periodOptions', () => {
  it('runs April to March for an Indian financial year, newest first', () => {
    const options = periodOptions('2026-04-01', '2027-03-31')
    expect(options).toHaveLength(13)
    expect(options[0]).toMatchObject({ value: '', label: 'Whole financial year' })
    expect(options[1]).toMatchObject({ value: '2027-03', from: '2027-03-01', to: '2027-03-31' })
    expect(options[12]).toMatchObject({ value: '2026-04', from: '2026-04-01', to: '2026-04-30' })
  })

  it('ends February on the 29th in a leap year', () => {
    const feb = periodOptions('2028-01-01', '2028-02-29').find((o) => o.value === '2028-02')
    expect(feb?.to).toBe('2028-02-29')
  })

  it('offers only the whole year when the range cannot be read', () => {
    expect(periodOptions('', '')).toHaveLength(1)
  })

  it('resolves a stored period, and nothing for one the year does not have', () => {
    const options = periodOptions('2026-04-01', '2027-03-31')
    expect(periodFor(options, '2026-04')?.to).toBe('2026-04-30')
    expect(periodFor(options, '2019-01')).toBeNull()
    expect(periodFor(options, '')).toBeNull()
  })
})

describe('distributionSegments', () => {
  const distribution: CostLayerDistribution = {
    layer_count: 10,
    total_qty: 4000,
    total_value: 18000,
    buckets: [
      { status: 'open', layer_count: 4, qty: 1800, value: 8250 },
      { status: 'partial', layer_count: 3, qty: 1200, value: 5760 },
      { status: 'closed', layer_count: 3, qty: 1000, value: 3960 },
      { status: 'negative', layer_count: 0, qty: 0, value: 0 },
    ],
  }

  it('splits by opening value and drops the states with no layers', () => {
    const segments = distributionSegments(distribution, 'value')
    expect(segments.map((s) => s.status)).toEqual(['open', 'partial', 'closed'])
    expect(segments[0].share).toBeCloseTo(45.9, 1)
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 6)
  })

  it('splits by quantity when asked', () => {
    const segments = distributionSegments(distribution, 'qty')
    expect(segments[0].amount).toBe(1800)
    expect(segments[0].share).toBeCloseTo(45, 6)
  })

  it('keeps a negative bucket signed but cannot push the bar past 100%', () => {
    const segments = distributionSegments(
      {
        layer_count: 2,
        total_qty: 0,
        total_value: 0,
        buckets: [
          { status: 'open', layer_count: 1, qty: 100, value: 300 },
          { status: 'negative', layer_count: 1, qty: -100, value: -100 },
        ],
      },
      'value',
    )
    expect(segments[1].amount).toBe(-100)
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 6)
  })

  it('is empty without a distribution rather than guessing one', () => {
    expect(distributionSegments(null, 'value')).toEqual([])
    expect(distributionSegments(undefined, 'value')).toEqual([])
  })
})

describe('costSpread', () => {
  it('measures the span against the dearest layer, so it stays inside 0-100%', () => {
    expect(costSpread(summary())?.spreadPct).toBeCloseTo(66.667, 3)
    // The case that made a span-over-average metric unreadable: a 0.85 layer
    // beside a 15.60 one reported 943.9% variance.
    expect(
      costSpread(summary({ unit_cost_min: 0.85, unit_cost_max: 15.6, unit_cost_avg: 1.5626 }))?.spreadPct,
    ).toBeCloseTo(94.551, 3)
  })

  it('refuses a spread on one layer, a costless item or a partial response', () => {
    expect(costSpread(summary({ layer_count: 1 }))).toBeNull()
    expect(costSpread(summary({ unit_cost_max: 0 }))).toBeNull()
    expect(costSpread(summary({ unit_cost_min: null }))).toBeNull()
    expect(costSpread({ open_qty: 0, open_value: 0, backorder_qty: 0 })).toBeNull()
    expect(costSpread(null)).toBeNull()
  })
})

describe('detectExceptions', () => {
  it('flags a negative balance as critical', () => {
    const found = detectExceptions([layer({ qty_remaining: -40, qty_received: null, layer_kind: 'backorder' })], { now: NOW })
    expect(found[0]).toMatchObject({ category: 'Negative stock layer', severity: 'critical' })
  })

  it('flags a receipt that opened with no cost', () => {
    const found = detectExceptions([layer({ unit_cost: 0 })], { now: NOW })
    expect(found.some((e) => e.category === 'Zero or negative unit cost')).toBe(true)
  })

  it('flags a layer far from the average unit cost, and leaves a close one alone', () => {
    const far = detectExceptions([layer({ unit_cost: 3 })], { now: NOW, avgUnitCost: 2, variancePct: 25 })
    expect(far.some((e) => e.category === 'Unit cost variance')).toBe(true)
    const near = detectExceptions([layer({ unit_cost: 2.1 })], { now: NOW, avgUnitCost: 2, variancePct: 25 })
    expect(near.some((e) => e.category === 'Unit cost variance')).toBe(false)
  })

  it('flags a receipt layer with no source document', () => {
    const found = detectExceptions([layer({ source_document_id: null })], { now: NOW })
    expect(found.some((e) => e.category === 'Missing receipt linkage')).toBe(true)
  })

  it('flags an expired batch only while the layer still holds stock', () => {
    const held = detectExceptions([layer({ expiry_date: '2026-01-31', batch_no: 'B1' })], { now: NOW })
    expect(held.some((e) => e.category === 'Expired batch still valued')).toBe(true)
    const emptied = detectExceptions([layer({ expiry_date: '2026-01-31', qty_remaining: 0, qty_consumed: 1000 })], { now: NOW })
    expect(emptied.some((e) => e.category === 'Expired batch still valued')).toBe(false)
  })

  it('calls an untouched old layer stale, and never a partly consumed one', () => {
    const stale = detectExceptions(
      [layer({ received_at: '2024-01-01 00:00:00', created_at: '2024-01-01 00:00:00', qty_consumed: 0, qty_remaining: 1000 })],
      { now: NOW, staleDays: 180 },
    )
    expect(stale.some((e) => e.category === 'Layer never consumed')).toBe(true)
    const working = detectExceptions(
      [layer({ received_at: '2024-01-01 00:00:00', created_at: '2024-01-01 00:00:00', qty_consumed: 400 })],
      { now: NOW, staleDays: 180 },
    )
    expect(working.some((e) => e.category === 'Layer never consumed')).toBe(false)
  })

  it('flags a receipt entered long after its own date', () => {
    const found = detectExceptions([layer({ received_at: '2026-03-01 00:00:00', created_at: '2026-04-12 10:05:00' })], { now: NOW })
    expect(found.some((e) => e.category === 'Backdated receipt')).toBe(true)
  })

  it('orders critical before low', () => {
    const found = detectExceptions(
      [
        layer({ layer_id: 1, received_at: '2024-01-01 00:00:00', created_at: '2024-01-01 00:00:00', qty_consumed: 0, qty_remaining: 5 }),
        layer({ layer_id: 2, qty_remaining: -3, qty_received: null }),
      ],
      { now: NOW },
    )
    expect(found[0].severity).toBe('critical')
  })

  it('finds nothing in a clean set', () => {
    expect(detectExceptions([layer()], { now: NOW, avgUnitCost: 1.25 })).toEqual([])
  })
})

describe('activityEvents', () => {
  const job = {
    job_id: 7,
    item_id: 12,
    status: 'COMPLETED',
    dry_run: false,
    from_date: '2026-04-01',
    affected_line_count: 10,
    revised_line_count: 4,
    finished_at: '2026-04-14 11:32:00',
    started_at: null,
    created_at: '2026-04-14 11:30:00',
    failure_reason: null,
    requested_by: 'Rohan Sharma',
  } as unknown as RecalcJob

  const revision = {
    revision_id: 3,
    document_id: 900,
    document_no: 'SO-2026-0412',
    old_valuation_rate: 1.2,
    new_valuation_rate: 1.25,
    created_at: '2026-04-13 09:00:00',
    acknowledged: true,
  } as unknown as ValuationRevision

  it('merges jobs, revisions, receipts and issues newest first', () => {
    const events = activityEvents({
      layers: [
        layer({
          consumptions: [
            {
              consumption_id: 55,
              layer_id: 1,
              document_id: 801,
              line_id: 1,
              movement_id: null,
              qty: 400,
              unit_cost: 1.25,
              amount: 500,
              created_at: '2026-04-12 15:21:00',
              document_no: 'SO-2026-0412',
              document_type: 'SALES',
              document_date: '2026-04-12',
              document_status: 'POSTED',
            },
          ],
        }),
      ],
      jobs: [job],
      revisions: [revision],
    })
    expect(events[0].kind).toBe('recalculation')
    expect(events.map((e) => e.kind)).toContain('issue')
    expect(events.map((e) => e.kind)).toContain('receipt')
  })

  it('marks a failed job so the timeline can colour it', () => {
    const events = activityEvents({
      layers: [],
      jobs: [{ ...job, status: 'FAILED', failure_reason: 'Period is locked' } as unknown as RecalcJob],
      revisions: [],
    })
    expect(events[0]).toMatchObject({ failed: true, detail: 'Period is locked' })
  })

  it('drops events with no timestamp instead of dating them now', () => {
    const events = activityEvents({ layers: [layer({ received_at: null, consumptions: [] })], jobs: [], revisions: [] })
    expect(events).toEqual([])
  })

  it('honours the limit', () => {
    const layers = Array.from({ length: 12 }, (_, i) => layer({ layer_id: i + 1 }))
    expect(activityEvents({ layers, jobs: [], revisions: [], limit: 4 })).toHaveLength(4)
  })
})

describe('weightedAverageCost', () => {
  it('weights by received quantity, not by layer', () => {
    const avg = weightedAverageCost([
      layer({ layer_id: 1, qty_received: 900, unit_cost: 1 }),
      layer({ layer_id: 2, qty_received: 100, unit_cost: 11 }),
    ])
    expect(avg).toBeCloseTo(2, 6)
  })

  it('is null when nothing was received', () => {
    expect(weightedAverageCost([layer({ qty_received: 0, qty_remaining: 0 })])).toBeNull()
    expect(weightedAverageCost([])).toBeNull()
  })
})

describe('deriveInsight', () => {
  it('leads with negative layers over everything else', () => {
    const rows = [layer({ layer_id: 1, qty_remaining: -20, qty_received: null })]
    const insight = deriveInsight(rows, summary(), detectExceptions(rows, { now: NOW }))
    expect(insight).toMatchObject({ key: 'negative', tone: 'critical' })
  })

  it('reports a cost move against the earlier layers', () => {
    const rows = [
      layer({ layer_id: 1, received_at: '2026-01-01 00:00:00', qty_received: 1000, unit_cost: 1 }),
      layer({ layer_id: 2, received_at: '2026-02-01 00:00:00', qty_received: 1000, unit_cost: 1 }),
      layer({ layer_id: 3, received_at: '2026-03-01 00:00:00', qty_received: 1000, unit_cost: 1.28 }),
      layer({ layer_id: 4, received_at: '2026-04-01 00:00:00', qty_received: 1000, unit_cost: 1.28 }),
    ]
    const insight = deriveInsight(rows, summary(), [], { now: NOW })
    expect(insight?.key).toBe('cost-move')
    expect(insight?.headline).toContain('28.0%')
    expect(insight?.headline).toContain('rose')
  })

  it('says nothing when the move is inside the threshold', () => {
    const rows = [
      layer({ layer_id: 1, received_at: '2026-01-01 00:00:00', qty_received: 1000, unit_cost: 1 }),
      layer({ layer_id: 2, received_at: '2026-02-01 00:00:00', qty_received: 1000, unit_cost: 1 }),
      layer({ layer_id: 3, received_at: '2026-03-01 00:00:00', qty_received: 1000, unit_cost: 1.02 }),
    ]
    expect(deriveInsight(rows, summary({ unit_cost_min: 1, unit_cost_max: 1.02, unit_cost_avg: 1.01 }), [], { now: NOW })).toBeNull()
  })

  it('needs more receipts than it compares before it says anything', () => {
    const rows = [
      layer({ layer_id: 1, received_at: '2026-03-01 00:00:00', qty_received: 1000, unit_cost: 1 }),
      layer({ layer_id: 2, received_at: '2026-04-01 00:00:00', qty_received: 1000, unit_cost: 9 }),
    ]
    expect(deriveInsight(rows, summary({ unit_cost_min: 1, unit_cost_max: 9, unit_cost_avg: 5 }), [], { now: NOW })?.key).not.toBe('cost-move')
  })

  it('falls back to the spread when nothing else stands out', () => {
    const insight = deriveInsight([], summary({ unit_cost_min: 1, unit_cost_max: 3, unit_cost_avg: 2 }), [], { now: NOW })
    expect(insight?.key).toBe('spread')
    expect(insight?.headline).toContain('66.7%')
  })

  it('returns nothing for a well-behaved item', () => {
    expect(deriveInsight([layer()], summary({ unit_cost_min: 1.2, unit_cost_max: 1.3, unit_cost_avg: 1.25 }), [], { now: NOW })).toBeNull()
  })
})

describe('openLayerCount', () => {
  it('counts open and partially consumed layers, not closed ones', () => {
    expect(
      openLayerCount({
        layer_count: 10,
        total_qty: 0,
        total_value: 0,
        buckets: [
          { status: 'open', layer_count: 4, qty: 0, value: 0 },
          { status: 'partial', layer_count: 3, qty: 0, value: 0 },
          { status: 'closed', layer_count: 3, qty: 0, value: 0 },
          { status: 'negative', layer_count: 0, qty: 0, value: 0 },
        ],
      }),
    ).toBe(7)
  })

  it('is null without a distribution', () => {
    expect(openLayerCount(null)).toBeNull()
  })
})
