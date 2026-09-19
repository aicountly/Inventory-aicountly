import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stockAgeingConfig } from './stockAgeing'
import { registerColumnPrefsKey, registerPermission, registerRoute } from '../../registers/RegisterConfig'
import {
  AGE_BUCKET_ORDER,
  HEALTH_STATUS_ORDER,
} from '../../registers/ageing/stockAgeingModel'
import type {
  AgeBucketKey,
  StockAgeingRow,
  StockAgeingSummary,
  StockHealthStatus,
} from '../../services/reportsApi'

const SERVICE = new URL('../../../../server-php/app/Services/InventoryReportService.php', import.meta.url).pathname

function summary(over: Partial<StockAgeingSummary> = {}): StockAgeingSummary {
  const buckets = {} as StockAgeingSummary['buckets']
  for (const key of AGE_BUCKET_ORDER) buckets[key] = { qty: 0, value: 0, items: 0 }
  buckets['0_30'] = { qty: 60, value: 600, items: 6 }
  buckets['91_180'] = { qty: 20, value: 250, items: 2 }
  buckets['180_plus'] = { qty: 20, value: 150, items: 2 }
  const byHealth = {} as Record<StockHealthStatus, { items: number; value: number }>
  for (const s of HEALTH_STATUS_ORDER) byHealth[s] = { items: 0, value: 0 }
  byHealth.slow = { items: 2, value: 250 }
  byHealth.obsolete = { items: 2, value: 150 }
  return {
    items: 10,
    total_qty: 100,
    total_value: 1000,
    buckets,
    bucket_labels: {} as StockAgeingSummary['bucket_labels'],
    as_of: '2026-09-19',
    weighted_age_days: 67,
    oldest_days: 240,
    by_health: byHealth,
    by_warehouse: [
      { warehouse_id: 1, warehouse_name: 'Main WH', items: 8, qty: 80, value: 800, value_over_90: 380, value_over_180: 140 },
      { warehouse_id: 2, warehouse_name: 'Yard', items: 2, qty: 20, value: 200, value_over_90: 20, value_over_180: 10 },
    ],
    by_item_group: [
      { item_grp_id: 3, grp_name: 'Electrical', items: 5, qty: 50, value: 500, value_over_90: 300, value_over_180: 140 },
    ],
    age_bucket: null,
    health: null,
    ...over,
  }
}

function row(over: Partial<StockAgeingRow> = {}): StockAgeingRow {
  const buckets = {} as StockAgeingRow['buckets']
  for (const key of AGE_BUCKET_ORDER) buckets[key] = { qty: 0, value: 0 }
  buckets['0_30'] = { qty: 120, value: 36000 }
  return {
    item_id: 1,
    item_name: 'LED Panel Light 12W',
    item_alias: null,
    item_sku: 'ITM-001',
    hsn_sac: '940540',
    unit_id: 1,
    unit_symbol: 'Nos',
    item_grp_id: 3,
    grp_name: 'Electrical',
    stock_cat_id: null,
    warehouse_id: 4,
    warehouse_name: 'Main WH',
    buckets,
    total_qty: 120,
    total_value: 36000,
    oldest_days: 22,
    newest_days: 2,
    weighted_age_days: 12,
    layers: 3,
    aged_from: null,
    health_status: 'fresh',
    ...over,
  }
}

const columnKeys = new Set(stockAgeingConfig.columns.map((c) => c.key))

