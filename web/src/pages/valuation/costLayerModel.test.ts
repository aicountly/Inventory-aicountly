import { describe, expect, it } from 'vitest'
import type { CostLayerRow, RecalcJob, ValuationRevision } from '../../services/valuationApi'
import {
  AGING_DAYS,
  buildActivity,
  buildExceptions,
  buildInsights,
  consumedQty,
  costStats,
  daysSince,
  highValueThreshold,
  isRefinementActive,
  layerDistribution,
  layerStatus,
  matchesRefinement,
  quickFilter,
  refineLayers,
} from './costLayerModel'

const NOW = new Date('2026-09-19T00:00:00Z')

function layer(over: Partial<CostLayerRow> = {}): CostLayerRow {
  return {
    layer_id: 1,
    fy_id: 3,
    item_id: 12,
    warehouse_id: 4,
    batch_id: null,
    layer_kind: 'receipt',
    qty_received: 100,
    qty_remaining: 40,
    unit_cost: 25,
    received_at: '2026-06-01',
    source_document_id: 700,
    source_line_id: 1,
    created_at: '2026-06-01 10:00:00',
    warehouse_name: 'Central store',
    source_document_no: 'GRN-1',
    source_document_type: 'goods_receipt',
    source_document_date: '2026-06-01',
    qty_consumed: 60,
    remaining_value: 1000,
    consumptions: [],
    ...over,
  }
}

describe('layerStatus', () => {
  it('reads the quantities for the three ordinary states', () => {
    expect(layerStatus(layer({ qty_received: 100, qty_remaining: 100, qty_consumed: 0 }))).toBe('open')
    expect(layerStatus(layer({ qty_received: 100, qty_remaining: 40, qty_consumed: 60 }))).toBe('partial')
    expect(layerStatus(layer({ qty_received: 100, qty_remaining: 0, qty_consumed: 100 }))).toBe('closed')
  })

  it('calls a layer negative whatever else is true of it', () => {
    // Part-consumed AND below zero: the state a controller has to act on wins,
    // or the only row that matters is filed under "partially consumed".
    expect(layerStatus(layer({ qty_remaining: -20, qty_consumed: 30 }))).toBe('negative')
    expect(layerStatus(layer({ layer_kind: 'backorder', qty_remaining: -5 }))).toBe('negative')
  })

  it('keeps a revaluation layer distinguishable from a receipt', () => {
    expect(layerStatus(layer({ layer_kind: 'revaluation', qty_remaining: 10 }))).toBe('revised')
  })
})

describe('consumedQty', () => {
  it('prefers the server figure', () => {
    expect(consumedQty(layer({ qty_consumed: 60 }))).toBe(60)
  })

  it('derives it from received minus remaining when the server omits it', () => {
    expect(consumedQty(layer({ qty_consumed: null, qty_received: 90, qty_remaining: 25 }))).toBe(65)
  })

  it('falls back to the consumption rows when neither is available', () => {
    const row = layer({
      qty_consumed: null,
      qty_received: null,
      consumptions: [
        { consumption_id: 1, layer_id: 1, document_id: 5, line_id: 1, movement_id: 1, qty: 4, unit_cost: 2, amount: 8, created_at: null, document_no: 'DN-5', document_type: 'delivery_note', document_date: '2026-07-01', document_status: 'POSTED' },
        { consumption_id: 2, layer_id: 1, document_id: 6, line_id: 1, movement_id: 2, qty: 6, unit_cost: 2, amount: 12, created_at: null, document_no: 'DN-6', document_type: 'delivery_note', document_date: '2026-07-02', document_status: 'POSTED' },
      ],
    })
    expect(consumedQty(row)).toBe(10)
  })
})

