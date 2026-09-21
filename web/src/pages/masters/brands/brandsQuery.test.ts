import { describe, expect, it } from 'vitest'
import {
  BRAND_SORTS,
  activeBrandFilterCount,
  advancedBrandFilterCount,
  brandExportMetaLines,
  buildBrandListQuery,
  createdRange,
  readBrandFilters,
  shiftIsoDays,
  sortKeyOf,
  sortParamsOf,
  startOfIsoMonth,
} from './brandsQuery'
import type { BrandFilterState } from './brandsQuery'

const BASE: BrandFilterState = {
  q: '',
  status: '',
  created: '',
  createdFrom: '',
  createdTo: '',
  hasItems: '',
}

const PAGING = { page: 1, limit: 50, sort: 'brand_name', order: 'asc' as const }
const CTX = { today: '2026-09-18', fyFrom: '2026-04-01', fyTo: '2027-03-31' }

describe('sort options', () => {
  it('round-trips every menu entry through the API parameters', () => {
    for (const option of BRAND_SORTS) {
      expect(sortKeyOf(option.sort, option.order)).toBe(option.key)
      expect(sortParamsOf(option.key)).toEqual({ sort: option.sort, order: option.order })
    }
  })

  it('falls back to name A–Z for an order the API cannot honour', () => {
    // Someone hand-edits ?sort=sales_desc, or an old bookmark carries one.
    expect(sortKeyOf('sales_desc', 'desc')).toBe('name_asc')
    expect(sortParamsOf('sales_desc')).toEqual({ sort: 'brand_name', order: 'asc' })
  })

  it('offers no revenue order, because the list endpoint cannot sort by it', () => {
    expect(BRAND_SORTS.some((s) => s.key.includes('sales'))).toBe(false)
  })
})

describe('date helpers', () => {
  it('shifts across a month boundary', () => {
    expect(shiftIsoDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftIsoDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('shifts across a leap day', () => {
    expect(shiftIsoDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('returns nothing for a value that is not an ISO date', () => {
    expect(shiftIsoDays('yesterday', -1)).toBe('')
    expect(startOfIsoMonth('2026-09')).toBe('')
  })
})

describe('createdRange', () => {
  it('includes today in the rolling windows', () => {
    expect(createdRange('today', CTX)).toEqual({ from: '2026-09-18', to: '2026-09-18' })
    // 6 days back plus today is seven days, which is what a reader means.
    expect(createdRange('last7', CTX)).toEqual({ from: '2026-09-12', to: '2026-09-18' })
    expect(createdRange('last30', CTX)).toEqual({ from: '2026-08-20', to: '2026-09-18' })
  })

  it('runs this month from the first to today, not to the month end', () => {
    expect(createdRange('month', CTX)).toEqual({ from: '2026-09-01', to: '2026-09-18' })
  })

  it('takes the financial year from Manage', () => {
    expect(createdRange('fy', CTX)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
  })

  it('resolves to no range rather than guessing an FY nobody supplied', () => {
    expect(createdRange('fy', { today: '2026-09-18' })).toEqual({ from: '', to: '' })
  })

  it('reads the custom bounds only for the custom preset', () => {
    const custom = { ...CTX, customFrom: '2026-01-01', customTo: '2026-01-31' }
    expect(createdRange('custom', custom)).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(createdRange('month', custom)).toEqual({ from: '2026-09-01', to: '2026-09-18' })
  })
})

describe('readBrandFilters', () => {
  it('ignores values the API does not accept', () => {
    const state = readBrandFilters('apple', {
      status: 'archived',
      created: 'last-century',
      has_items: '2',
    })
    expect(state).toMatchObject({ q: 'apple', status: '', created: '', hasItems: '' })
  })

  it('keeps the values it does accept', () => {
    const state = readBrandFilters('', { status: 'inactive', created: 'fy', has_items: '0' })
    expect(state).toMatchObject({ status: 'inactive', created: 'fy', hasItems: '0' })
  })
})

describe('filter counting', () => {
  it('counts the search, because a search that matched nothing is the same dead end', () => {
    expect(activeBrandFilterCount({ ...BASE, q: '  ' })).toBe(0)
    expect(activeBrandFilterCount({ ...BASE, q: 'apple' })).toBe(1)
    expect(activeBrandFilterCount({ ...BASE, q: 'a', status: 'active', created: 'month', hasItems: '0' })).toBe(4)
  })

  it('counts only the drawer filters for the More filters badge', () => {
    expect(advancedBrandFilterCount({ ...BASE, q: 'a', status: 'active' })).toBe(0)
    expect(advancedBrandFilterCount({ ...BASE, created: 'month', hasItems: '1' })).toBe(2)
  })
})

describe('buildBrandListQuery', () => {
  it('drops empty filters instead of sending blank parameters', () => {
    const query = buildBrandListQuery(BASE, PAGING, CTX)
    expect(query.q).toBeUndefined()
    expect(query.status).toBeUndefined()
    expect(query.created_from).toBeUndefined()
    expect(query.has_items).toBeUndefined()
    expect(query).toMatchObject({ page: 1, limit: 50, sort: 'brand_name', order: 'asc' })
  })

  it('resolves the period to real bounds so the API is never sent a word', () => {
    const query = buildBrandListQuery({ ...BASE, created: 'month' }, PAGING, CTX)
    expect(query).toMatchObject({ created_from: '2026-09-01', created_to: '2026-09-18' })
    expect('created' in query).toBe(false)
  })

  it('trims the search', () => {
    expect(buildBrandListQuery({ ...BASE, q: '  sony  ' }, PAGING, CTX).q).toBe('sony')
  })
})

describe('brandExportMetaLines', () => {
  it('says what narrowed the file, so it can be checked against the screen', () => {
    const lines = brandExportMetaLines(
      { ...BASE, q: 'sony', status: 'active', created: 'month', hasItems: '0' },
      { from: '2026-09-01', to: '2026-09-18' },
    )
    expect(lines).toEqual([
      'Search: sony',
      'Status: Active only',
      'Created: This month (2026-09-01 to 2026-09-18)',
      'Linkage: brands with no items only',
    ])
  })

  it('says nothing when nothing was filtered', () => {
    expect(brandExportMetaLines(BASE, { from: '', to: '' })).toEqual([])
  })
})