describe('stock ageing register', () => {
  it('keeps the route, the slug and the permission it has always had', () => {
    // A bookmark, a dashboard drill-down and a role permission all name this register by
    // these three strings. The screen was redesigned; its identity was not.
    expect(stockAgeingConfig.path).toBe('stock-ageing')
    expect(registerRoute(stockAgeingConfig)).toBe('/registers/stock-ageing')
    expect(stockAgeingConfig.slug).toBe('stock_ageing')
    expect(registerPermission(stockAgeingConfig)).toBe('reports.stock_ageing.read')
  })

  it('takes a fresh column-preference key, because the grid it saves changed shape', () => {
    expect(registerColumnPrefsKey(stockAgeingConfig)).toBe('stock_ageing.v2')
  })

  it('shows the five paired band cells and ships the split ones hidden', () => {
    for (const key of AGE_BUCKET_ORDER) {
      const paired = stockAgeingConfig.columns.find((c) => c.key === `bucket_${key}`)
      expect(paired, `bucket_${key} is missing`).toBeDefined()
      expect(paired?.defaultVisible).not.toBe(false)
      // The old keys still exist, so nothing that named one breaks — just off by default.
      expect(stockAgeingConfig.columns.find((c) => c.key === `bucket_${key}_qty`)?.defaultVisible).toBe(false)
      expect(stockAgeingConfig.columns.find((c) => c.key === `bucket_${key}_value`)?.defaultVisible).toBe(false)
    }
  })

  it('offers no sort header the endpoint would quietly ignore', () => {
    // Read from the service's own whitelist rather than a list copied here, which would
    // drift the moment the endpoint changed.
    const php = readFileSync(SERVICE, 'utf8')
    const fn = php.slice(php.indexOf('public function stockAgeing('))
    const list = fn.slice(fn.indexOf("'ASC', [") + "'ASC', [".length)
    const allowed = new Set([...list.slice(0, list.indexOf(']')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    expect(allowed.size).toBeGreaterThan(3)
    for (const col of stockAgeingConfig.columns) {
      if (!col.sortKey) continue
      expect(allowed.has(col.sortKey), `${col.key} sorts by ${col.sortKey}, which the service cannot order by`).toBe(true)
    }
    expect(allowed.has(stockAgeingConfig.defaultSort)).toBe(true)
  })

  it('declares only filters the endpoint reads, with the server’s own option values', () => {
    const keys = stockAgeingConfig.filters.map((f) => f.key)
    expect(keys).toEqual([
      'as_of',
      'item_id',
      'warehouse_id',
      'item_grp_id',
      'stock_cat_id',
      'age_bucket',
      'health',
      'by_warehouse',
    ])
    const band = stockAgeingConfig.filters.find((f) => f.key === 'age_bucket')
    expect(band?.options?.map((o) => o.value)).toEqual([...AGE_BUCKET_ORDER])
    const health = stockAgeingConfig.filters.find((f) => f.key === 'health')
    expect(health?.options?.map((o) => o.value)).toEqual([...HEALTH_STATUS_ORDER])
  })

  it('puts the five front-row filters in the grid and the rest behind More filters', () => {
    expect(stockAgeingConfig.layout).toBe('panel')
    expect(stockAgeingConfig.filterPanel?.primaryKeys).toEqual([
      'as_of',
      'item_id',
      'warehouse_id',
      'item_grp_id',
      'stock_cat_id',
    ])
    // Everything declared is either in the grid or in the overflow — never nowhere.
    const primary = new Set(stockAgeingConfig.filterPanel?.primaryKeys ?? [])
    for (const f of stockAgeingConfig.filters) {
      expect(primary.has(f.key) || !f.hidden).toBe(true)
    }
  })

  describe('KPI cards', () => {
    const cards = stockAgeingConfig.kpis!(summary(), {
      data: [],
      meta: { total: 10, page: 1, limit: 50, pages: 1 },
      summary: summary(),
      report: 'stock_ageing',
    } as never)

    it('answers the five questions the screen opens with', () => {
      expect(cards.map((c) => c.key)).toEqual(['items', 'qty', 'value', 'slow', 'obsolete'])
    })

    it('states the at-risk cards as counts, with the value and the share beneath', () => {
      const slow = cards.find((c) => c.key === 'slow')!
      expect(slow.value).toBe('2 items')
      expect(String(slow.hint)).toContain('25.0% of stock value')
      const obsolete = cards.find((c) => c.key === 'obsolete')!
      expect(obsolete.value).toBe('2 items')
      expect(String(obsolete.hint)).toContain('15.0% of stock value')
    })

    it('drills into this same register, on a filter it declares', () => {
      const declared = new Set(stockAgeingConfig.filters.map((f) => f.key))
      for (const card of cards) {
        if (!card.to) continue
        const [path, qs] = card.to.split('?')
        expect(path).toBe('/registers/stock-ageing')
        for (const key of new URLSearchParams(qs).keys()) {
          expect(declared.has(key), `${card.key} passes ${key}, which this register does not read`).toBe(true)
        }
      }
    })
  })

  describe('insight strip', () => {
    it('names the worst warehouse and group from the server’s breakdown', () => {
      const set = stockAgeingConfig.insights!(summary(), {} as never)
      const labels = set.items.map((i) => String(i.label))
      expect(labels.some((l) => l.includes('older than 90 days'))).toBe(true)
      expect(labels.some((l) => l.includes('Main WH holds the oldest stock'))).toBe(true)
      expect(labels.some((l) => l.includes('Electrical carries the most 180+ stock'))).toBe(true)
      expect(String(set.note)).toContain('/100')
    })

    it('claims nothing about a register with nothing in it', () => {
      const empty = summary({
        total_value: 0,
        total_qty: 0,
        weighted_age_days: null,
        by_warehouse: [],
        by_item_group: [],
        buckets: (() => {
          const b = {} as StockAgeingSummary['buckets']
          for (const key of AGE_BUCKET_ORDER) b[key] = { qty: 0, value: 0, items: 0 }
          return b
        })(),
      })
      const set = stockAgeingConfig.insights!(empty, {} as never)
      expect(set.items).toEqual([])
      expect(set.note).toBeUndefined()
    })
  })

  describe('totals row', () => {
    const totals = stockAgeingConfig.totals!(summary(), [])

    it('names only columns the register actually renders', () => {
      for (const key of Object.keys(totals)) {
        expect(columnKeys.has(key), `totals names "${key}", which is not a column`).toBe(true)
      }
    })

    it('carries a figure for every band, hidden or not', () => {
      for (const key of AGE_BUCKET_ORDER) {
        expect(totals[`bucket_${key}`]).toBeDefined()
        expect(totals[`bucket_${key}_qty`]).toBeDefined()
        expect(totals[`bucket_${key}_value`]).toBeDefined()
      }
      expect(totals.weighted_age_days).toBe('67 d')
      expect(totals.oldest_days).toBe('240 d')
    })

    it('leaves the age cells blank rather than printing a zero it does not have', () => {
      const none = stockAgeingConfig.totals!(
        summary({ weighted_age_days: null, oldest_days: null }),
        [],
      )
      expect(none.weighted_age_days).toBe('')
      expect(none.oldest_days).toBe('')
    })
  })

  describe('grouping', () => {
    it('groups by warehouse, item group and health, and never by anything else', () => {
      expect(stockAgeingConfig.groupBy?.map((g) => g.key)).toEqual([
        'warehouse',
        'item_group',
        'health',
      ])
    })

    it('puts a row with no warehouse or group in a named group, never in undefined', () => {
      const loose = row({ warehouse_id: null, warehouse_name: null, item_grp_id: null, grp_name: null })
      const [byWarehouse, byGroup] = stockAgeingConfig.groupBy!
      expect(byWarehouse.of(loose)).toEqual({ key: '0', label: 'All warehouses' })
      expect(byGroup.of(loose)).toEqual({ key: '0', label: 'Ungrouped items' })
    })

    it('subtotals the rows it was handed, and says they are page figures', () => {
      const byHealth = stockAgeingConfig.groupBy![2]
      const rows = [row(), row({ item_id: 2, total_qty: 80, total_value: 24000, weighted_age_days: 22 })]
      const cells = byHealth.subtotal!(rows, byHealth.of(rows[0]))
      expect(String(cells.item_name)).toContain('on this page')
      expect(cells.total_qty).toBe('200')
      // (120x12 + 80x22) / 200 = 16
      expect(cells.weighted_age_days).toBe('16 d')
      for (const key of Object.keys(cells)) {
        expect(columnKeys.has(key), `group subtotal names "${key}"`).toBe(true)
      }
    })
  })

  describe('band cells', () => {
    it('exports the band’s value, and keeps the quantity in its own column', () => {
      const cell = stockAgeingConfig.columns.find((c) => c.key === 'bucket_0_30')!
      expect(cell.csv!(row())).toBe(36000)
      expect(cell.csvHeader).toContain('value')
      const qty = stockAgeingConfig.columns.find((c) => c.key === 'bucket_0_30_qty')!
      expect(qty.csv!(row())).toBe(120)
    })

    it('exports the health word, not its key', () => {
      const health = stockAgeingConfig.columns.find((c) => c.key === 'health_status')!
      expect(health.csv!(row({ health_status: 'slow' }))).toBe('Slow moving')
    })

    it('reads a band the server left out as empty rather than crashing', () => {
      const bare = { ...row(), buckets: undefined as unknown as StockAgeingRow['buckets'] }
      const cell = stockAgeingConfig.columns.find((c) => c.key === 'bucket_91_180')!
      expect(cell.csv!(bare)).toBe(0)
    })
  })

  it('drills a row through to that item’s ledger, carrying the warehouse', () => {
    expect(stockAgeingConfig.drillTo!(row())).toBe('/registers/stock-ledger?item_id=1&warehouse_id=4')
    expect(stockAgeingConfig.drillTo!(row({ warehouse_id: null }))).toBe('/registers/stock-ledger?item_id=1')
  })
})

/** The two derived filters exist on the server, or the select boxes are decoration. */
describe('the endpoint backs the derived filters', () => {
  const php = readFileSync(SERVICE, 'utf8')

  it('validates the ageing band against its own bucket list', () => {
    expect(php).toContain("$bucketFilter = $f['age_bucket']")
    expect(php).toContain('age_bucket must be one of')
  })

  it('validates the health word against its own status list', () => {
    expect(php).toContain("$healthFilter = $f['health']")
    expect(php).toContain('health must be one of')
  })

  it('classifies health on the server, so the export cannot disagree with the table', () => {
    expect(php).toContain('public static function classifyStockHealth')
    for (const status of HEALTH_STATUS_ORDER) {
      expect(php).toContain(`'${status}'`)
    }
  })

  it('sends the summary figures the screen reads', () => {
    for (const key of ['weighted_age_days', 'oldest_days', 'by_health', 'by_warehouse', 'by_item_group']) {
      expect(php, `the service never sets ${key}`).toContain(`'${key}'`)
    }
  })
})

/** Types the fixtures above pin, so a rename in reportsApi breaks here loudly. */
export type _BucketKeys = AgeBucketKey
