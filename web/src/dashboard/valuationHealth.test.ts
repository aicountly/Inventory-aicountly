import { describe, expect, it } from 'vitest'
import {
  atRiskRows,
  deltaPercent,
  insightChips,
  previousPeriodEnd,
  riskAttentionCount,
  stockHealth,
  suggestedActions,
  topItemConcentration,
  warehouseConcentration,
} from './valuationHealth'
import type { ValuationHealthInput } from './valuationHealth'
import type { MovementAnalysisSummary, StockAgeingSummary, StockSummaryRow, WarehouseStockSummary } from '../services/reportsApi'
import type { ValuationBridgeData } from './aggregatesApi'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ageing(overrides: Partial<StockAgeingSummary> = {}): StockAgeingSummary {
  return {
    items: 20,
    total_qty: 1000,
    total_value: 1_000_000,
    buckets: {
      '0_30': { qty: 500, value: 500_000 },
      '31_60': { qty: 250, value: 250_000 },
      '61_90': { qty: 150, value: 150_000 },
      '91_180': { qty: 60, value: 60_000 },
      '180_plus': { qty: 40, value: 40_000 },
    },
    bucket_labels: {
      '0_30': '0–30 days',
      '31_60': '31–60 days',
      '61_90': '61–90 days',
      '91_180': '91–180 days',
      '180_plus': '180+ days',
    },
    as_of: '2026-09-19',
    ...overrides,
  } as StockAgeingSummary
}

function movement(overrides: Partial<MovementAnalysisSummary> = {}): MovementAnalysisSummary {
  return {
    from: '2026-04-01',
    to: '2026-09-19',
    thresholds: { fast_days: 30, slow_days: 60, dead_days: 180 },
    by_class: {
      fast: { items: 18, on_hand: 900, period_out_qty: 400 },
      slow: { items: 1, on_hand: 60, period_out_qty: 5 },
      non_moving: { items: 1, on_hand: 40, period_out_qty: 0 },
      dead: { items: 0, on_hand: 0, period_out_qty: 0 },
    },
    ...overrides,
  }
}

function expiry(expiringSoon = 0, expired = 0) {
  return {
    summary: {
      as_of: '2026-09-19',
      days: 30,
      until: '2026-10-19',
      include_expired: true,
      batches: expiringSoon + expired,
      items: 0,
      on_hand: 0,
      expired_batches: expired,
      expired_qty: 0,
    },
    expiringSoon,
    expired,
  }
}

function item(id: number, value: number): StockSummaryRow {
  return {
    item_id: id,
    item_name: `Item ${id}`,
    item_alias: null,
    item_sku: null,
    unit_id: 1,
    unit_symbol: 'Nos',
    item_grp_id: null,
    stock_cat_id: null,
    opening_qty: 0,
    in_qty: 0,
    out_qty: 0,
    closing_qty: 10,
    unit_cost: value / 10,
    closing_value: value,
    valuation_method_applied: 'FIFO',
  }
}

function warehouses(): WarehouseStockSummary {
  return {
    rows: 3,
    closing_qty: 1000,
    closing_value: 1_000_000,
    by_warehouse: [
      { warehouse_id: 1, warehouse_name: 'Main', closing_qty: 600, closing_value: 600_000 },
      { warehouse_id: 2, warehouse_name: 'Secondary', closing_qty: 300, closing_value: 300_000 },
      { warehouse_id: 3, warehouse_name: 'Transit', closing_qty: 100, closing_value: 100_000 },
    ],
    to: '2026-09-19',
  }
}

function bridge(unvalued = 0): ValuationBridgeData {
  return {
    from: '2026-04-01',
    to: '2026-09-19',
    warehouse_id: null,
    opening: { value: 900_000, state: 'ready', definition: 'opening' },
    closing: { value: 1_000_000, state: 'ready', definition: 'closing' },
    components: {
      inward: { net: 300_000, gross_in: 300_000, gross_out: 0, movements: 20 },
      outward: { net: -200_000, gross_in: 0, gross_out: 200_000, movements: 15 },
      transfer: { net: 0, gross_in: 0, gross_out: 0, movements: 4 },
      adjustment: { net: 0, gross_in: 0, gross_out: 0, movements: 0 },
      other: { net: 0, gross_in: 0, gross_out: 0, movements: 0 },
    },
    reversals: { net: 0, movements: 0 },
    revaluations: { net: 0, movements: 0 },
    unvalued_movements: unvalued,
    definition: 'opening + inward - outward +/- adjustments = closing',
  }
}

