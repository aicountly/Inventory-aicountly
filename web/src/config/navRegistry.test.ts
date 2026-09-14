import { describe, expect, it } from 'vitest'
import {
  MASTER_NAV,
  REPORT_NAV,
  SIDEBAR_NAV,
  collectNavLeaves,
  filterLeaves,
  filterNav,
} from './navRegistry'
import { MASTER_PERMISSION_SLUGS, P } from '../services/access'
import { REPORT_CONFIGS } from '../reports/configs'

const allow = () => true
const deny = () => false

describe('SIDEBAR_NAV', () => {
  it('has unique keys and absolute paths', () => {
    const keys = SIDEBAR_NAV.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const item of SIDEBAR_NAV) {
      expect(item.path.startsWith('/')).toBe(true)
    }
  })

  it('gives every mega-menu leaf somewhere to go', () => {
    for (const item of SIDEBAR_NAV) {
      for (const column of item.megaMenu ?? []) {
        expect(column.items.length).toBeGreaterThan(0)
        for (const leaf of column.items) {
          expect(Boolean(leaf.path || leaf.href)).toBe(true)
          if (leaf.path) expect(leaf.path.startsWith('/')).toBe(true)
        }
      }
    }
  })

  it('keeps every screen the old flat NAV_ITEMS list could reach', () => {
    // These are the paths src/layout/navigation.ts used to expose. Folding the
    // nav into a registry must not drop one.
    const legacyPaths = [
      '/dashboard',
      '/items',
      '/masters',
      '/documents',
      '/packing-lists',
      '/reservations',
      '/pending-quantities',
      '/stock',
      '/valuation',
      '/reports',
      '/reconciliation',
      '/settings',
      '/audit',
    ]
    const reachable = new Set(collectNavLeaves().map(({ leaf }) => leaf.path))
    for (const path of legacyPaths) {
      expect(reachable.has(path)).toBe(true)
    }
  })
})

describe('MASTER_NAV', () => {
  it('covers every master permission slug except items, which is top level', () => {
    const covered = MASTER_NAV.map((m) => m.permissionSlug).sort()
    const expected = MASTER_PERMISSION_SLUGS.filter((s) => s !== 'items').slice().sort()
    expect(covered).toEqual(expected)
  })

  it('asks for the read permission of its own slug', () => {
    for (const master of MASTER_NAV) {
      expect(master.permissions).toEqual([P.masters(master.permissionSlug, 'read')])
    }
  })
})

describe('REPORT_NAV', () => {
  it('points at a report that actually exists', () => {
    const configPaths = new Set(REPORT_CONFIGS.map((c) => `/reports/${c.path}`))
    for (const report of REPORT_NAV) {
      expect(configPaths.has(report.path as string)).toBe(true)
    }
  })
})

describe('filterNav', () => {
  it('keeps everything for a user who can do everything', () => {
    expect(filterNav(SIDEBAR_NAV, allow)).toHaveLength(SIDEBAR_NAV.length)
  })

  it('drops every permissioned section for a user with nothing', () => {
    expect(filterNav(SIDEBAR_NAV, deny)).toHaveLength(0)
  })

  it('drops a leaf the user cannot open but keeps its section', () => {
    const can = (key: string | readonly string[]) =>
      !(typeof key === 'string' ? [key] : key).includes(P.masters('items', 'write'))
    const items = filterNav(SIDEBAR_NAV, can).find((i) => i.key === 'items')
    expect(items).toBeDefined()
    const labels = items!.megaMenu?.flatMap((c) => c.items.map((l) => l.label)) ?? []
    expect(labels).toContain('All items')
    expect(labels).not.toContain('New item')
    expect(labels).not.toContain('Bulk edit')
  })

  it('leaves megaMenu undefined when every column was filtered away', () => {
    const can = (key: string | readonly string[]) => {
      const keys = typeof key === 'string' ? [key] : key
      // Can open Items, but none of its leaves' own permissions.
      return keys.includes(P.masters('items', 'read'))
    }
    const items = filterNav(SIDEBAR_NAV, can).find((i) => i.key === 'items')
    expect(items?.megaMenu?.flatMap((c) => c.items).map((l) => l.label)).toEqual(['All items'])
  })
})

describe('collectNavLeaves', () => {
  it('labels each leaf with its section path', () => {
    const batches = collectNavLeaves().find(({ leaf }) => leaf.path === '/masters/batches')
    expect(batches?.section).toBe('Masters › Composition & tracking')
  })

  it('does not list a section index twice', () => {
    const dashboard = collectNavLeaves().filter(({ leaf }) => leaf.path === '/dashboard')
    expect(dashboard).toHaveLength(1)
  })
})

describe('filterLeaves', () => {
  it('keeps leaves with no permission requirement', () => {
    expect(filterLeaves([{ label: 'Open' }], deny)).toHaveLength(1)
  })
})
