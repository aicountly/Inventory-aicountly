import { describe, expect, it } from 'vitest'
import type { Warehouse } from '../../../services/masters'
import { buildWarehouseInsights } from './warehouseInsights'
import type { WarehouseStock } from './warehouseMetrics'

/**
 * Quick Insights is the one card on the screen that makes claims in words, so
 * every claim has to be earned by the data. These pin the two failure modes
 * that matter: a cheerful line printed when nothing supports it, and a real
 * problem that goes unmentioned.
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
    address: { city: 'Pune', state: 'MH', country: 'India' },
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

const stockOf = (entries: [number, number][]): Map<number, WarehouseStock> =>
  new Map(entries.map(([id, qty]) => [id, { qty, value: null }]))

const ids = (rows: Warehouse[], stock: Map<number, WarehouseStock>, locationCount: number | null = 5, defaultCount = 1) =>
  buildWarehouseInsights({ warehouses: rows, stock, locationCount, defaultCount }, 10).map((i) => i.id)

describe('buildWarehouseInsights', () => {
  it('says nothing at all when there are no warehouses', () => {
    expect(buildWarehouseInsights({ warehouses: [], stock: new Map(), locationCount: 0, defaultCount: 0 })).toEqual([])
  })

  it('does not claim stock is well distributed when no capacity is configured', () => {
    const rows = [warehouse({ warehouse_id: 1 }), warehouse({ warehouse_id: 2 })]
    const found = ids(rows, stockOf([[1, 10], [2, 10]]))
    expect(found).not.toContain('well-distributed')
    expect(found).toContain('capacity-missing')
  })

  it('claims a good spread only once there are capacities to judge it by', () => {
    const rows = [
      warehouse({ warehouse_id: 1, capacity_units: 1000 }),
      warehouse({ warehouse_id: 2, capacity_units: 1000 }),
    ]
    expect(ids(rows, stockOf([[1, 100], [2, 200]]))).toContain('well-distributed')
  })

  it('reports an over-full warehouse ahead of everything else', () => {
    const rows = [warehouse({ warehouse_id: 1, capacity_units: 100 })]
    const found = ids(rows, stockOf([[1, 95]]))
    expect(found[0]).toBe('over-capacity')
    expect(found).not.toContain('well-distributed')
  })

  it('separates "filling up" from "over capacity"', () => {
    const rows = [warehouse({ warehouse_id: 1, capacity_units: 100 })]
    expect(ids(rows, stockOf([[1, 85]]))).toContain('filling-up')
  })

  it('puts negative stock first — it is a wrong balance, not a busy warehouse', () => {
    const rows = [warehouse({ warehouse_id: 1, capacity_units: 100 })]
    expect(ids(rows, stockOf([[1, -5]]))[0]).toBe('negative-stock')
  })

  it('counts the warehouses with no capacity when only some have one', () => {
    const rows = [
      warehouse({ warehouse_id: 1, capacity_units: 1000 }),
      warehouse({ warehouse_id: 2 }),
      warehouse({ warehouse_id: 3 }),
    ]
    const insight = buildWarehouseInsights(
      { warehouses: rows, stock: stockOf([[1, 10]]), locationCount: 1, defaultCount: 1 },
      10,
    ).find((i) => i.id === 'capacity-partial')
    expect(insight?.title).toBe('2 of 3 warehouses have no capacity set')
  })

  it('offers bin locations only when none are configured', () => {
    const rows = [warehouse({ warehouse_id: 1 })]
    expect(ids(rows, stockOf([[1, 10]]), 0)).toContain('enable-bins')
    expect(ids(rows, stockOf([[1, 10]]), 12)).not.toContain('enable-bins')
    // null means "not loaded yet" — it must not read as "none exist".
    expect(ids(rows, stockOf([[1, 10]]), null)).not.toContain('enable-bins')
  })

  it('flags a company with no default warehouse', () => {
    const rows = [warehouse({ warehouse_id: 1 })]
    expect(ids(rows, stockOf([[1, 10]]), 1, 0)).toContain('no-default')
    expect(ids(rows, stockOf([[1, 10]]), 1, 1)).not.toContain('no-default')
  })

  it('asks for an address only from the warehouses that lack one', () => {
    const rows = [warehouse({ warehouse_id: 1, address: null }), warehouse({ warehouse_id: 2 })]
    const insight = buildWarehouseInsights(
      { warehouses: rows, stock: stockOf([[1, 1], [2, 1]]), locationCount: 1, defaultCount: 1 },
      10,
    ).find((i) => i.id === 'no-address')
    expect(insight?.title).toBe('1 warehouse has no address')
  })

  it('does not call every warehouse empty when they all are', () => {
    const rows = [warehouse({ warehouse_id: 1 }), warehouse({ warehouse_id: 2 })]
    expect(ids(rows, stockOf([[1, 0], [2, 0]]))).not.toContain('empty-warehouses')
  })

  it('caps the card so it prioritises something', () => {
    const rows = [warehouse({ warehouse_id: 1, address: null })]
    expect(buildWarehouseInsights({ warehouses: rows, stock: new Map(), locationCount: 0, defaultCount: 0 })).toHaveLength(4)
  })

  it('gives every insight somewhere to go', () => {
    const rows = [warehouse({ warehouse_id: 1, address: null, capacity_units: 100 })]
    const insights = buildWarehouseInsights({ warehouses: rows, stock: stockOf([[1, 99]]), locationCount: 0, defaultCount: 0 }, 10)
    expect(insights.length).toBeGreaterThan(0)
    for (const insight of insights) expect(insight.to).toMatch(/^\//)
  })
})
