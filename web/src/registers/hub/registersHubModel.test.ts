import { describe, expect, it } from 'vitest'
import { buildRegisterHubSections } from './registersHubModel'
import { REGISTER_CONFIGS, REGISTER_GROUP_ORDER } from '../configs'
import { registerPermission, registerRoute } from '../RegisterConfig'

const allowAll = () => true

function flatten() {
  return buildRegisterHubSections(allowAll).flatMap((section) => section.tiles)
}

describe('buildRegisterHubSections', () => {
  it('dresses the catalogue without editing it: every register, at its own route', () => {
    const tiles = flatten()
    expect(tiles).toHaveLength(REGISTER_CONFIGS.length)
    for (const config of REGISTER_CONFIGS) {
      const tile = tiles.find((t) => t.title === config.title)
      expect(tile, config.title).toBeDefined()
      expect(tile!.to).toBe(registerRoute(config))
    }
  })

  it('keeps the sections in the order the hub has always shown them', () => {
    const keys = buildRegisterHubSections(allowAll).map((s) => s.key)
    expect(keys).toEqual(REGISTER_GROUP_ORDER)
  })

  it('gives every tile a description, so no card renders with an empty second line', () => {
    for (const tile of flatten()) {
      expect(tile.description.length, tile.title).toBeGreaterThan(0)
    }
  })

  it('marks only the three most-opened registers with a visual — a mark on every card is wallpaper', () => {
    const marked = flatten().filter((t) => t.visual !== 'none')
    expect(marked.map((t) => t.key).sort()).toEqual(['movement-register', 'stock-ledger', 'valuation'])
    expect(marked.find((t) => t.key === 'movement-register')!.visual).toBe('bars')
    expect(marked.find((t) => t.key === 'stock-ledger')!.visual).toBe('sparkline')
  })

  it('drops a register the reader may not open, and the section with its last one', () => {
    const ledger = REGISTER_CONFIGS.find((c) => c.path === 'stock-ledger')!
    const movement = REGISTER_CONFIGS.find((c) => c.path === 'movement-register')!
    const denied = [ledger, movement].flatMap((c) => {
      const p = registerPermission(c)
      return Array.isArray(p) ? [...p] : [p]
    })
    const can = (key: string | readonly string[]) => {
      const asked = Array.isArray(key) ? key : [key as string]
      return !asked.some((k) => denied.includes(k))
    }
    const sections = buildRegisterHubSections(can)
    expect(sections.map((s) => s.key)).not.toContain('movement')
    // Nothing else moved.
    expect(sections.map((s) => s.key)).toContain('stock')
  })

  it('pairs the insight panel with a lone card, and stops as soon as the row fills', () => {
    const sections = buildRegisterHubSections(allowAll)
    const valuation = sections.find((s) => s.key === 'valuation')!
    expect(valuation.tiles).toHaveLength(1)
    expect(valuation.insight).toBe(true)
    // It is a property of the row's shape, not of valuation: every section
    // with more than one card lays out as an ordinary grid.
    for (const section of sections.filter((s) => s.tiles.length > 1)) {
      expect(section.insight, section.key).toBe(false)
    }
  })

  it('reads the movement section in two columns and the wider ones in three', () => {
    const sections = buildRegisterHubSections(allowAll)
    expect(sections.find((s) => s.key === 'movement')!.columns).toBe(2)
    expect(sections.find((s) => s.key === 'stock')!.columns).toBe(3)
  })
})
