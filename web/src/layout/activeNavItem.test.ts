import { describe, expect, it } from 'vitest'
import { activeNavKey } from './activeNavItem'
import { SIDEBAR_NAV } from '../config/navRegistry'

/**
 * Exactly one section of the rail may be lit.
 *
 * `/registers/stock-balances` is the case that prompted this: "Stock" points
 * straight at it and "Registers" is its URL prefix, so NavLink's per-link
 * answer lit both and the rail stopped saying where you were.
 */
describe('activeNavKey', () => {
  it('gives the stock register to Stock, not to Registers as well', () => {
    expect(activeNavKey('/registers/stock-balances', SIDEBAR_NAV)).toBe('stock')
  })

  it('gives the registers hub itself to Registers', () => {
    expect(activeNavKey('/registers', SIDEBAR_NAV)).toBe('registers')
  })

  it('gives a register only Registers lists to Registers', () => {
    expect(activeNavKey('/registers/pending-quantities', SIDEBAR_NAV)).toBe('registers')
  })

  it('gives the valuation register to Valuation', () => {
    expect(activeNavKey('/registers/valuation', SIDEBAR_NAV)).toBe('valuation')
  })

  it('matches a child route through its section', () => {
    expect(activeNavKey('/items/new', SIDEBAR_NAV)).toBe('items')
  })

  it('names nothing on a route no section owns', () => {
    expect(activeNavKey('/nowhere', SIDEBAR_NAV)).toBeNull()
  })

  /**
   * The property the rail actually depends on: whatever the URL, at most one
   * key comes back. Asserted over every destination the nav itself offers, so
   * a register added later cannot quietly reintroduce the double highlight.
   */
  it('never names two sections, for any route in the navigation', () => {
    const paths = new Set<string>()
    for (const item of SIDEBAR_NAV) {
      paths.add(item.path)
      for (const column of item.megaMenu ?? []) {
        for (const leaf of column.items) if (leaf.path) paths.add(leaf.path)
      }
    }
    expect(paths.size).toBeGreaterThan(10)
    for (const path of paths) {
      const key = activeNavKey(path.split('?')[0], SIDEBAR_NAV)
      expect(key, `${path} lights no section`).not.toBeNull()
      const lit = SIDEBAR_NAV.filter((i) => i.key === key)
      expect(lit, `${path} lights more than one section`).toHaveLength(1)
    }
  })

  it('prefers a section that owns the route over one that merely lists it', () => {
    const nav = [
      { key: 'hub', label: 'Hub', icon: (() => null) as never, path: '/x', megaMenu: [{ label: 'All', items: [{ label: 'Leaf', path: '/x/leaf' }] }] },
      { key: 'own', label: 'Own', icon: (() => null) as never, path: '/x/leaf' },
    ] as const
    expect(activeNavKey('/x/leaf', nav as never)).toBe('own')
  })
})
