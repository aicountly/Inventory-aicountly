import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AGE_BUCKET_HEX,
  AGE_BUCKET_TONES,
  HEALTH_BANDS,
  HEALTH_BAND_META,
  HEALTH_PENALTY,
  HEALTH_STATUS_META,
  HEALTH_STATUS_ORDER,
  ageingBreakdown,
  ageingInsights,
  ageingNote,
  capitalAtRisk,
  exposureLabel,
  formatAgeDays,
  formatShare,
  share,
} from './ageingModel'
import { AGE_BUCKET_ORDER } from '../../reports/helpers'
import type { AgeBucketKey, StockAgeingSummary } from '../../services/reportsApi'

const PHP_SERVICE = fileURLToPath(
  new URL('../../../../server-php/app/Services/InventoryReportService.php', import.meta.url),
)

function summary(overrides: Partial<StockAgeingSummary> = {}): StockAgeingSummary {
  const buckets = {
    '0_30': { qty: 120, value: 36000, items: 3 },
    '31_60': { qty: 80, value: 24000, items: 2 },
    '61_90': { qty: 40, value: 12000, items: 2 },
    '91_180': { qty: 20, value: 6000, items: 1 },
    '180_plus': { qty: 10, value: 22000, items: 1 },
  }
  return {
    items: 4,
    total_qty: 270,
    total_value: 100000,
    buckets,
    bucket_labels: {
      '0_30': '0-30 days',
      '31_60': '31-60 days',
      '61_90': '61-90 days',
      '91_180': '91-180 days',
      '180_plus': '180+ days',
    },
    as_of: '2026-09-19',
    weighted_age_days: 52,
    oldest_days: 410,
    value_over_90: 28000,
    value_over_180: 22000,
    qty_over_90: 30,
    qty_over_180: 10,
    by_health: { fresh: 1, healthy: 1, watch: 1, slow: 0, obsolete: 1 },
    health_score: 79,
    health_band: 'healthy',
    age_bucket: null,
    health_status: null,
    warehouses: [
      { warehouse_id: 1, warehouse_name: 'Main WH', total_qty: 200, total_value: 70000, value_over_90: 21000, value_over_180: 18000, weighted_age_days: 61 },
      { warehouse_id: 2, warehouse_name: 'Secondary WH', total_qty: 70, total_value: 30000, value_over_90: 7000, value_over_180: 4000, weighted_age_days: 33 },
    ],
    item_groups: [
      { item_grp_id: 9, grp_name: 'Electrical components', total_qty: 90, total_value: 44000, value_over_90: 19000, value_over_180: 15000, weighted_age_days: 88 },
    ],
    ...overrides,
  }
}

const EMPTY = summary({
  items: 0,
  total_qty: 0,
  total_value: 0,
  buckets: Object.fromEntries(
    AGE_BUCKET_ORDER.map((k) => [k, { qty: 0, value: 0, items: 0 }]),
  ) as StockAgeingSummary['buckets'],
  weighted_age_days: null,
  oldest_days: null,
  value_over_90: 0,
  value_over_180: 0,
  qty_over_90: 0,
  qty_over_180: 0,
  by_health: { fresh: 0, healthy: 0, watch: 0, slow: 0, obsolete: 0 },
  health_score: null,
  health_band: null,
  warehouses: [],
  item_groups: [],
})

describe('the ageing palette', () => {
  it('covers every bucket, in ageing order, in both a tone and a hex', () => {
    expect(Object.keys(AGE_BUCKET_TONES)).toEqual(AGE_BUCKET_ORDER)
    expect(Object.keys(AGE_BUCKET_HEX)).toEqual(AGE_BUCKET_ORDER)
    // Five distinct colours: two buckets sharing one would make the donut unreadable.
    expect(new Set(Object.values(AGE_BUCKET_HEX)).size).toBe(AGE_BUCKET_ORDER.length)
  })
})

