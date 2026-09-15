import { describe, expect, it } from 'vitest'
import { readPinnedCompanies, togglePinnedCompany } from './pinnedCompanies'
import type { KeyValueStore } from './pinnedCompanies'

function fakeStore(initial: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

describe('pinnedCompanies', () => {
  it('reads an empty set from an empty or missing store', () => {
    expect(readPinnedCompanies(fakeStore())).toEqual(new Set())
    expect(readPinnedCompanies(null)).toEqual(new Set())
  })

  it('toggles a company on, then off', () => {
    const store = fakeStore()
    const afterFirst = togglePinnedCompany(12, store)
    expect(afterFirst.has(12)).toBe(true)
    expect(readPinnedCompanies(store).has(12)).toBe(true)

    const afterSecond = togglePinnedCompany(12, store)
    expect(afterSecond.has(12)).toBe(false)
    expect(readPinnedCompanies(store).has(12)).toBe(false)
  })

  it('keeps several pins independent of each other', () => {
    const store = fakeStore()
    togglePinnedCompany(1, store)
    togglePinnedCompany(2, store)
    togglePinnedCompany(3, store)
    togglePinnedCompany(2, store) // unpin just this one
    expect(readPinnedCompanies(store)).toEqual(new Set([1, 3]))
  })

  it('removes the key entirely once nothing is pinned, rather than storing "[]" forever', () => {
    const store = fakeStore()
    togglePinnedCompany(9, store)
    expect(store.map.has('inventory.company.pinned')).toBe(true)
    togglePinnedCompany(9, store)
    expect(store.map.has('inventory.company.pinned')).toBe(false)
  })

  it('discards corrupt or foreign JSON as "nothing pinned" rather than throwing', () => {
    expect(readPinnedCompanies(fakeStore({ 'inventory.company.pinned': '{not json' }))).toEqual(new Set())
    expect(readPinnedCompanies(fakeStore({ 'inventory.company.pinned': '"a string"' }))).toEqual(new Set())
    expect(readPinnedCompanies(fakeStore({ 'inventory.company.pinned': '[1, "x", -2, 3.5, 4]' }))).toEqual(new Set([1, 4]))
  })
})
