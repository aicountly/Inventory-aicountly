import { describe, expect, it } from 'vitest'
import type { AgeBucketKey, StockAgeingSummary, StockHealthStatus } from '../../services/reportsApi'
import {
  AGE_BUCKET_META,
  AGE_BUCKET_ORDER,
  HEALTH_SCORE_WEIGHTS,
  HEALTH_STATUS_META,
  HEALTH_STATUS_ORDER,
  ageingObservations,
  bandFor,
  bucketSlices,
  itemGroupName,
  share,
  stockHealth,
  sumBuckets,
  warehouseName,
  worstForAgeing,
} from './stockAgeingModel'

/** A summary shaped like the endpoint's, with only the bands a test cares about set. */
function summaryOf(
  values: Partial<Record<AgeBucketKey, { qty?: number; value?: number; items?: number }>>,
  extra: Partial<StockAgeingSummary> = {},
): StockAgeingSummary {
  const buckets = {} as StockAgeingSummary['buckets']
  let qty = 0
  let value = 0
  for (const key of AGE_BUCKET_ORDER) {
    const b = values[key] ?? {}
    buckets[key] = { qty: b.qty ?? 0, value: b.value ?? 0, items: b.items ?? 0 }
    qty += buckets[key].qty
    value += buckets[key].value
  }
  const byHealth = {} as Record<StockHealthStatus, { items: number; value: number }>
  for (const status of HEALTH_STATUS_ORDER) byHealth[status] = { items: 0, value: 0 }
  return {
    items: 0,
    total_qty: qty,
    total_value: value,
    buckets,
    bucket_labels: {} as StockAgeingSummary['bucket_labels'],
    as_of: '2026-09-19',
    weighted_age_days: null,
    oldest_days: null,
    by_health: byHealth,
    by_warehouse: [],
    by_item_group: [],
    age_bucket: null,
    health: null,
    ...extra,
  }
}