function input(overrides: Partial<ValuationHealthInput> = {}): ValuationHealthInput {
  return {
    stock: {
      closingValue: 1_000_000,
      closingQty: 1000,
      items: 20,
      topItems: [item(1, 200_000), item(2, 150_000), item(3, 100_000), item(4, 80_000), item(5, 70_000)],
    },
    ageing: ageing(),
    movement: movement(),
    expiry: expiry(),
    warehouses: warehouses(),
    bridge: bridge(),
    negativeAgeingBuckets: 0,
    asOf: '2026-09-19',
    period: { from: '2026-04-01', to: '2026-09-19' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------

describe('the stock health score', () => {
  it('scores a healthy position high and names every factor', () => {
    const health = stockHealth(input())
    expect(health.score).not.toBeNull()
    expect(health.score as number).toBeGreaterThanOrEqual(70)
    expect(health.assessed).toBe(health.total)
    expect(health.factors.map((f) => f.key)).toEqual([
      'ageing',
      'slow_moving',
      'non_moving',
      'expiry',
      'concentration',
      'exceptions',
    ])
  })

  it('never opens at 100 when nothing could be read', () => {
    // The failure mode this guards: a company whose every report 403s being
    // congratulated on perfect stock health.
    const health = stockHealth(
      input({ stock: null, ageing: null, movement: null, expiry: null, warehouses: null, bridge: null }),
    )
    expect(health.score).toBeNull()
    expect(health.assessed).toBe(0)
    expect(health.label).toContain('still being calculated')
  })

  it('scores over the factors it could read, and says how many that was', () => {
    const health = stockHealth(input({ movement: null, expiry: null }))
    expect(health.score).not.toBeNull()
    expect(health.assessed).toBe(3)
    expect(health.total).toBe(6)
  })

  it('is driven down by old stock, and says so', () => {
    const aged = stockHealth(
      input({
        ageing: ageing({
          buckets: {
            ...ageing().buckets,
            '0_30': { qty: 100, value: 100_000 },
            '180_plus': { qty: 600, value: 600_000 },
          } as StockAgeingSummary['buckets'],
        }),
      }),
    )
    const fresh = stockHealth(input())
    expect(aged.score as number).toBeLessThan(fresh.score as number)
    expect(aged.summary.toLowerCase()).toContain('ageing')
  })

  it('is driven down by non-moving items more than by slow-moving ones', () => {
    const slow = stockHealth(
      input({ movement: movement({ by_class: { ...movement().by_class, fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 20, on_hand: 100, period_out_qty: 0 } } }) }),
    )
    const stalled = stockHealth(
      input({ movement: movement({ by_class: { ...movement().by_class, fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 0, on_hand: 0, period_out_qty: 0 }, non_moving: { items: 20, on_hand: 100, period_out_qty: 0 } } }) }),
    )
    expect(stalled.score as number).toBeLessThan(slow.score as number)
  })

  it('stays inside 0 and 100 however bad the position is', () => {
    const worst = stockHealth(
      input({
        ageing: ageing({ buckets: { ...ageing().buckets, '0_30': { qty: 0, value: 0 }, '31_60': { qty: 0, value: 0 }, '61_90': { qty: 0, value: 0 }, '91_180': { qty: 0, value: 0 }, '180_plus': { qty: 1000, value: 1_000_000 } } as StockAgeingSummary['buckets'] }),
        movement: movement({ by_class: { fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 10, on_hand: 0, period_out_qty: 0 }, non_moving: { items: 10, on_hand: 0, period_out_qty: 0 }, dead: { items: 10, on_hand: 0, period_out_qty: 0 } } }),
        expiry: expiry(50, 50),
        stock: { closingValue: 1_000_000, closingQty: 10, items: 5, topItems: [item(1, 1_000_000)] },
        bridge: bridge(400),
        negativeAgeingBuckets: 5,
      }),
    )
    expect(worst.score).toBeGreaterThanOrEqual(0)
    expect(worst.score).toBeLessThanOrEqual(100)
    expect(worst.label).toContain('poor')
  })

  it('treats an empty company as assessed, not as unknown', () => {
    // Nothing on hand is a real answer and scores clean; it must not read as
    // "we could not tell".
    const empty = stockHealth(
      input({
        stock: { closingValue: 0, closingQty: 0, items: 0, topItems: [] },
        ageing: ageing({ total_value: 0, buckets: { '0_30': { qty: 0, value: 0 }, '31_60': { qty: 0, value: 0 }, '61_90': { qty: 0, value: 0 }, '91_180': { qty: 0, value: 0 }, '180_plus': { qty: 0, value: 0 } } as StockAgeingSummary['buckets'] }),
        movement: movement({ by_class: { fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 0, on_hand: 0, period_out_qty: 0 }, non_moving: { items: 0, on_hand: 0, period_out_qty: 0 }, dead: { items: 0, on_hand: 0, period_out_qty: 0 } } }),
      }),
    )
    expect(empty.assessed).toBe(empty.total)
    expect(empty.score).toBe(100)
  })
})