describe('layerDistribution', () => {
  const rows = [
    layer({ layer_id: 1, qty_received: 100, qty_remaining: 100, qty_consumed: 0, unit_cost: 10 }),
    layer({ layer_id: 2, qty_received: 100, qty_remaining: 50, qty_consumed: 50, unit_cost: 10 }),
    layer({ layer_id: 3, qty_received: 200, qty_remaining: 0, qty_consumed: 200, unit_cost: 10 }),
  ]

  it('measures receipt value so a closed layer still has a share', () => {
    // The whole point: a band drawn on REMAINING value reports closed as 0%,
    // and "how much of this item's cost has reached COGS" becomes undrawable.
    const { segments, total } = layerDistribution(rows, 'value')
    expect(total).toBe(4000)
    expect(segments.map((s) => [s.status, Math.round(s.share)])).toEqual([
      ['open', 25],
      ['partial', 25],
      ['closed', 50],
    ])
  })

  it('measures quantity on the same basis', () => {
    const { segments, total } = layerDistribution(rows, 'qty')
    expect(total).toBe(400)
    expect(segments.find((s) => s.status === 'closed')?.amount).toBe(200)
  })

  it('returns nothing rather than dividing by zero', () => {
    expect(layerDistribution([], 'value')).toEqual({ segments: [], total: 0 })
  })
})

describe('costStats', () => {
  it('weights the average by what is still on hand, not by what was received', () => {
    const rows = [
      layer({ layer_id: 1, qty_remaining: 10, unit_cost: 10 }),
      layer({ layer_id: 2, qty_remaining: 30, unit_cost: 20 }),
      // Closed layers hold no stock, so they cannot move the average of what does.
      layer({ layer_id: 3, qty_remaining: 0, unit_cost: 1000 }),
    ]
    const stats = costStats(rows)
    expect(stats.openLayers).toBe(2)
    expect(stats.totalLayers).toBe(3)
    expect(stats.openQty).toBe(40)
    expect(stats.weightedAvgCost).toBe(17.5)
    expect(stats.minUnitCost).toBe(10)
    expect(stats.maxUnitCost).toBe(20)
    expect(stats.spreadPct).toBeCloseTo((10 / 17.5) * 100, 5)
  })

  it('reports no spread when nothing is on hand', () => {
    const stats = costStats([layer({ qty_remaining: 0 })])
    expect(stats.weightedAvgCost).toBeNull()
    expect(stats.spreadPct).toBeNull()
  })
})

describe('daysSince', () => {
  it('counts whole days and tolerates a timestamp', () => {
    expect(daysSince('2026-09-09', NOW)).toBe(10)
    expect(daysSince('2026-09-19 14:30:00', NOW)).toBe(0)
  })

  it('returns null rather than a number for an unusable date', () => {
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })
})

describe('matchesRefinement', () => {
  it('is inactive, and passes everything, when nothing is set', () => {
    expect(isRefinementActive({})).toBe(false)
    expect(refineLayers([layer()], {}, NOW)).toHaveLength(1)
  })

  it('includes the last day of a received-to window', () => {
    // `received_at` can carry a time; a bare `<=` on the date would drop it.
    const row = layer({ received_at: '2026-06-30 18:00:00' })
    expect(matchesRefinement(row, { receivedTo: '2026-06-30' }, NOW)).toBe(true)
    expect(matchesRefinement(row, { receivedTo: '2026-06-29' }, NOW)).toBe(false)
  })

  it('filters on the cost band, the batch and the missing document', () => {
    expect(matchesRefinement(layer({ unit_cost: 25 }), { costMin: 30 }, NOW)).toBe(false)
    expect(matchesRefinement(layer({ unit_cost: 25 }), { costMin: 10, costMax: 30 }, NOW)).toBe(true)
    expect(matchesRefinement(layer({ batch_id: 9 }), { batchId: 9 }, NOW)).toBe(true)
    expect(matchesRefinement(layer({ batch_id: null }), { batchId: 9 }, NOW)).toBe(false)
    expect(matchesRefinement(layer({ source_document_id: 700 }), { unlinkedOnly: true }, NOW)).toBe(false)
    expect(matchesRefinement(layer({ source_document_id: null }), { unlinkedOnly: true }, NOW)).toBe(true)
  })

  it('treats a zero cost band as a real bound, not as "unset"', () => {
    expect(matchesRefinement(layer({ unit_cost: 5 }), { costMax: 0 }, NOW)).toBe(false)
    expect(matchesRefinement(layer({ unit_cost: 0 }), { costMax: 0 }, NOW)).toBe(true)
  })

  it('counts a layer as ageing only while it still holds stock', () => {
    const old = { received_at: '2025-01-01' }
    expect(matchesRefinement(layer({ ...old, qty_remaining: 5 }), { agingDays: AGING_DAYS }, NOW)).toBe(true)
    expect(matchesRefinement(layer({ ...old, qty_remaining: 0 }), { agingDays: AGING_DAYS }, NOW)).toBe(false)
  })
})

