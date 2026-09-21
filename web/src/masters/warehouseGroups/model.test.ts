import { describe, expect, it } from 'vitest'
import type { Warehouse, WarehouseGroup } from '../../services/masters'
import {
  EMPTY_FILTERS,
  actorLabel,
  activeFilterCount,
  creatorOptions,
  filterGroups,
  groupStats,
  insights,
  matchesQuery,
  rangeLabel,
  sortGroups,
  suggestCode,
} from './model'

/**
 * The figures this screen prints, asserted rather than eyeballed.
 *
 * Everything below is what the KPI cards, the filters and the Insights panel
 * actually compute. A wrong count here is a wrong number on somebody's screen,
 * which is the one bug a master-data page cannot afford — so it is a failing
 * test instead.
 */

function group(over: Partial<WarehouseGroup> & { warehouse_group_id: number; grp_name: string }): WarehouseGroup {
  return {
    grp_code: null,
    description: null,
    parent_grp_id: null,
    is_active: 1,
    warehouse_count: 0,
    child_count: 0,
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-01-01 10:00:00',
    created_by: null,
    updated_by: null,
    created_by_name: null,
    updated_by_name: null,
    ...over,
  }
}

function warehouse(id: number, name: string, groupId: number | null): Warehouse {
  return {
    warehouse_id: id,
    warehouse_name: name,
    warehouse_code: null,
    warehouse_group_id: groupId,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 0,
    allow_negative: null,
    address: null,
    contact: null,
    bo_id: 0,
    is_active: 1,
  }
}

const GENERAL = group({ warehouse_group_id: 1, grp_name: 'General', grp_code: 'GEN', description: 'General warehouse group for all sites', warehouse_count: 5, created_by: 'u-rahul', created_by_name: 'Rahul Gupta', updated_at: '2026-07-02 11:23:00' })
const RETAIL = group({ warehouse_group_id: 2, grp_name: 'Retail Stores', grp_code: 'RET', description: 'Retail and franchise outlets', warehouse_count: 3, created_by: 'u-neha', created_by_name: 'Neha Sharma', updated_at: '2026-06-15 16:40:00' })
const MFG = group({ warehouse_group_id: 3, grp_name: 'Manufacturing', grp_code: 'MFG', warehouse_count: 2, parent_grp_id: 1, created_by: 'u-rahul', created_by_name: 'Rahul Gupta', updated_at: '2026-06-10 09:15:00' })
const TRANSIT = group({ warehouse_group_id: 4, grp_name: 'Transit', grp_code: 'TRN', warehouse_count: 1, created_by: 'u-amit', created_by_name: 'Amit Verma', updated_at: '2026-05-28 14:20:00' })
const SCRAP = group({ warehouse_group_id: 5, grp_name: 'Scrap / Rejected', grp_code: 'SCR', is_active: 0, warehouse_count: 1, updated_at: '2026-05-12 10:05:00' })

const ROWS: WarehouseGroup[] = [GENERAL, RETAIL, MFG, TRANSIT, SCRAP]

describe('matchesQuery', () => {
  it('searches the name, the code and the description', () => {
    expect(matchesQuery(RETAIL, 'retail')).toBe(true)
    expect(matchesQuery(RETAIL, 'RET')).toBe(true)
    expect(matchesQuery(RETAIL, 'franchise')).toBe(true)
    expect(matchesQuery(RETAIL, 'transit')).toBe(false)
  })

  it('treats an empty or blank query as no filter at all', () => {
    expect(matchesQuery(MFG, '')).toBe(true)
    expect(matchesQuery(MFG, '   ')).toBe(true)
  })
})

