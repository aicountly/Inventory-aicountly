import { describe, expect, it } from 'vitest'
import type { Location } from '../../../services/masters'
import type { WarehouseRef } from './locationsModel'
import {
  buildHierarchy,
  locationInsights,
  locationStats,
  locationTypeMeta,
  pathLabel,
  typeDistribution,
  warehouseCoverage,
} from './locationsModel'

function loc(partial: Partial<Location> & { location_id: number }): Location {
  return {
    warehouse_id: 1,
    parent_location_id: null,
    location_code: `LOC-${partial.location_id}`,
    location_name: 'Bin',
    location_type: 'bin',
    is_active: 1,
    ...partial,
  } as Location
}

function wh(warehouse_id: number, warehouse_name: string, is_active = 1): WarehouseRef {
  return { warehouse_id, warehouse_name, is_active }
}

describe('locationTypeMeta', () => {
  it('names the four real bin types', () => {
    expect(locationTypeMeta('zone').label).toBe('Zone')
    expect(locationTypeMeta('rack').label).toBe('Rack')
    expect(locationTypeMeta('shelf').label).toBe('Shelf')
    expect(locationTypeMeta('bin').label).toBe('Bin')
  })

  it('humanizes a legacy value outside the whitelist instead of throwing', () => {
    expect(locationTypeMeta('pick_face').label).toBe('Pick face')
    expect(locationTypeMeta('pick_face').tone).toBe('slate')
  })

  it('falls back for null and empty', () => {
    expect(locationTypeMeta(null).label).toBe('Other')
    expect(locationTypeMeta('').label).toBe('Other')
  })
})

describe('locationStats', () => {
  it('counts active, inactive and distinct warehouses', () => {
    const stats = locationStats([
      loc({ location_id: 1, warehouse_id: 1 }),
      loc({ location_id: 2, warehouse_id: 1, is_active: 0 }),
      loc({ location_id: 3, warehouse_id: 2 }),
    ])
    expect(stats.total).toBe(3)
    expect(stats.active).toBe(2)
    expect(stats.inactive).toBe(1)
    expect(stats.warehousesCovered).toBe(2)
    expect(Math.round(stats.activePct)).toBe(67)
  })

  it('is all zeros for an empty company, with no division by zero', () => {
    const stats = locationStats([])
    expect(stats).toEqual({
      total: 0,
      active: 0,
      inactive: 0,
      warehousesCovered: 0,
      activePct: 0,
      inactivePct: 0,
    })
  })

  it('treats any non-1 is_active as inactive', () => {
    expect(locationStats([loc({ location_id: 1, is_active: 0 })]).active).toBe(0)
  })
})

describe('typeDistribution', () => {
  it('orders by hierarchy, not by count', () => {
    const series = typeDistribution([
      loc({ location_id: 1, location_type: 'bin' }),
      loc({ location_id: 2, location_type: 'bin' }),
      loc({ location_id: 3, location_type: 'zone' }),
    ])
    expect(series.map((s) => s.key)).toEqual(['zone', 'bin'])
  })

  it('drops types with no rows rather than drawing zero slices', () => {
    const series = typeDistribution([loc({ location_id: 1, location_type: 'shelf' })])
    expect(series).toHaveLength(1)
    expect(series[0].value).toBe(1)
    expect(series[0].share).toBe(100)
  })

  it('puts unknown types after the known ones', () => {
    const series = typeDistribution([
      loc({ location_id: 1, location_type: 'custom' }),
      loc({ location_id: 2, location_type: 'zone' }),
    ])
    expect(series.map((s) => s.key)).toEqual(['zone', 'custom'])
  })

  it('returns nothing for no rows', () => {
    expect(typeDistribution([])).toEqual([])
  })
})

describe('warehouseCoverage', () => {
  it('counts per warehouse, biggest first, and links to the filtered list', () => {
    const series = warehouseCoverage(
      [
        loc({ location_id: 1, warehouse_id: 2 }),
        loc({ location_id: 2, warehouse_id: 1 }),
        loc({ location_id: 3, warehouse_id: 1 }),
      ],
      [wh(1, 'Main'), wh(2, 'Overflow')],
    )
    expect(series.map((s) => s.label)).toEqual(['Main', 'Overflow'])
    expect(series[0].value).toBe(2)
    expect(series[0].to).toBe('/masters/locations?warehouse_id=1')
  })

  it('labels a warehouse it cannot name rather than dropping its rows', () => {
    const series = warehouseCoverage([loc({ location_id: 1, warehouse_id: 9 })], [])
    expect(series[0].label).toBe('Warehouse #9')
  })
})

