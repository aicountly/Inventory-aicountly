import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearColumnPrefs,
  columnPrefsAreDefault,
  defaultColumnVisibility,
  isColumnVisible,
  loadColumnPrefs,
  saveColumnPrefs,
  visibleColumns,
} from './columnPrefs'

const COLUMNS = [
  { key: 'item_name', alwaysVisible: true },
  { key: 'qty' },
  { key: 'value' },
  { key: 'unit_cost', defaultVisible: false },
]

/** Minimal localStorage, so the storage path is exercised in the node suite. */
class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null
  }
}

const globalWithWindow = globalThis as unknown as { window?: { localStorage: MemoryStorage } }
let store: MemoryStorage

beforeEach(() => {
  store = new MemoryStorage()
  globalWithWindow.window = { localStorage: store }
})

afterEach(() => {
  delete globalWithWindow.window
})

describe('defaults', () => {
  it('ships a column on unless it says otherwise, and always-visible wins', () => {
    expect(defaultColumnVisibility(COLUMNS)).toEqual({
      item_name: true,
      qty: true,
      value: true,
      unit_cost: false,
    })
    expect(defaultColumnVisibility([])).toEqual({})
  })

  it('answers for a column a partial map never mentions', () => {
    expect(isColumnVisible({ key: 'qty' }, {})).toBe(true)
    expect(isColumnVisible({ key: 'unit_cost', defaultVisible: false }, {})).toBe(false)
    expect(isColumnVisible({ key: 'item_name', alwaysVisible: true }, { item_name: false })).toBe(true)
    expect(isColumnVisible({ key: '' }, {})).toBe(false)
  })

  it('filters the column list in declared order', () => {
    expect(visibleColumns(COLUMNS, { qty: false }).map((c) => c.key)).toEqual(['item_name', 'value'])
  })

  it('knows when nothing has been moved from the shipped set', () => {
    expect(columnPrefsAreDefault(COLUMNS, defaultColumnVisibility(COLUMNS))).toBe(true)
    expect(columnPrefsAreDefault(COLUMNS, { ...defaultColumnVisibility(COLUMNS), qty: false })).toBe(false)
  })
})

describe('per-user storage', () => {
  it('round-trips a choice for one user', () => {
    saveColumnPrefs('movement_register', { qty: false, value: true }, 'user-a')
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a')).toEqual({
      item_name: true,
      qty: false,
      value: true,
      unit_cost: false,
    })
  })

  it('keeps one signed-in user’s choice away from the next', () => {
    // The whole reason the key carries the uuid: on a shared machine, turning
    // a unit-cost column on must not follow the next person who signs in.
    saveColumnPrefs('movement_register', { unit_cost: true }, 'user-a')
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-b').unit_cost).toBe(false)
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a').unit_cost).toBe(true)
  })

  it('keeps one register’s choice away from another', () => {
    saveColumnPrefs('movement_register', { qty: false }, 'user-a')
    expect(loadColumnPrefs('stock_ledger', COLUMNS, 'user-a').qty).toBe(true)
  })

  it('falls back to defaults before the user is known', () => {
    saveColumnPrefs('movement_register', { qty: false }, null)
    expect(store.length).toBe(0)
    expect(loadColumnPrefs('movement_register', COLUMNS, null)).toEqual(defaultColumnVisibility(COLUMNS))
    expect(loadColumnPrefs('', COLUMNS, 'user-a')).toEqual(defaultColumnVisibility(COLUMNS))
  })

  it('ignores stored junk rather than failing the render', () => {
    store.setItem('inventory.reports.columns.movement_register.user-a', 'not json')
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a')).toEqual(defaultColumnVisibility(COLUMNS))

    store.setItem('inventory.reports.columns.movement_register.user-a', '[1,2]')
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a')).toEqual(defaultColumnVisibility(COLUMNS))
  })

  it('only honours real booleans, so a truthy value cannot switch a column on', () => {
    store.setItem(
      'inventory.reports.columns.movement_register.user-a',
      JSON.stringify({ unit_cost: 'yes', qty: 0, value: false }),
    )
    const loaded = loadColumnPrefs('movement_register', COLUMNS, 'user-a')
    expect(loaded.unit_cost).toBe(false)
    expect(loaded.qty).toBe(true)
    expect(loaded.value).toBe(false)
  })

  it('cannot hide a column the register marks always-visible', () => {
    store.setItem(
      'inventory.reports.columns.movement_register.user-a',
      JSON.stringify({ item_name: false }),
    )
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a').item_name).toBe(true)
  })

  it('gives a column added in a later release its own default, not "hidden"', () => {
    store.setItem('inventory.reports.columns.movement_register.user-a', JSON.stringify({ qty: false }))
    const withNewColumn = [...COLUMNS, { key: 'batch_no' }]
    expect(loadColumnPrefs('movement_register', withNewColumn, 'user-a').batch_no).toBe(true)
  })

  it('clears back to the shipped columns', () => {
    saveColumnPrefs('movement_register', { qty: false }, 'user-a')
    clearColumnPrefs('movement_register', 'user-a')
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a')).toEqual(defaultColumnVisibility(COLUMNS))
  })

  it('survives storage being unavailable entirely', () => {
    delete globalWithWindow.window
    expect(() => saveColumnPrefs('movement_register', { qty: false }, 'user-a')).not.toThrow()
    expect(() => clearColumnPrefs('movement_register', 'user-a')).not.toThrow()
    expect(loadColumnPrefs('movement_register', COLUMNS, 'user-a')).toEqual(defaultColumnVisibility(COLUMNS))
  })
})