describe('filterGroups', () => {
  it('keeps only active or only inactive groups', () => {
    expect(filterGroups(ROWS, { ...EMPTY_FILTERS, status: 'active' }).map((r) => r.grp_name)).not.toContain('Scrap / Rejected')
    expect(filterGroups(ROWS, { ...EMPTY_FILTERS, status: 'inactive' })).toHaveLength(1)
  })

  it('separates groups that hold warehouses from empty ones', () => {
    const rows = [...ROWS, group({ warehouse_group_id: 6, grp_name: 'Unused' })]
    expect(filterGroups(rows, { ...EMPTY_FILTERS, contents: 'empty' }).map((r) => r.grp_name)).toEqual(['Unused'])
    expect(filterGroups(rows, { ...EMPTY_FILTERS, contents: 'with' })).toHaveLength(5)
  })

  it('separates top-level groups from sub-groups', () => {
    expect(filterGroups(ROWS, { ...EMPTY_FILTERS, level: 'child' }).map((r) => r.grp_name)).toEqual(['Manufacturing'])
    expect(filterGroups(ROWS, { ...EMPTY_FILTERS, level: 'root' })).toHaveLength(4)
  })

  it('filters by who created the group', () => {
    expect(filterGroups(ROWS, { ...EMPTY_FILTERS, createdBy: 'u-rahul' }).map((r) => r.grp_name)).toEqual(['General', 'Manufacturing'])
  })

  it('keeps groups updated on or after the date, and drops undated rows', () => {
    const undated = group({ warehouse_group_id: 7, grp_name: 'Undated', updated_at: null, created_at: null })
    const rows = [...ROWS, undated]
    const kept = filterGroups(rows, { ...EMPTY_FILTERS, updatedFrom: '2026-06-15' }).map((r) => r.grp_name)
    expect(kept).toEqual(['General', 'Retail Stores'])
  })

  it('counts only the filters that are actually narrowing', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    // The search box is counted separately; it has its own chip.
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'ret' })).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, status: 'active', level: 'child' })).toBe(2)
  })
})

describe('sortGroups', () => {
  it('sorts by name in both directions', () => {
    expect(sortGroups(ROWS, 'name_asc')[0].grp_name).toBe('General')
    expect(sortGroups(ROWS, 'name_desc')[0].grp_name).toBe('Transit')
  })

  it('sorts by warehouse count, breaking ties by name', () => {
    const byCount = sortGroups(ROWS, 'warehouses_desc').map((r) => r.grp_name)
    expect(byCount[0]).toBe('General')
    // Transit and Scrap both hold one: the name decides, every time.
    expect(byCount.slice(3)).toEqual(['Scrap / Rejected', 'Transit'])
  })

  it('sorts by the update stamp', () => {
    expect(sortGroups(ROWS, 'updated')[0].grp_name).toBe('General')
  })

  it('puts rows with no stamp last in both directions', () => {
    const undated = group({ warehouse_group_id: 8, grp_name: 'Undated', created_at: null })
    const rows = [undated, ...ROWS]
    expect(sortGroups(rows, 'newest').at(-1)?.grp_name).toBe('Undated')
    expect(sortGroups(rows, 'oldest').at(-1)?.grp_name).toBe('Undated')
  })

  it('does not mutate the array it is given', () => {
    const original = [...ROWS]
    sortGroups(ROWS, 'name_desc')
    expect(ROWS).toEqual(original)
  })
})

describe('groupStats', () => {
  it('counts totals, the active split and the warehouses held', () => {
    const stats = groupStats(ROWS, null)
    expect(stats.total).toBe(5)
    expect(stats.active).toBe(4)
    expect(stats.inactive).toBe(1)
    expect(stats.activePct).toBe(80)
    expect(stats.inactivePct).toBe(20)
    expect(stats.warehousesInGroups).toBe(12)
  })

  it('reports no company warehouse total when warehouses cannot be read', () => {
    const stats = groupStats(ROWS, null)
    expect(stats.warehousesTotal).toBeNull()
    expect(stats.ungrouped).toBeNull()
  })

  it('counts ungrouped warehouses when it may see them', () => {
    const stats = groupStats(ROWS, [warehouse(1, 'Main', 1), warehouse(2, 'Depot', null), warehouse(3, 'Store', null)])
    expect(stats.warehousesTotal).toBe(3)
    expect(stats.ungrouped).toBe(2)
  })

  it('does not divide by zero on an empty master', () => {
    const stats = groupStats([], null)
    expect(stats).toMatchObject({ total: 0, active: 0, inactive: 0, activePct: 0, inactivePct: 0 })
  })
})

describe('creatorOptions', () => {
  it('lists each creator once, with a count, sorted by name', () => {
    expect(creatorOptions(ROWS)).toEqual([
      { value: 'u-amit', label: 'Amit Verma', count: 1 },
      { value: 'u-neha', label: 'Neha Sharma', count: 1 },
      { value: 'u-rahul', label: 'Rahul Gupta', count: 2 },
    ])
  })

  it('offers nobody when no row records a creator', () => {
    expect(creatorOptions([SCRAP])).toEqual([])
  })
})

