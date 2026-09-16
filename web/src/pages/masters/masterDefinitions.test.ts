import { describe, expect, it } from 'vitest'
import { MASTER_NAV } from '../../config/navRegistry'
import { MASTER_PERMISSION_SLUGS } from '../../services/access'
import { AUDIT_ENTITY_TYPES } from '../../services/auditApi'
import { MASTER_AUDIT_ENTITIES, MASTER_DEFINITIONS, canReadMaster, canWriteMaster } from './masterDefinitions'

/**
 * The landing page must not become a second, drifting description of the
 * masters. These tests hold it to the registry the sidebar reads and to the
 * routes that already exist — a card that points somewhere the router does not
 * serve is a 404 nobody notices until a user clicks it.
 */

describe('MASTER_DEFINITIONS', () => {
  it('has one card per master permission slug — that is the "Master Types" figure', () => {
    expect(MASTER_DEFINITIONS.map((m) => m.permissionSlug).sort()).toEqual(
      MASTER_PERMISSION_SLUGS.slice().sort(),
    )
    // The summary card counts this array; it is 11 today and must change only
    // when a master really is added.
    expect(MASTER_DEFINITIONS).toHaveLength(11)
  })

  it('keys are unique and usable as a stat lookup', () => {
    const keys = MASTER_DEFINITIONS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('takes its labels, descriptions, routes and icons from the navigation registry', () => {
    for (const nav of MASTER_NAV) {
      const def = MASTER_DEFINITIONS.find((m) => m.permissionSlug === nav.permissionSlug)
      expect(def, nav.permissionSlug).toBeDefined()
      expect(def!.title).toBe(nav.label)
      expect(def!.description).toBe(nav.description)
      expect(def!.route).toBe(nav.path)
      expect(def!.icon).toBe(nav.icon)
    }
  })

  it('carries Items itself, because it is a top-level route and not a /masters child', () => {
    const items = MASTER_DEFINITIONS.find((m) => m.key === 'items')
    expect(items).toMatchObject({ route: '/items', createRoute: '/items/new', essential: true })
  })

  it('only points at routes the app already serves', () => {
    const known = new Set<string>(['/items', ...MASTER_NAV.map((m) => m.path)])
    for (const master of MASTER_DEFINITIONS) {
      expect(known.has(master.route), master.route).toBe(true)
    }
  })

  it('creates through an existing form: a routed page, or the list deep-linked with ?new=1', () => {
    const routedForms: Record<string, string> = {
      items: '/items/new',
      'bill-of-materials': '/masters/bill-of-materials/new',
    }
    for (const master of MASTER_DEFINITIONS) {
      const expected = routedForms[master.key] ?? `${master.route}?new=1`
      expect(master.createRoute, master.key).toBe(expected)
    }
  })

  it('names an audit entity type the API actually writes', () => {
    for (const entity of MASTER_AUDIT_ENTITIES) {
      expect(AUDIT_ENTITY_TYPES as readonly string[]).toContain(entity)
    }
    expect(new Set(MASTER_AUDIT_ENTITIES).size).toBe(MASTER_AUDIT_ENTITIES.length)
  })

  it('treats exactly the masters Inventory cannot post without as essential', () => {
    expect(MASTER_DEFINITIONS.filter((m) => m.essential).map((m) => m.key).sort()).toEqual([
      'items',
      'uom',
      'warehouses',
    ])
  })

  it('asks for its own master permissions, never a borrowed one', () => {
    for (const master of MASTER_DEFINITIONS) {
      expect(canReadMaster(master)).toBe(`masters.${master.permissionSlug}.read`)
      expect(canWriteMaster(master)).toBe(`masters.${master.permissionSlug}.write`)
    }
  })
})
