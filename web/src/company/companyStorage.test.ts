import { describe, expect, it } from 'vitest'
import { clearSelection, readSelection, SELECTED_BO_KEY, SELECTED_COMPANY_KEY, SELECTED_FY_KEY, writeSelection } from './companyStorage'
import type { KeyValueStore } from './companyStorage'

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

describe('companyStorage', () => {
  it('reads nothing from an empty store', () => {
    expect(readSelection(fakeStore())).toEqual({ cmpId: null, fyId: null, boId: null })
    expect(readSelection(null)).toEqual({ cmpId: null, fyId: null, boId: null })
  })

  it('validates values on the way out', () => {
    const store = fakeStore({ [SELECTED_COMPANY_KEY]: '12', [SELECTED_FY_KEY]: 'abc', [SELECTED_BO_KEY]: '0' })
    expect(readSelection(store)).toEqual({ cmpId: 12, fyId: null, boId: 0 })
    expect(readSelection(fakeStore({ [SELECTED_COMPANY_KEY]: '-3', [SELECTED_BO_KEY]: '-1' }))).toEqual({ cmpId: null, fyId: null, boId: null })
  })

  it('writes only the keys given and removes on null', () => {
    const store = fakeStore({ [SELECTED_FY_KEY]: '5' })
    writeSelection({ cmpId: 12, boId: null }, store)
    expect(store.map.get(SELECTED_COMPANY_KEY)).toBe('12')
    expect(store.map.get(SELECTED_FY_KEY)).toBe('5')
    expect(store.map.has(SELECTED_BO_KEY)).toBe(false)
    writeSelection({ fyId: 31, boId: 0 }, store)
    expect(readSelection(store)).toEqual({ cmpId: 12, fyId: 31, boId: 0 })
  })

  it('clears everything', () => {
    const store = fakeStore({ [SELECTED_COMPANY_KEY]: '1', [SELECTED_FY_KEY]: '2', [SELECTED_BO_KEY]: '3' })
    clearSelection(store)
    expect(store.map.size).toBe(0)
  })
})