describe('buildHierarchy', () => {
  const rows = [
    loc({ location_id: 1, location_code: 'Z1', location_type: 'zone' }),
    loc({ location_id: 2, location_code: 'R1', location_type: 'rack', parent_location_id: 1 }),
    loc({ location_id: 3, location_code: 'B1', parent_location_id: 2 }),
  ]

  it('reports depth and the ancestor chain outermost-first', () => {
    const map = buildHierarchy(rows)
    expect(map.get(1)?.depth).toBe(0)
    expect(map.get(3)?.depth).toBe(2)
    expect(map.get(3)?.ancestors.map((a) => a.location_code)).toEqual(['Z1', 'R1'])
  })

  it('marks which rows have children', () => {
    const map = buildHierarchy(rows)
    expect(map.get(1)?.hasChildren).toBe(true)
    expect(map.get(3)?.hasChildren).toBe(false)
  })

  it('stops on a parent cycle instead of looping forever', () => {
    const map = buildHierarchy([
      loc({ location_id: 1, parent_location_id: 2 }),
      loc({ location_id: 2, parent_location_id: 1 }),
    ])
    expect(map.get(1)?.depth).toBe(1)
    expect(map.get(2)?.depth).toBe(1)
  })

  it('treats a parent outside the loaded page as a root', () => {
    const map = buildHierarchy([loc({ location_id: 1, parent_location_id: 999 })])
    expect(map.get(1)?.depth).toBe(0)
  })
})

describe('pathLabel', () => {
  it('joins the ancestor codes', () => {
    const map = buildHierarchy([
      loc({ location_id: 1, location_code: 'Z1' }),
      loc({ location_id: 2, location_code: 'B1', parent_location_id: 1 }),
    ])
    expect(pathLabel(map.get(2))).toBe('Z1')
    expect(pathLabel(map.get(1))).toBe('')
    expect(pathLabel(undefined)).toBe('')
  })
})

describe('locationInsights', () => {
  it('says nothing at all when there are no locations', () => {
    expect(locationInsights([], [wh(1, 'Main')])).toEqual([])
  })

  it('flags active warehouses that cannot address stock to a bin', () => {
    const insights = locationInsights([loc({ location_id: 1, warehouse_id: 1 })], [wh(1, 'Main'), wh(2, 'Overflow')])
    const found = insights.find((i) => i.id === 'warehouses-without-locations')
    expect(found?.title).toContain('1 active warehouse has no locations')
    expect(found?.detail).toContain('Overflow')
  })

  it('treats a form-options warehouse with no is_active as active', () => {
    const insights = locationInsights(
      [loc({ location_id: 1, warehouse_id: 1 })],
      [{ warehouse_id: 1, warehouse_name: 'Main' }, { warehouse_id: 2, warehouse_name: 'Overflow' }],
    )
    expect(insights.find((i) => i.id === 'warehouses-without-locations')?.detail).toContain('Overflow')
  })

  it('ignores inactive warehouses when looking for bare ones', () => {
    const insights = locationInsights([loc({ location_id: 1, warehouse_id: 1 })], [wh(1, 'Main'), wh(2, 'Closed', 0)])
    expect(insights.find((i) => i.id === 'warehouses-without-locations')).toBeUndefined()
  })

  it('flags a flat estate only once it is big enough to matter', () => {
    const few = Array.from({ length: 4 }, (_, i) => loc({ location_id: i + 1 }))
    expect(locationInsights(few, [wh(1, 'Main')]).find((i) => i.id === 'flat-hierarchy')).toBeUndefined()

    const many = Array.from({ length: 8 }, (_, i) => loc({ location_id: i + 1 }))
    expect(locationInsights(many, [wh(1, 'Main')]).find((i) => i.id === 'flat-hierarchy')).toBeDefined()
  })

  it('carries the filter that shows the rows it is about', () => {
    const insights = locationInsights(
      [loc({ location_id: 1 }), loc({ location_id: 2, is_active: 0 })],
      [wh(1, 'Main')],
    )
    expect(insights.find((i) => i.id === 'inactive-locations')?.filter).toEqual({ status: 'inactive' })
  })

  it('flags duplicate names inside one warehouse but not across two', () => {
    const same = locationInsights(
      [
        loc({ location_id: 1, warehouse_id: 1, location_name: 'Shelf 1' }),
        loc({ location_id: 2, warehouse_id: 1, location_name: 'shelf 1' }),
      ],
      [wh(1, 'Main')],
    )
    expect(same.find((i) => i.id === 'duplicate-names')).toBeDefined()

    const across = locationInsights(
      [
        loc({ location_id: 1, warehouse_id: 1, location_name: 'Shelf 1' }),
        loc({ location_id: 2, warehouse_id: 2, location_name: 'Shelf 1' }),
      ],
      [wh(1, 'Main'), wh(2, 'Overflow')],
    )
    expect(across.find((i) => i.id === 'duplicate-names')).toBeUndefined()
  })

  it('falls back to a healthy note when no rule fires', () => {
    const insights = locationInsights(
      [loc({ location_id: 1, location_name: 'Bin A' }), loc({ location_id: 2, location_name: 'Bin B', parent_location_id: 1 })],
      [wh(1, 'Main')],
    )
    expect(insights).toHaveLength(1)
    expect(insights[0].id).toBe('healthy')
  })
})
