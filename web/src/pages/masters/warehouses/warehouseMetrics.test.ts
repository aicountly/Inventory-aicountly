import { describe, expect, it } from 'vitest'
import type { Warehouse } from '../../../services/masters'
import type { WarehouseStockSummary } from '../../../services/reportsApi'
import {
  capacityOf,
  coordinatesOf,
  groupByLocation,
  locationGroupLabel,
  placeOf,
  stockByWarehouse,
  stockSeries,
  totalStockQty,
  utilisationLevel,
  utilisationOf,
} from './warehouseMetrics'
import { plotWarehouses } from './WarehouseViews'

/**
 * The figures the Warehouses screen prints beside each other — capacity, stock
 * and how full a warehouse is — are exactly the ones a user will check against
 * a report. These pin the rules they follow, above all the one that runs
 * through every card and cell: a capacity nobody configured is null, never 0.
 */

function warehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    warehouse_id: 1,
    warehouse_name: 'Main',
    warehouse_code: null,
    warehouse_group_id: null,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 0,
    allow_negative: null,
    address: null,
    contact: null,
    bo_id: 0,
    is_active: 1,
    capacity_units: null,
    area: null,
    area_unit: null,
    latitude: null,
    longitude: null,
    ...overrides,
  }
}

describe('capacityOf', () => {
  it('is null when nothing is configured', () => {
    expect(capacityOf(warehouse())).toBeNull()
  })

  it('treats a zero ceiling as unconfigured rather than a full warehouse', () => {
    expect(capacityOf(warehouse({ capacity_units: 0 }))).toBeNull()
  })

  it('reads a numeric string, which is how Postgres NUMERIC arrives', () => {
    expect(capacityOf(warehouse({ capacity_units: '50000' as unknown as number }))).toBe(50000)
  })
})

describe('utilisationOf', () => {
  it('is null without a capacity, so no card divides by an invented ceiling', () => {
    expect(utilisationOf(null, 16240)).toBeNull()
    expect(utilisationOf(0, 16240)).toBeNull()
  })

  it('is the share of the ceiling in use', () => {
    expect(utilisationOf(50000, 16240)).toBeCloseTo(32.48, 2)
  })

  it('does not clamp at 100 — an over-filled warehouse is the row to look at', () => {
    expect(utilisationOf(1000, 1500)).toBe(150)
  })

  it('floors negative stock at empty rather than drawing a negative bar', () => {
    expect(utilisationOf(1000, -200)).toBe(0)
  })
})

describe('utilisationLevel', () => {
  it('bands 0-70 normal, 71-90 warning, above 90 high', () => {
    expect(utilisationLevel(0)).toBe('normal')
    expect(utilisationLevel(70)).toBe('normal')
    expect(utilisationLevel(70.5)).toBe('warning')
    expect(utilisationLevel(90)).toBe('warning')
    expect(utilisationLevel(90.1)).toBe('high')
    expect(utilisationLevel(null)).toBe('empty')
  })
})

describe('stockByWarehouse', () => {
  const summary: WarehouseStockSummary = {
    rows: 3,
    items: 12,
    warehouses: 1,
    active_warehouses: 2,
    closing_qty: 16240,
    closing_value: 1248000,
    reserved_qty: null,
    available_qty: null,
    by_warehouse: [
      { warehouse_id: 1, warehouse_name: 'Main', closing_qty: 16240, closing_value: 1248000, items: 42 },
      { warehouse_id: null, warehouse_name: null, closing_qty: 5, closing_value: 50, items: 1 },
    ],
    health: { out: 0, negative: 0, reorder: 0, low: 0, overstocked: 0, healthy: 12 },
    health_items: { out: 0, negative: 0, reorder: 0, low: 0, overstocked: 0, healthy: 12 },
    health_filter: null,
    method: 'FIFO',
    live_buckets: true,
    currency: 'INR',
    to: '2026-09-18',
  }

  it('keys the report summary by warehouse id', () => {
    const map = stockByWarehouse(summary, true)
    expect(map.get(1)).toEqual({ qty: 16240, value: 1248000 })
  })

  it('drops the unassigned bucket, which is not a warehouse', () => {
    expect(stockByWarehouse(summary, true).size).toBe(1)
  })

  it('withholds the value from a user who may not read valuation', () => {
    expect(stockByWarehouse(summary, false).get(1)).toEqual({ qty: 16240, value: null })
  })

  it('is empty, not thrown, before the report arrives', () => {
    expect(stockByWarehouse(null, true).size).toBe(0)
  })
})