describe('quick filters', () => {
  it('asks the server for closed and negative layers with open-only OFF', () => {
    /*
     * The server reads `open_only` as `qty_remaining > 0`. A negative layer has
     * a NEGATIVE remainder, so these two chips leaving the toggle on would ask
     * for rows the query has just been told to exclude — the chip would come
     * back empty on exactly the item it exists to surface.
     */
    expect(quickFilter('negative').server?.open_only).toBe('0')
    expect(quickFilter('closed').server?.open_only).toBe('0')
    expect(quickFilter('negative').server?.layer_kind).toBe('backorder')
    expect(quickFilter('partial').server?.open_only).toBe('1')
  })

  it('falls back to "all layers" for an unknown chip in the URL', () => {
    expect(quickFilter('nonsense').key).toBe('all')
    expect(quickFilter(undefined).key).toBe('all')
  })
})

describe('highValueThreshold', () => {
  it('declines to rank fewer than five layers', () => {
    expect(highValueThreshold([layer(), layer(), layer()])).toBeNull()
  })

  it('cuts at the eightieth percentile of remaining value', () => {
    const rows = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v, i) =>
      layer({ layer_id: i + 1, remaining_value: v }),
    )
    expect(highValueThreshold(rows)).toBe(90)
  })
})

describe('buildInsights', () => {
  const ctx = { itemName: 'Paracetamol 500mg', now: NOW }

  it('says nothing when nothing is unusual', () => {
    const rows = [
      layer({ layer_id: 1, unit_cost: 10, received_at: '2026-08-01', qty_remaining: 10 }),
      layer({ layer_id: 2, unit_cost: 10.2, received_at: '2026-08-15', qty_remaining: 10 }),
      layer({ layer_id: 3, unit_cost: 10.1, received_at: '2026-09-01', qty_remaining: 10 }),
    ]
    expect(buildInsights(rows, ctx)).toEqual([])
  })

  it('measures the newest receipt against the average of the ones before it', () => {
    const rows = [
      layer({ layer_id: 1, unit_cost: 10, qty_received: 100, received_at: '2026-08-01' }),
      layer({ layer_id: 2, unit_cost: 10, qty_received: 100, received_at: '2026-08-10' }),
      layer({ layer_id: 3, unit_cost: 14, qty_received: 100, received_at: '2026-09-01' }),
    ]
    const found = buildInsights(rows, ctx).find((i) => i.key === 'cost_increase')
    expect(found).toBeDefined()
    expect(found?.title).toContain('40.0%')
    // The finding has to carry the figures it was computed from, so a reader
    // can check it against the table instead of trusting it.
    expect(found?.detail).toContain('10.0000')
  })

  it('raises a negative layer as critical', () => {
    const found = buildInsights([layer({ qty_remaining: -25, layer_kind: 'backorder' })], ctx)
    expect(found[0].key).toBe('negative_layer')
    expect(found[0].severity).toBe('critical')
    expect(found[0].detail).toContain('25')
  })

  it('flags a receipt taken in at no cost', () => {
    const rows = [layer({ unit_cost: 0, qty_received: 50, qty_remaining: 50 })]
    expect(buildInsights(rows, ctx).some((i) => i.key === 'zero_cost')).toBe(true)
  })

  it('flags stock nobody has touched for half a year', () => {
    const rows = [layer({ received_at: '2025-01-01', qty_remaining: 40, qty_consumed: 0, remaining_value: 400 })]
    const found = buildInsights(rows, ctx).find((i) => i.key === 'stale_layer')
    expect(found?.severity).toBe('warning')
  })

  it('compares the same item across warehouses', () => {
    const rows = [
      layer({ layer_id: 1, warehouse_name: 'Central store', unit_cost: 10, qty_remaining: 10, received_at: '2026-09-01' }),
      layer({ layer_id: 2, warehouse_name: 'Depot', unit_cost: 13, qty_remaining: 10, received_at: '2026-09-02' }),
    ]
    const found = buildInsights(rows, ctx).find((i) => i.key === 'warehouse_spread')
    expect(found?.detail).toContain('Depot')
  })
})

