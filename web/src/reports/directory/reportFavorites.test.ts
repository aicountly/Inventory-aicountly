import { describe, expect, it } from 'vitest'
import { readFavorites, toggleFavorite, writeFavorites } from './reportFavorites'
import type { KeyValueStore } from './reportFavorites'

const KNOWN = ['stock-summary', 'near-expiry', 'stock-ledger']

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const KEY = 'inventory.reports.favorites.user-a'

describe('report favourites storage', () => {
  it('reads what was written, for that user', () => {
    const store = fakeStore()
    writeFavorites('user-a', new Set(['near-expiry']), store)
    expect([...readFavorites('user-a', KNOWN, store)]).toEqual(['near-expiry'])
  })

  /* The reason the key is scoped at all: a shared machine. */
  it('does not show one user the reports another starred', () => {
    const store = fakeStore()
    writeFavorites('user-a', new Set(['near-expiry']), store)
    expect([...readFavorites('user-b', KNOWN, store)]).toEqual([])
  })

  it('stores nothing until the user is known', () => {
    const store = fakeStore()
    writeFavorites(null, new Set(['near-expiry']), store)
    expect(store.map.size).toBe(0)
    expect([...readFavorites(null, KNOWN, store)]).toEqual([])
  })

  it('drops an id the directory no longer lists, so a count cannot outlive its card', () => {
    const store = fakeStore({ [KEY]: JSON.stringify(['near-expiry', 'retired-report']) })
    expect([...readFavorites('user-a', KNOWN, store)]).toEqual(['near-expiry'])
  })

  it('survives junk in storage rather than taking the page down', () => {
    expect([...readFavorites('user-a', KNOWN, fakeStore({ [KEY]: 'not json' }))]).toEqual([])
    expect([...readFavorites('user-a', KNOWN, fakeStore({ [KEY]: '{"a":1}' }))]).toEqual([])
    expect([...readFavorites('user-a', KNOWN, fakeStore({ [KEY]: '[1,true,null]' }))]).toEqual([])
  })

  it('removes the key entirely once the last star is cleared', () => {
    const store = fakeStore()
    writeFavorites('user-a', new Set(['near-expiry']), store)
    writeFavorites('user-a', new Set(), store)
    expect(store.map.has(KEY)).toBe(false)
  })

  it('reads as empty when storage is unavailable', () => {
    expect([...readFavorites('user-a', KNOWN, null)]).toEqual([])
    expect(() => writeFavorites('user-a', new Set(['near-expiry']), null)).not.toThrow()
  })

  it('does not throw when storage refuses the write', () => {
    const throwing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(() => writeFavorites('user-a', new Set(['near-expiry']), throwing)).not.toThrow()
  })
})

describe('toggling a favourite', () => {
  it('adds then removes, without mutating the set it was given', () => {
    const start: ReadonlySet<string> = new Set()
    const added = toggleFavorite(start, 'near-expiry')
    expect(start.size).toBe(0)
    expect([...added]).toEqual(['near-expiry'])
    expect([...toggleFavorite(added, 'near-expiry')]).toEqual([])
  })
})
