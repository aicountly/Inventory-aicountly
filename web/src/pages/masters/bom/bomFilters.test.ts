import { describe, expect, it } from 'vitest'
import type { ItemFormOptions } from '../../../services/items'
import {
  BOM_FILTER_KEYS,
  activeFilterCount,
  advancedFilterCount,
  clearedFilters,
  filterSummaryLines,
  toListQuery,
} from './bomFilters'

const options = {
  item_groups: [{ item_grp_id: 4, grp_name: 'Furniture', grp_alias: null, is_primary: 1, parent_grp_id: null }],
  stock_categories: [],
  brands: [],
  units: [],
  warehouses: [],
  valuation_methods: [],
  default_valuation_method: 'FIFO',
  negative_stock_policies: [],
  itc_eligibility_options: [],
} as unknown as ItemFormOptions

describe('toListQuery', () => {
  it('sends only the filters that mean something', () => {
    expect(
      toListQuery({
        status: 'active',
        item_grp_id: '4',
        min_components: '2',
        has_scrap: '1',
        updated_from: '2026-01-01',
        updated_by: 'u-7',
      }),
    ).toEqual({
      status: 'active',
      item_grp_id: 4,
      min_components: 2,
      has_scrap: 1,
      updated_from: '2026-01-01',
      updated_by: 'u-7',
    })
  })

  /*
   * A hand-edited address bar is the input here. A nonsense bound that reached
   * the database would silently narrow somebody's list to nothing, or widen it
   * to everything, with no sign on screen that a filter was even applied.
   */
  it('drops values the API could not act on', () => {
    expect(
      toListQuery({
        status: 'sideways',
        item_grp_id: 'abc',
        min_components: '0',
        max_components: '-3',
        has_scrap: 'yes',
        created_from: '   ',
      }),
    ).toEqual({})
  })

  it('treats an empty filter set as no query at all', () => {
    expect(toListQuery({})).toEqual({})
    expect(toListQuery(clearedFilters())).toEqual({})
  })
})

describe('filter counting', () => {
  it('counts every applied filter', () => {
    expect(activeFilterCount({ status: 'active', has_scrap: '1', min_components: '' })).toBe(2)
  })

  /*
   * The badge on "More filters" must not count the dropdowns sitting next to
   * the button: a reader told there are two hidden filters, who opens the
   * drawer and finds it empty, stops trusting the badge.
   */
  it('excludes the filters the toolbar shows itself', () => {
    expect(advancedFilterCount({ status: 'active', item_grp_id: '4' })).toBe(0)
    expect(advancedFilterCount({ status: 'active', item_grp_id: '4', has_scrap: '1' })).toBe(1)
  })
})

describe('filterSummaryLines', () => {
  it('names each filter in words a reader of the printed sheet can check', () => {
    const lines = filterSummaryLines(
      { status: 'inactive', item_grp_id: '4', min_components: '5', has_scrap: '1', updated_from: '2026-01-01' },
      '  chair  ',
      options,
    )
    expect(lines).toEqual([
      'Search: chair',
      'Status: Inactive only',
      'Item group: Furniture',
      'Minimum components: 5',
      'Scrap: only bills with scrap on a component',
      'Updated: 2026-01-01 to …',
    ])
  })

  it('falls back to the id when the group list has not loaded', () => {
    expect(filterSummaryLines({ item_grp_id: '9' }, '', null)).toEqual(['Item group: #9'])
  })

  it('says nothing when nothing is narrowing the list', () => {
    expect(filterSummaryLines({}, '   ', options)).toEqual([])
  })
})

describe('clearedFilters', () => {
  it('covers every key, so one navigation clears the lot', () => {
    const cleared = clearedFilters()
    expect(Object.keys(cleared).sort()).toEqual([...BOM_FILTER_KEYS].sort())
    expect(Object.values(cleared).every((v) => v === '')).toBe(true)
  })
})