describe('the exceptions factor', () => {
  it('does not report a bridge figure it never read', () => {
    // "0 movements carry no value" is a clean bill of health for a question
    // nobody asked when the bridge request failed.
    const health = stockHealth(input({ bridge: null }))
    const exceptions = health.factors.find((f) => f.key === 'exceptions')
    expect(exceptions?.detail).not.toContain('movements carry no value')
    expect(exceptions?.detail).toContain('age buckets')
  })

  it('does not read "no negative buckets" out of an ageing report that failed', () => {
    const health = stockHealth(input({ ageing: null }))
    const exceptions = health.factors.find((f) => f.key === 'exceptions')
    expect(exceptions?.detail).not.toContain('age buckets')
    expect(exceptions?.detail).toContain('movements carry no value')
  })

  it('is unassessed only when both of its sources failed', () => {
    const neither = stockHealth(input({ bridge: null, ageing: null }))
    expect(neither.factors.find((f) => f.key === 'exceptions')?.penalty).toBeNull()

    const one = stockHealth(input({ bridge: null }))
    expect(one.factors.find((f) => f.key === 'exceptions')?.penalty).not.toBeNull()
  })

  it('counts a negative bucket against the score', () => {
    const clean = stockHealth(input())
    const withNegatives = stockHealth(input({ negativeAgeingBuckets: 2 }))
    expect(withNegatives.score as number).toBeLessThan(clean.score as number)
  })
})

describe('concentration', () => {
  it('measures the top items against the company total, not against themselves', () => {
    const c = topItemConcentration([item(1, 600_000), item(2, 100_000)], 1_000_000)
    expect(c?.share).toBeCloseTo(70, 5)
    expect(c?.items).toBe(2)
  })

  it('is unanswerable rather than 0% when the total is nil or unknown', () => {
    expect(topItemConcentration([item(1, 100)], 0)).toBeNull()
    expect(topItemConcentration([item(1, 100)], null)).toBeNull()
    expect(topItemConcentration([], 1_000_000)).toBeNull()
  })

  it('needs more than one warehouse before calling a split a concentration', () => {
    expect(warehouseConcentration({ ...warehouses(), by_warehouse: [warehouses().by_warehouse[0]] })).toBeNull()
    expect(warehouseConcentration(warehouses())?.share).toBeCloseTo(60, 5)
  })
})

