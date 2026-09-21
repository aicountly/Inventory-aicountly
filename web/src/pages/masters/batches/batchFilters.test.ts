import { describe, expect, it } from 'vitest'
import { activeAdvancedCount, describeFilters, hasAnyFilter, toApiFilters } from './batchFilters'

describe('activeAdvancedCount', () => {
  it('counts only what the collapsed panel hides', () => {
    // The toolbar shows these, so they are not what the badge is for.
    expect(activeAdvancedCount({ state: 'expired', item_id: '4', warehouse_id: '2', expiry: 'd30' })).toBe(0)
    expect(activeAdvancedCount({ brand_id: '7', lot_no: 'LOT-1' })).toBe(2)
  })

  it('does not count the dates a preset wrote on the reader’s behalf', () => {
    expect(activeAdvancedCount({ expiry: 'd30', expiry_from: '2026-09-21', expiry_to: '2026-10-21' })).toBe(0)
    expect(activeAdvancedCount({ has_expiry: '0' })).toBe(0)
  })

  it('ignores a key that is present but empty', () => {
    expect(activeAdvancedCount({ brand_id: '', lot_no: 'x' })).toBe(1)
  })
})

describe('hasAnyFilter', () => {
  it('is true for a search alone and false for nothing at all', () => {
    expect(hasAnyFilter({}, '')).toBe(false)
    expect(hasAnyFilter({}, 'BCH')).toBe(true)
    expect(hasAnyFilter({ state: 'expired' }, '')).toBe(true)
    expect(hasAnyFilter({ state: '' }, '')).toBe(false)
  })
})

describe('describeFilters', () => {
  it('writes the lines an export header carries', () => {
    const lines = describeFilters(
      { state: 'expiring_soon', warehouse_id: '2', lot_no: 'LOT-4587', stock: 'positive' },
      'BCH',
      { warehouse: 'Main Warehouse' },
    )
    expect(lines).toEqual([
      'Search: BCH',
      'Status: Expiring soon',
      'Warehouse: Main Warehouse',
      'Lot number: LOT-4587',
      'Stock: On hand above zero',
    ])
  })

  it('names an id it could not resolve rather than dropping the filter', () => {
    expect(describeFilters({ item_id: '12' }, '')).toEqual(['Item: #12'])
  })

  it('describes a preset by its label and a custom range by its dates', () => {
    expect(describeFilters({ expiry: 'd30', expiry_from: '2026-09-21', expiry_to: '2026-10-21' }, '')).toEqual([
      'Expiry: Next 30 days',
    ])
    expect(describeFilters({ expiry: 'custom', expiry_from: '2026-01-01' }, '')).toEqual([
      'Expiry: 01 Jan 2026 to any',
    ])
    expect(describeFilters({ expiry: 'none', has_expiry: '0' }, '')).toEqual(['Expiry: No expiry date'])
  })

  it('says nothing at all when nothing is filtered', () => {
    expect(describeFilters({}, '')).toEqual([])
  })
})

describe('toApiFilters', () => {
  it('drops empties and the toolbar-only preset key', () => {
    expect(
      toApiFilters({ state: 'expired', expiry: 'd30', expiry_from: '2026-09-21', brand_id: '' }),
    ).toEqual({ state: 'expired', expiry_from: '2026-09-21' })
  })
})