describe('the health rules restated for the explanation panel', () => {
  const php = readFileSync(PHP_SERVICE, 'utf8')

  it('carries the same penalties as InventoryReportService', () => {
    const line = php.match(/public const HEALTH_PENALTY = \[(.*?)\];/)?.[1]
    expect(line, 'HEALTH_PENALTY not found in the PHP service').toBeTruthy()
    const fromPhp: Record<string, number> = {}
    for (const [, key, weight] of (line as string).matchAll(/'([^']+)'\s*=>\s*([0-9.]+)/g)) {
      fromPhp[key] = Number(weight)
    }
    expect(fromPhp).toEqual(
      Object.fromEntries(Object.entries(HEALTH_PENALTY).map(([k, v]) => [k, Number(v)])),
    )
  })

  it('carries the same band floors as InventoryReportService', () => {
    const line = php.match(/public const HEALTH_BANDS = \[(.*?)\];/)?.[1]
    expect(line, 'HEALTH_BANDS not found in the PHP service').toBeTruthy()
    const fromPhp: Record<string, number> = {}
    for (const [, key, floor] of (line as string).matchAll(/'([^']+)'\s*=>\s*([0-9.]+)/g)) {
      fromPhp[key] = Number(floor)
    }
    expect(fromPhp).toEqual(HEALTH_BANDS)
  })

  it('names every status and every band the server can send', () => {
    const statuses = php.match(/public const HEALTH_STATUSES = \[(.*?)\];/)?.[1] ?? ''
    const fromPhp = [...statuses.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...HEALTH_STATUS_ORDER].sort()).toEqual([...fromPhp].sort())
    expect(Object.keys(HEALTH_STATUS_META).sort()).toEqual([...fromPhp].sort())
    // `critical` is the PHP fallback below the lowest floor, so it has no entry there.
    expect(Object.keys(HEALTH_BAND_META).sort()).toEqual(
      [...Object.keys(HEALTH_BANDS), 'critical'].sort(),
    )
  })
})

describe('share and the formatters', () => {
  it('never divides by zero', () => {
    expect(share(5, 0)).toBe(0)
    expect(share(0, 0)).toBe(0)
    expect(share(Number.NaN, 10)).toBe(0)
    expect(share(25, 200)).toBe(12.5)
  })

  it('prints one decimal and pluralises days', () => {
    expect(formatShare(14.86)).toBe('14.9%')
    expect(formatShare(Number.NaN)).toBe('—')
    expect(formatAgeDays(1)).toBe('1 day')
    expect(formatAgeDays(67)).toBe('67 days')
    expect(formatAgeDays(null)).toBe('—')
  })
})

describe('ageingBreakdown', () => {
  it('keeps ageing order whatever the sizes, so red always means old', () => {
    const view = ageingBreakdown(summary())
    expect(view.map((b) => b.key)).toEqual(AGE_BUCKET_ORDER)
    // 180+ holds more value than 91-180 here; a size-sorted chart would swap them.
    expect(view[4].value).toBeGreaterThan(view[3].value)
    expect(view[4].hex).toBe(AGE_BUCKET_HEX['180_plus'])
  })

  it('shares sum to 100 and the largest bucket sets the scale', () => {
    const view = ageingBreakdown(summary())
    expect(view.reduce((a, b) => a + b.share, 0)).toBeCloseTo(100, 6)
    expect(Math.max(...view.map((b) => b.scale))).toBe(100)
  })

  it('switches the drawn figure with the metric but keeps every column', () => {
    const byItems = ageingBreakdown(summary(), 'items')
    expect(byItems.map((b) => b.metric)).toEqual([3, 2, 2, 1, 1])
    expect(byItems.reduce((a, b) => a + b.share, 0)).toBeCloseTo(100, 6)
    const byQty = ageingBreakdown(summary(), 'qty')
    expect(byQty.map((b) => b.metric)).toEqual([120, 80, 40, 20, 10])
    // The tooltip always states all three, whichever metric is drawn.
    expect(byQty[0].tooltip).toContain('120 qty')
    expect(byQty[0].tooltip).toContain('3 items')
  })

  it('draws nothing and divides by nothing on an empty register', () => {
    const view = ageingBreakdown(EMPTY)
    expect(view).toHaveLength(AGE_BUCKET_ORDER.length)
    expect(view.every((b) => b.share === 0 && b.scale === 0)).toBe(true)
  })

  it('prefers the server label over the built-in one', () => {
    const relabelled = summary({
      bucket_labels: {
        ...summary().bucket_labels,
        '180_plus': 'Over six months',
      } as Record<AgeBucketKey, string>,
    })
    expect(ageingBreakdown(relabelled)[4].label).toBe('Over six months')
  })
})