describe('at-risk inventory', () => {
  it('reports a clean risk as low rather than omitting it', () => {
    const rows = atRiskRows(input())
    expect(rows.find((r) => r.key === 'expiry')?.level).toBe('low')
    expect(rows.find((r) => r.key === 'expiry')?.detail).toContain('No batches expiring')
  })

  it('omits a risk whose source could not be read, instead of calling it low', () => {
    // "Low" and "we could not check" look identical on a badge and mean
    // opposite things.
    const rows = atRiskRows(input({ expiry: null, movement: null }))
    expect(rows.map((r) => r.key)).not.toContain('expiry')
    expect(rows.map((r) => r.key)).not.toContain('slow_moving')
  })

  it('ranks an expired batch above everything else', () => {
    const rows = atRiskRows(input({ expiry: expiry(2, 3) }))
    expect(rows[0].key).toBe('expiry')
    expect(rows[0].level).toBe('critical')
  })

  it('counts only the rows that are actually risks', () => {
    expect(riskAttentionCount(atRiskRows(input({ expiry: expiry(0, 0) })))).toBeLessThan(
      riskAttentionCount(atRiskRows(input({ expiry: expiry(4, 1) }))),
    )
  })

  it('gives every row a destination that reproduces it', () => {
    for (const row of atRiskRows(input({ expiry: expiry(1, 1), bridge: bridge(3), negativeAgeingBuckets: 1 }))) {
      expect(row.to, `${row.key} has no drill-through`).toBeTruthy()
      expect(row.to).toMatch(/^\/(reports|registers)\//)
    }
  })
})

describe('suggested actions', () => {
  it('suggests nothing when nothing needs attention', () => {
    const clean = input({
      movement: movement({
        by_class: {
          fast: { items: 20, on_hand: 1000, period_out_qty: 500 },
          slow: { items: 0, on_hand: 0, period_out_qty: 0 },
          non_moving: { items: 0, on_hand: 0, period_out_qty: 0 },
          dead: { items: 0, on_hand: 0, period_out_qty: 0 },
        },
      }),
      // Twenty items of equal value — no concentration to report.
      stock: {
        closingValue: 1_000_000,
        closingQty: 1000,
        items: 20,
        topItems: [item(1, 50_000), item(2, 50_000), item(3, 50_000), item(4, 50_000), item(5, 50_000)],
      },
      ageing: ageing({
        buckets: {
          ...ageing().buckets,
          '91_180': { qty: 0, value: 0 },
          '180_plus': { qty: 0, value: 0 },
        } as StockAgeingSummary['buckets'],
      }),
    })
    expect(suggestedActions(clean)).toHaveLength(0)
  })

  it('leaves a couple of slow SKUs in a large catalogue alone', () => {
    // 3 of 1,000 items is arithmetic, not a finding worth a pill.
    const big = input({
      movement: movement({
        by_class: {
          fast: { items: 997, on_hand: 10_000, period_out_qty: 5_000 },
          slow: { items: 3, on_hand: 20, period_out_qty: 1 },
          non_moving: { items: 0, on_hand: 0, period_out_qty: 0 },
          dead: { items: 0, on_hand: 0, period_out_qty: 0 },
        },
      }),
    })
    expect(atRiskRows(big).find((r) => r.key === 'slow_moving')?.level).toBe('low')
  })

  it('suggests at most three, each with a real destination', () => {
    const actions = suggestedActions(
      input({
        expiry: expiry(6, 2),
        movement: movement({ by_class: { fast: { items: 1, on_hand: 1, period_out_qty: 0 }, slow: { items: 9, on_hand: 10, period_out_qty: 0 }, non_moving: { items: 9, on_hand: 10, period_out_qty: 0 }, dead: { items: 1, on_hand: 1, period_out_qty: 0 } } }),
        bridge: bridge(5),
      }),
    )
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.length).toBeLessThanOrEqual(3)
    for (const a of actions) expect(a.to).toBeTruthy()
  })

  it('counts the SKUs it names', () => {
    const actions = suggestedActions(
      input({
        movement: movement({ by_class: { ...movement().by_class, fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 12, on_hand: 10, period_out_qty: 0 } } }),
      }),
    )
    expect(actions.find((a) => a.key === 'slow_moving')?.label).toBe('Review 12 slow-moving SKUs')
  })
})

describe('insight chips', () => {
  it('emits nothing derived from a figure it does not have', () => {
    const chips = insightChips(input({ stock: null, warehouses: null, expiry: null, movement: null, ageing: null }))
    expect(chips).toHaveLength(0)
  })

  it('never claims a period-on-period movement', () => {
    // No source on this dashboard returns a previous period, so no chip may
    // imply one ("dead stock down 8%").
    for (const chip of insightChips(input({ expiry: expiry(3, 1) }))) {
      expect(chip.label).not.toMatch(/\b(up|down|vs|versus|since last)\b/i)
    }
  })

  it('caps the strip so it stays a summary', () => {
    expect(insightChips(input({ expiry: expiry(3, 2) })).length).toBeLessThanOrEqual(4)
  })
})

describe('prior-period comparison', () => {
  it('steps back one month', () => {
    expect(previousPeriodEnd('2026-09-19', '2026-04-01')).toBe('2026-08-19')
  })

  it('clamps into a shorter month rather than overflowing into the next', () => {
    // 31 March back one month is 28 February, not 3 March.
    expect(previousPeriodEnd('2026-03-31', '2025-04-01')).toBe('2026-02-28')
  })

  it('offers no comparison against a date outside the financial year', () => {
    expect(previousPeriodEnd('2026-04-15', '2026-04-01')).toBeNull()
  })

  it('refuses a malformed date', () => {
    expect(previousPeriodEnd('not-a-date', '2026-04-01')).toBeNull()
  })

  it('reports a direction without a rate when the earlier figure was zero', () => {
    // Every increase from nothing is infinite; `Infinity%` on a finance card is
    // worse than no chip at all.
    expect(deltaPercent(500, 0)).toEqual({ percent: null, direction: 'up' })
  })

  it('is null when either side is unknown', () => {
    expect(deltaPercent(500, null)).toBeNull()
    expect(deltaPercent(null, 500)).toBeNull()
    expect(deltaPercent(500, Number.NaN)).toBeNull()
  })

  it('measures a fall as a negative percentage', () => {
    const d = deltaPercent(80, 100)
    expect(d?.direction).toBe('down')
    expect(d?.percent).toBeCloseTo(-20, 5)
  })

  it('reads a movement away from a negative base by magnitude', () => {
    // -100 to -50 is an improvement of 50%, not of -50%.
    const d = deltaPercent(-50, -100)
    expect(d?.direction).toBe('up')
    expect(d?.percent).toBeCloseTo(50, 5)
  })
})