describe('actorLabel', () => {
  it('prefers the resolved member name', () => {
    expect(actorLabel('u-rahul', 'Rahul Gupta')).toBe('Rahul Gupta')
  })

  it('falls back to the identifier rather than inventing a person', () => {
    expect(actorLabel('cli:inventory-reconcile', null)).toBe('cli:inventory-reconcile')
    expect(actorLabel('7', null)).toBe('User #7')
    expect(actorLabel('0f8c1e2a-44d1-4a55-9a1e-77', null)).toBe('0f8c1e2a…')
    expect(actorLabel(null, null)).toBeNull()
  })
})

describe('suggestCode', () => {
  it('suggests the three-letter stem of a one or two word name', () => {
    expect(suggestCode('General')).toBe('GEN')
    expect(suggestCode('Retail Stores')).toBe('RET')
    expect(suggestCode('Transit')).toBe('TRA')
  })

  it('uses initials once the name runs to three words', () => {
    expect(suggestCode('Scrap Rejected Stock')).toBe('SRS')
  })

  it('never proposes a code the screen can already see is taken', () => {
    expect(suggestCode('Retail Stores', ['RET'])).not.toBe('RET')
    expect(suggestCode('General', ['GEN', 'GENE', 'G'])).toBe('GEN2')
  })

  it('ignores punctuation and returns nothing for a nameless group', () => {
    expect(suggestCode('Scrap / Rejected')).toBe('SCR')
    expect(suggestCode('   ')).toBe('')
  })
})

describe('insights', () => {
  it('says nothing at all about an empty master', () => {
    expect(insights([], null)).toEqual([])
  })

  it('reports groups that hold nothing', () => {
    const rows = [GENERAL, group({ warehouse_group_id: 9, grp_name: 'Unused' })]
    const found = insights(rows, null).find((i) => i.id === 'empty-groups')
    expect(found?.title).toContain('1 group holds no warehouses')
    expect(found?.filters).toEqual({ contents: 'empty' })
  })

  it('does not call a group empty while it still has sub-groups', () => {
    const parent = group({ warehouse_group_id: 10, grp_name: 'Holding', child_count: 2 })
    expect(insights([GENERAL, parent], null).some((i) => i.id === 'empty-groups')).toBe(false)
  })

  it('flags an inactive group that warehouses still point at', () => {
    const found = insights(ROWS, null).find((i) => i.id === 'inactive-holding')
    expect(found?.title).toContain('1 inactive group still holds 1 warehouse')
    expect(found?.tone).toBe('warning')
  })

  it('flags names that differ only in case, spacing or punctuation', () => {
    const rows = [RETAIL, group({ warehouse_group_id: 11, grp_name: 'retail  stores', grp_code: 'RS2' })]
    expect(insights(rows, null).some((i) => i.id === 'duplicate-names')).toBe(true)
  })

  it('flags a part-coded master, but not one where nobody uses codes', () => {
    const uncoded = group({ warehouse_group_id: 12, grp_name: 'No code', warehouse_count: 1 })
    expect(insights([GENERAL, uncoded], null).some((i) => i.id === 'missing-codes')).toBe(true)
    const noneCoded = [group({ warehouse_group_id: 13, grp_name: 'A', warehouse_count: 1 }), group({ warehouse_group_id: 14, grp_name: 'B', warehouse_count: 1 })]
    expect(insights(noneCoded, null).some((i) => i.id === 'missing-codes')).toBe(false)
  })

  it('points out a grouping that has all its warehouses in one bucket', () => {
    const big = group({ warehouse_group_id: 15, grp_name: 'Everything', warehouse_count: 9, grp_code: 'EVE' })
    const small = group({ warehouse_group_id: 16, grp_name: 'Spare', warehouse_count: 1, grp_code: 'SPA' })
    const found = insights([big, small], null).find((i) => i.id === 'lopsided')
    expect(found?.title).toContain('90%')
  })

  it('only mentions ungrouped warehouses when it was shown the warehouses', () => {
    expect(insights(ROWS, null).some((i) => i.id === 'ungrouped-warehouses')).toBe(false)
    const withWarehouses = insights(ROWS, [warehouse(1, 'Main', 1), warehouse(2, 'Loose', null)])
    expect(withWarehouses.find((i) => i.id === 'ungrouped-warehouses')?.title).toContain('1 warehouse is in no group')
  })
})

describe('rangeLabel', () => {
  it('reads as a sentence at every size', () => {
    expect(rangeLabel(0, 0, 0)).toBe('No warehouse groups')
    expect(rangeLabel(1, 1, 1)).toBe('1 warehouse group')
    expect(rangeLabel(1, 25, 128)).toBe('Showing 1–25 of 128 warehouse groups')
  })
})