describe('capitalAtRisk', () => {
  it('reports the server totals and their shares', () => {
    const risk = capitalAtRisk(summary())
    expect(risk.over90).toBe(28000)
    expect(risk.over180).toBe(22000)
    expect(risk.over90Share).toBeCloseTo(28, 6)
    expect(risk.over180Share).toBeCloseTo(22, 6)
    // Fresh is the two unpenalised bands — the score's own working.
    expect(risk.freshShare).toBeCloseTo(60, 6)
    expect(risk.watchShare).toBeCloseTo(12, 6)
    expect(risk.slowShare).toBeCloseTo(6, 6)
    // The four shares the health panel prints are the whole of the stock value.
    expect(risk.freshShare + risk.watchShare + risk.slowShare + risk.obsoleteShare).toBeCloseTo(100, 6)
    expect(risk.obsoleteShare).toBeCloseTo(22, 6)
  })

  it('is all zeroes rather than NaN when there is no stock', () => {
    const risk = capitalAtRisk(EMPTY)
    expect(Object.values(risk).every((n) => Number.isFinite(n))).toBe(true)
    expect(risk.over90Share).toBe(0)
  })
})

describe('ageingInsights', () => {
  it('states only what the summary supports', () => {
    const insights = ageingInsights(summary())
    const keys = insights.map((i) => i.key)
    expect(keys).toContain('over90')
    expect(keys).toContain('warehouse')
    expect(keys).toContain('group')
    expect(insights.find((i) => i.key === 'warehouse')?.label).toContain('Main WH')
    expect(insights.find((i) => i.key === 'group')?.label).toContain('Electrical components')
    expect(insights.find((i) => i.key === 'obsolete-items')?.label).toBe('1 item is classed obsolete')
  })

  it('drops the breakdown lines when the server withholds them', () => {
    const narrowed = summary({ warehouses: [], item_groups: [], age_bucket: '180_plus' })
    const keys = ageingInsights(narrowed).map((i) => i.key)
    expect(keys).not.toContain('warehouse')
    expect(keys).not.toContain('group')
    expect(keys).toContain('over90')
  })

  it('escalates the tone with the exposure rather than by guesswork', () => {
    const calm = ageingInsights(summary({ value_over_90: 0, total_value: 100000 }))
    expect(calm[0].tone).toBe('success')
    const alarming = ageingInsights(summary({ value_over_90: 60000, total_value: 100000 }))
    expect(alarming[0].tone).toBe('danger')
  })

  it('says nothing at all about an empty register', () => {
    expect(ageingNote(EMPTY)).toBeUndefined()
    expect(ageingInsights(EMPTY).map((i) => i.key)).not.toContain('obsolete-items')
  })

  it('only congratulates when there really is nothing past 90 days', () => {
    expect(ageingNote(summary())).toBeUndefined()
    expect(ageingNote(summary({ value_over_90: 0 }))).toBe('No capital stranded past 90 days.')
  })
})

describe('exposureLabel', () => {
  it('reads either dimension and never renders an empty cell', () => {
    expect(exposureLabel({ warehouse_name: 'Main WH', total_qty: 0, total_value: 0, value_over_90: 0, value_over_180: 0, weighted_age_days: null })).toBe('Main WH')
    expect(exposureLabel({ grp_name: 'Cables', total_qty: 0, total_value: 0, value_over_90: 0, value_over_180: 0, weighted_age_days: null })).toBe('Cables')
    expect(exposureLabel({ total_qty: 0, total_value: 0, value_over_90: 0, value_over_180: 0, weighted_age_days: null })).toBe('Unassigned')
  })
})