describe('bands', () => {
  it('names every band, in age order, with a label that is never only a colour', () => {
    expect(AGE_BUCKET_ORDER).toEqual(['0_30', '31_60', '61_90', '91_180', '180_plus'])
    for (const key of AGE_BUCKET_ORDER) {
      const meta = AGE_BUCKET_META[key]
      expect(meta.key).toBe(key)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.srLabel).toContain('day')
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('gives every health word a label and a tone', () => {
    for (const status of HEALTH_STATUS_ORDER) {
      expect(HEALTH_STATUS_META[status].label.length).toBeGreaterThan(0)
      expect(HEALTH_STATUS_META[status].hint.length).toBeGreaterThan(0)
    }
  })
})

describe('share', () => {
  it('is a percentage, and is zero rather than Infinity when there is no total', () => {
    expect(share(25, 100)).toBe(25)
    expect(share(1, 0)).toBe(0)
    expect(share(1, -5)).toBe(0)
    expect(share(null, 100)).toBe(0)
  })
})

describe('bucketSlices', () => {
  it('always returns five bands, in age order, even when the server sent none', () => {
    const slices = bucketSlices(summaryOf({}))
    expect(slices.map((s) => s.key)).toEqual([...AGE_BUCKET_ORDER])
    expect(slices.every((s) => s.value === 0 && s.valuePercent === 0)).toBe(true)
  })

  it('takes each measure against its own total', () => {
    const slices = bucketSlices(
      summaryOf({
        '0_30': { qty: 30, value: 600, items: 3 },
        '180_plus': { qty: 10, value: 400, items: 1 },
      }),
    )
    const fresh = slices[0]
    expect(fresh.valuePercent).toBe(60)
    expect(fresh.qtyPercent).toBe(75)
    // Item shares are of the item count, which is NOT the quantity or the value.
    expect(fresh.itemsPercent).toBe(75)
    expect(slices[4].valuePercent).toBe(40)
  })
})

describe('sumBuckets', () => {
  it('adds one measure across the bands it is given', () => {
    const s = summaryOf({ '91_180': { value: 200, qty: 2 }, '180_plus': { value: 300, qty: 3 } })
    expect(sumBuckets(s, ['91_180', '180_plus'])).toBe(500)
    expect(sumBuckets(s, ['91_180', '180_plus'], 'qty')).toBe(5)
    expect(sumBuckets(s, [])).toBe(0)
  })
})

describe('stockHealth', () => {
  it('is 100 when every rupee of stock is inside the unpenalised bands', () => {
    const health = stockHealth(summaryOf({ '0_30': { value: 700 }, '31_60': { value: 300 } }))
    expect(health.score).toBe(100)
    expect(health.band.label).toBe('Excellent')
    expect(health.freshPercent).toBe(100)
    expect(health.percentOver90).toBe(0)
  })

  it('takes off exactly the stated weight for the share in each band', () => {
    // 20% at 91-180 (25) + 10% past 180 (60) = 5 + 6 = 11 points.
    const health = stockHealth(
      summaryOf({ '0_30': { value: 700 }, '91_180': { value: 200 }, '180_plus': { value: 100 } }),
    )
    expect(health.score).toBe(89)
    expect(health.valueOver90).toBe(300)
    expect(health.valueOver180).toBe(100)
    expect(health.percentOver90).toBeCloseTo(30)
    expect(health.terms.find((t) => t.key === '180_plus')?.penalty).toBeCloseTo(6)
    expect(health.terms.reduce((n, t) => n + t.penalty, 0)).toBeCloseTo(11)
  })

  it('clamps to zero rather than going negative on a wholly obsolete set', () => {
    const health = stockHealth(summaryOf({ '180_plus': { value: 1000 } }))
    expect(health.score).toBe(40)
    expect(health.band.label).toBe('At risk')
    const worse = stockHealth(summaryOf({ '61_90': { value: 1 }, '180_plus': { value: 0 } }))
    expect(worse.score).toBe(90)
  })

  it('reports no score at all when there is no stock value to judge', () => {
    const health = stockHealth(summaryOf({}))
    expect(health.score).toBeNull()
    expect(health.freshPercent).toBe(0)
  })

  it('only weights the bands the constant names, so the two cannot drift', () => {
    const weighted = stockHealth(summaryOf({ '0_30': { value: 100 } })).terms.map((t) => t.key)
    expect(weighted).toEqual(Object.keys(HEALTH_SCORE_WEIGHTS))
  })

  it('counts at-risk lines from the server’s own classification', () => {
    const health = stockHealth(
      summaryOf(
        { '180_plus': { value: 100 } },
        {
          by_health: {
            fresh: { items: 4, value: 0 },
            healthy: { items: 3, value: 0 },
            watch: { items: 2, value: 0 },
            slow: { items: 5, value: 0 },
            obsolete: { items: 6, value: 0 },
          },
        },
      ),
    )
    expect(health.obsoleteItems).toBe(6)
    expect(health.atRiskItems).toBe(11)
  })
})

describe('bandFor', () => {
  it('reads each boundary the way the labels promise', () => {
    expect(bandFor(100).label).toBe('Excellent')
    expect(bandFor(90).label).toBe('Excellent')
    expect(bandFor(89).label).toBe('Healthy')
    expect(bandFor(75).label).toBe('Healthy')
    expect(bandFor(74).label).toBe('Watch')
    expect(bandFor(60).label).toBe('Watch')
    expect(bandFor(59).label).toBe('At risk')
    expect(bandFor(40).label).toBe('At risk')
    expect(bandFor(39).label).toBe('Critical')
    expect(bandFor(0).label).toBe('Critical')
  })
})

describe('worstForAgeing', () => {
  const rows = [
    { warehouse_id: 1, warehouse_name: 'Main', items: 9, qty: 900, value: 90000, value_over_90: 1000, value_over_180: 100 },
    { warehouse_id: 2, warehouse_name: 'Overflow', items: 2, qty: 20, value: 4000, value_over_90: 3000, value_over_180: 2500 },
  ]

  it('ranks by the aged value, not by the size of the holding', () => {
    const worst = worstForAgeing(rows, warehouseName)
    expect(worst?.label).toBe('Overflow')
    expect(worst?.percentOfAtRisk).toBe(75)
  })

  it('can rank on the 180+ exposure instead', () => {
    expect(worstForAgeing(rows, warehouseName, 'value_over_180')?.label).toBe('Overflow')
  })

  it('takes the share against the total it is given, not the rows it was handed', () => {
    // The server bounds these lists: summing two of forty rows and calling it the whole
    // would report the leader as carrying far more of the ageing than it does.
    const capped = worstForAgeing(rows, warehouseName, 'value_over_90', 20000)
    expect(capped?.label).toBe('Overflow')
    expect(capped?.percentOfAtRisk).toBe(15)
  })

  it('never reports more than the whole, however the list was truncated', () => {
    expect(worstForAgeing(rows, warehouseName, 'value_over_90', 100)?.percentOfAtRisk).toBe(100)
  })

  it('names nobody when the whole it is measured against is zero', () => {
    expect(worstForAgeing(rows, warehouseName, 'value_over_90', 0)).toBeNull()
  })

  it('names nobody when nothing in the set is old', () => {
    expect(worstForAgeing([{ ...rows[0], value_over_90: 0, value_over_180: 0 }], warehouseName)).toBeNull()
    expect(worstForAgeing([], warehouseName)).toBeNull()
    expect(worstForAgeing(undefined, warehouseName)).toBeNull()
  })

  it('names a row the master could not, rather than printing "null"', () => {
    expect(warehouseName({ warehouse_id: null, warehouse_name: null, items: 0, qty: 0, value: 0, value_over_90: 0, value_over_180: 0 })).toBe('Unassigned')
    expect(warehouseName({ warehouse_id: 7, warehouse_name: null, items: 0, qty: 0, value: 0, value_over_90: 0, value_over_180: 0 })).toBe('Warehouse #7')
    expect(itemGroupName({ item_grp_id: null, grp_name: null, items: 0, qty: 0, value: 0, value_over_90: 0, value_over_180: 0 })).toBe('Ungrouped items')
  })
})

describe('ageingObservations', () => {
  it('states only what the summary supports, and never a trend', () => {
    const lines = ageingObservations(
      summaryOf(
        { '0_30': { value: 700 }, '91_180': { value: 200 }, '180_plus': { value: 100, qty: 4 } },
        {
          weighted_age_days: 67,
          total_qty: 100,
          by_warehouse: [
            { warehouse_id: 1, warehouse_name: 'Main', items: 4, qty: 10, value: 300, value_over_90: 280, value_over_180: 90 },
            { warehouse_id: 2, warehouse_name: 'Yard', items: 1, qty: 2, value: 20, value_over_90: 20, value_over_180: 10 },
          ],
          by_health: {
            fresh: { items: 1, value: 0 },
            healthy: { items: 1, value: 0 },
            watch: { items: 0, value: 0 },
            slow: { items: 0, value: 0 },
            obsolete: { items: 3, value: 0 },
          },
        },
      ),
    )
    expect(lines[0]).toBe('30.0% of stock value has been on hand for more than 90 days.')
    expect(lines.some((l) => l.startsWith('Main holds 93%'))).toBe(true)
    expect(lines.some((l) => l.includes('3 lines have'))).toBe(true)
    expect(lines.some((l) => l.includes('67 days old on average'))).toBe(true)
    // Nothing here may imply a comparison the endpoint never computed.
    expect(lines.join(' ')).not.toMatch(/vs|previous|last month|trend/i)
  })

  it('says nothing at all about an empty register', () => {
    expect(ageingObservations(summaryOf({}))).toEqual([])
  })

  it('leaves out a leader that leads nothing worth naming', () => {
    const lines = ageingObservations(
      summaryOf(
        { '0_30': { value: 1000 } },
        {
          by_warehouse: [
            { warehouse_id: 1, warehouse_name: 'Main', items: 1, qty: 1, value: 500, value_over_90: 0, value_over_180: 0 },
          ],
        },
      ),
    )
    expect(lines.some((l) => l.includes('Main'))).toBe(false)
  })
})