describe('buildExceptions', () => {
  const ctx = { itemName: 'Paracetamol 500mg', now: NOW }

  function job(over: Partial<RecalcJob> = {}): RecalcJob {
    return {
      job_id: 7,
      status: 'FAILED',
      failure_reason: 'Period is locked',
      from_date: '2026-04-01',
      dry_run: false,
      item_id: null,
      item_name: null,
      created_at: '2026-09-01 08:00:00',
      finished_at: '2026-09-01 08:00:40',
      ...over,
    } as RecalcJob
  }

  function revision(over: Partial<ValuationRevision> = {}): ValuationRevision {
    return {
      revision_id: 3,
      acknowledged: false,
      delta_amount: -120.5,
      created_at: '2026-09-02 09:00:00',
      ...over,
    } as ValuationRevision
  }

  it('puts the critical findings first', () => {
    const rows = [
      layer({ layer_id: 1, qty_remaining: -10 }),
      layer({ layer_id: 2, unit_cost: 0, qty_received: 10, qty_remaining: 10 }),
    ]
    const found = buildExceptions(rows, [], [], ctx)
    expect(found[0].severity).toBe('critical')
    expect(found.map((e) => e.category)).toContain('Zero-cost receipt')
  })

  it('reports a layer whose consumption exceeds what it received', () => {
    const rows = [layer({ qty_received: 10, qty_consumed: 25, qty_remaining: 0 })]
    const found = buildExceptions(rows, [], [], ctx)
    expect(found.some((e) => e.category === 'Consumption exceeds receipt')).toBe(true)
  })

  it('reports a receipt layer with no source document', () => {
    const rows = [layer({ source_document_id: null, source_document_no: null })]
    expect(buildExceptions(rows, [], [], ctx).some((e) => e.category === 'Missing receipt linkage')).toBe(true)
  })

  it('carries a failed recalculation and unacknowledged revisions through', () => {
    const found = buildExceptions([], [job()], [revision(), revision({ revision_id: 4 })], ctx)
    const failed = found.find((e) => e.category === 'Failed recalculation')
    expect(failed?.reason).toBe('Period is locked')
    const pending = found.find((e) => e.category === 'Revision awaiting Books')
    expect(pending?.document).toBe('2 revisions')
    expect(pending?.impact).toContain('-241.00')
  })

  it('ignores a completed job and an acknowledged revision', () => {
    const found = buildExceptions([], [job({ status: 'COMPLETED', failure_reason: null })], [revision({ acknowledged: true })], ctx)
    expect(found).toEqual([])
  })
})

describe('buildActivity', () => {
  it('merges receipts, issues, jobs and revisions newest first', () => {
    const rows = [
      layer({
        layer_id: 1,
        received_at: '2026-09-01',
        consumptions: [
          { consumption_id: 1, layer_id: 1, document_id: 5, line_id: 1, movement_id: 1, qty: 60, unit_cost: 25, amount: 1500, created_at: null, document_no: 'DN-5', document_type: 'delivery_note', document_date: '2026-09-05', document_status: 'POSTED' },
        ],
      }),
    ]
    const jobs = [{ job_id: 7, status: 'COMPLETED', created_at: '2026-09-10 08:00:00', finished_at: '2026-09-10 08:01:00', revised_line_count: 4, affected_line_count: 9, dry_run: false, item_id: null } as RecalcJob]
    const revisions = [{ revision_id: 3, created_at: '2026-09-12 09:00:00', old_valuation_rate: 25, new_valuation_rate: 26, acknowledged: false, document_no: 'DN-5', document_id: 5 } as ValuationRevision]

    const events = buildActivity(rows, jobs, revisions)
    expect(events.map((e) => e.kind)).toEqual(['revision', 'recalculation', 'issue', 'receipt'])
    expect(events[3].detail).toContain('Central store')
  })

  it('honours the limit so the rail cannot grow without bound', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      layer({ layer_id: i + 1, received_at: `2026-0${(i % 9) + 1}-01`, consumptions: [] }),
    )
    expect(buildActivity(rows, [], [], 5)).toHaveLength(5)
  })

  it('skips a record with no usable timestamp rather than sorting it to the top', () => {
    const rows = [layer({ received_at: null })]
    expect(buildActivity(rows, [], [])).toEqual([])
  })
})
