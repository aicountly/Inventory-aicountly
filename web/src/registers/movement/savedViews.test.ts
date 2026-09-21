import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_SAVED_VIEWS,
  deleteView,
  loadSavedViews,
  saveView,
  viewMatchesQuery,
} from './savedViews'

const KEY = 'movement_register'
const ME = 'member-1'
const YOU = 'member-2'

/** Minimal localStorage, so the storage path is exercised in the node suite. */
class MemoryStorage {
  private map = new Map<string, string>()
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

describe('saved views are scoped to the member who saved them', () => {
  it('does not show one person their colleague’s views on a shared machine', () => {
    saveView(KEY, ME, 'Chennai receipts', 'warehouse_id=3&direction=in')
    expect(loadSavedViews(KEY, ME)).toHaveLength(1)
    expect(loadSavedViews(KEY, YOU)).toHaveLength(0)
  })

  it('keeps two registers’ views apart', () => {
    saveView(KEY, ME, 'Mine', 'direction=in')
    expect(loadSavedViews('stock_balances', ME)).toHaveLength(0)
  })

  it('stores nothing at all until the member is known', () => {
    // The uuid arrives with /v1/access/me. A view written before it would be filed under
    // a key nobody reads again, so it is not written — the menu waits instead.
    expect(saveView(KEY, null, 'Too early', 'direction=in')).toHaveLength(0)
    expect(loadSavedViews(KEY, null)).toHaveLength(0)
  })
})

describe('saving', () => {
  it('replaces a view of the same name rather than stacking a second one', () => {
    saveView(KEY, ME, 'Receipts', 'direction=in')
    const views = saveView(KEY, ME, 'receipts', 'direction=in&warehouse_id=3')
    expect(views).toHaveLength(1)
    expect(views[0].query).toBe('direction=in&warehouse_id=3')
  })

  it('trims the name and drops the leading question mark from the query', () => {
    const [view] = saveView(KEY, ME, '  Receipts  ', '?direction=in')
    expect(view.name).toBe('Receipts')
    expect(view.query).toBe('direction=in')
  })

  it('ignores an empty name instead of filing an unnamed view', () => {
    expect(saveView(KEY, ME, '   ', 'direction=in')).toHaveLength(0)
  })

  it('lists the newest first and stops at the cap', () => {
    for (let i = 0; i < MAX_SAVED_VIEWS + 5; i += 1) saveView(KEY, ME, `View ${i}`, `page=${i}`)
    const views = loadSavedViews(KEY, ME)
    expect(views).toHaveLength(MAX_SAVED_VIEWS)
    expect(views[0].name).toBe(`View ${MAX_SAVED_VIEWS + 4}`)
  })
})

describe('deleting', () => {
  it('removes just the one', () => {
    saveView(KEY, ME, 'A', 'a=1')
    const [b] = saveView(KEY, ME, 'B', 'b=1')
    const left = deleteView(KEY, ME, b.id)
    expect(left.map((v) => v.name)).toEqual(['A'])
  })
})

describe('reading a corrupted store', () => {
  it('returns nothing rather than throwing the register down', () => {
    store.setItem(`inventory.registers.views.${KEY}.${ME}`, '{not json')
    expect(loadSavedViews(KEY, ME)).toEqual([])
  })

  it('drops entries that are not views', () => {
    store.setItem(
      `inventory.registers.views.${KEY}.${ME}`,
      JSON.stringify([{ id: 'x' }, { id: 'y', name: 'Good', query: 'a=1', savedAt: 1 }]),
    )
    expect(loadSavedViews(KEY, ME).map((v) => v.name)).toEqual(['Good'])
  })
})

describe('viewMatchesQuery', () => {
  const view = { id: 'v', name: 'V', query: 'from=2026-04-01&to=2026-09-19', savedAt: 1 }

  it('matches the same question written in a different order', () => {
    expect(viewMatchesQuery(view, '?to=2026-09-19&from=2026-04-01')).toBe(true)
  })

  it('ignores keys left empty, which is how the URL carries a cleared filter', () => {
    expect(viewMatchesQuery(view, '?from=2026-04-01&to=2026-09-19&q=')).toBe(true)
  })

  it('does not match a different question', () => {
    expect(viewMatchesQuery(view, '?from=2026-04-01&to=2026-09-18')).toBe(false)
    expect(viewMatchesQuery(view, '')).toBe(false)
  })
})

describe('a browser that refuses storage', () => {
  it('keeps the register working, and simply remembers nothing', () => {
    delete globalWithWindow.window
    expect(() => saveView(KEY, ME, 'A', 'a=1')).not.toThrow()
    expect(loadSavedViews(KEY, ME)).toEqual([])
  })
})