describe('placeOf', () => {
  it('reads the stored address and labels city and state', () => {
    const place = placeOf(warehouse({ address: { city: 'New Delhi', state: 'Delhi', country: 'India' } }))
    expect(place.city).toBe('New Delhi')
    expect(place.label).toBe('New Delhi, Delhi')
  })

  it('treats blank strings as absent rather than printing a comma', () => {
    expect(placeOf(warehouse({ address: { city: '  ', state: '', country: 'India' } })).label).toBe('India')
  })

  it('is null when no address has been entered', () => {
    expect(placeOf(warehouse()).label).toBeNull()
  })
})

describe('groupByLocation', () => {
  it('groups by country, state and city and sorts the biggest first', () => {
    const rows = [
      warehouse({ warehouse_id: 1, address: { city: 'Pune', state: 'MH', country: 'India' } }),
      warehouse({ warehouse_id: 2, address: { city: 'Pune', state: 'MH', country: 'India' } }),
      warehouse({ warehouse_id: 3, address: { city: 'Delhi', state: 'DL', country: 'India' } }),
    ]
    const groups = groupByLocation(rows)
    expect(groups).toHaveLength(2)
    expect(groups[0].city).toBe('Pune')
    expect(groups[0].warehouses).toHaveLength(2)
  })

  it('keeps unplaced warehouses in a group of their own, last, rather than dropping them', () => {
    const groups = groupByLocation([
      warehouse({ warehouse_id: 1 }),
      warehouse({ warehouse_id: 2, address: { city: 'Pune' } }),
    ])
    expect(groups).toHaveLength(2)
    expect(locationGroupLabel(groups[1])).toBe('No location set')
  })
})

describe('coordinatesOf and plotWarehouses', () => {
  it('needs both halves of a point', () => {
    expect(coordinatesOf(warehouse({ latitude: 18.52 }))).toBeNull()
    expect(coordinatesOf(warehouse({ latitude: 18.52, longitude: 73.85 }))).toEqual({ lat: 18.52, lng: 73.85 })
  })

  it('rejects an out-of-range pair instead of plotting it off the canvas', () => {
    expect(coordinatesOf(warehouse({ latitude: 120, longitude: 73.85 }))).toBeNull()
  })

  it('places a lone warehouse in the middle rather than a corner', () => {
    const [point] = plotWarehouses([warehouse({ latitude: 18.52, longitude: 73.85 })])
    expect(point.x).toBeCloseTo(50, 5)
    expect(point.y).toBeCloseTo(50, 5)
  })

  it('puts the northern warehouse above the southern one', () => {
    const plotted = plotWarehouses([
      warehouse({ warehouse_id: 1, latitude: 28.6, longitude: 77.2 }),
      warehouse({ warehouse_id: 2, latitude: 12.9, longitude: 77.6 }),
    ])
    const north = plotted.find((p) => p.warehouse.warehouse_id === 1)
    const south = plotted.find((p) => p.warehouse.warehouse_id === 2)
    expect(north?.y).toBeLessThan(south?.y as number)
  })

  it('skips warehouses with no coordinates', () => {
    expect(plotWarehouses([warehouse()])).toEqual([])
  })
})

describe('stockSeries', () => {
  const rows = [
    warehouse({ warehouse_id: 1, warehouse_name: 'Main' }),
    warehouse({ warehouse_id: 2, warehouse_name: 'Transit' }),
    warehouse({ warehouse_id: 3, warehouse_name: 'Empty' }),
  ]
  const stock = new Map([
    [1, { qty: 7500, value: 100 }],
    [2, { qty: 2500, value: 50 }],
    [3, { qty: 0, value: 0 }],
  ])

  it('ranks by quantity and computes each share of the total', () => {
    const series = stockSeries(rows, stock, (v) => `INR ${v}`)
    expect(series.map((s) => s.label)).toEqual(['Main', 'Transit'])
    expect(series[0].share).toBeCloseTo(75, 5)
  })

  it('leaves out empty warehouses, which would be zero-width slices', () => {
    expect(stockSeries(rows, stock, (v) => String(v)).some((s) => s.label === 'Empty')).toBe(false)
  })

  it('omits the value line when the caller may not see valuation', () => {
    const noValue = new Map([[1, { qty: 10, value: null }]])
    expect(stockSeries([rows[0]], noValue, (v) => String(v))[0].sub).toBeUndefined()
  })

  it('totals only the warehouses given', () => {
    expect(totalStockQty(rows, stock)).toBe(10000)
  })
})
