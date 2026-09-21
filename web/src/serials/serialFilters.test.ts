import { describe, expect, it } from 'vitest'
import {
  SERIAL_FILTER_KEYS,
  activeFilterCount,
  hasAnyFilter,
  serialFilterChips,
  serialListQuery,
  serialSummaryQuery,
} from './serialFilters'

describe('serialFilterChips', () => {
  it('names the filter and resolves the value the reader chose', () => {
    const chips = serialFilterChips(
      { warehouse_id: '12', status: 'in_stock' },
      { warehouse_id: { '12': 'Main Warehouse' }, status: { in_stock: 'In stock' } },
    )
    expect(chips).toEqual([
      { key: 'status', label: 'Status', value: 'In stock' },
      { key: 'warehouse_id', label: 'Warehouse', value: 'Main Warehouse' },
    ])
  })

  it('still shows a chip while the lookup list is in flight', () => {
    // A chip that arrives a second after the rows change reads as the table
    // having filtered itself.
    expect(serialFilterChips({ warehouse_id: '12' })).toEqual([
      { key: 'warehouse_id', label: 'Warehouse', value: '12' },
    ])
  })

  it('spells out the values that are switches, not records', () => {
    const chips = serialFilterChips({ has_batch: '0', placed: '1', warranty_status: 'expiring' })
    expect(chips.map((c) => `${c.label}: ${c.value}`)).toEqual([
      'Warranty: Expiring soon',
      'Batch tracking: No batch',
      'Placement: In a warehouse',
    ])
  })

  it('does not offer to remove the warranty window on its own', () => {
    const chips = serialFilterChips({ warranty_status: 'expiring', warranty_days: '90' })
    expect(chips).toHaveLength(1)
    expect(chips[0].key).toBe('warranty_status')
  })

  it('ignores the view toggle — it is a screen setting, not a filter', () => {
    expect(serialFilterChips({ view: 'cards' })).toEqual([])
    expect(activeFilterCount({ view: 'cards' })).toBe(0)
  })

  it('ignores empty values', () => {
    expect(serialFilterChips({ warehouse_id: '', status: 'in_stock' })).toHaveLength(1)
  })
})

describe('hasAnyFilter', () => {
  it('counts a search as narrowing the list', () => {
    expect(hasAnyFilter({}, '')).toBe(false)
    expect(hasAnyFilter({}, '   ')).toBe(false)
    expect(hasAnyFilter({}, 'SN-1')).toBe(true)
    expect(hasAnyFilter({ status: 'issued' }, '')).toBe(true)
  })
})

describe('serialListQuery', () => {
  it('carries the filters into the request and drops the view toggle', () => {
    expect(serialListQuery({ page: 2, limit: 50 }, { view: 'cards', status: 'in_stock', warehouse_id: '12' })).toEqual({
      page: 2,
      limit: 50,
      status: 'in_stock',
      warehouse_id: '12',
    })
  })

  it('omits empty filters rather than sending them blank', () => {
    // The summary endpoint reads the same parameters; a blank counted on one
    // side and ignored on the other is how a card disagrees with its table.
    expect(serialListQuery({ limit: 50 }, { warehouse_id: '', status: 'issued' })).toEqual({
      limit: 50,
      status: 'issued',
    })
  })
})

describe('serialSummaryQuery', () => {
  it('asks the counters the same question without the paging', () => {
    expect(
      serialSummaryQuery({ q: 'SN', page: 3, limit: 50, offset: 100, sort: 'updated_at', order: 'desc', status: 'in_stock' }),
    ).toEqual({ q: 'SN', status: 'in_stock' })
  })
})

describe('SERIAL_FILTER_KEYS', () => {
  it('has no duplicates — a repeated key silently shadows itself in the URL', () => {
    expect(new Set(SERIAL_FILTER_KEYS).size).toBe(SERIAL_FILTER_KEYS.length)
  })
})
