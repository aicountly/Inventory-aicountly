import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATES,
  deleteTemplate,
  loadTemplates,
  saveTemplate,
  templatesAvailable,
} from './bulkEditTemplates'
import type { TemplateDraft } from './bulkEditTemplates'

/**
 * Templates live in the browser, per member and per company.
 *
 * The properties that matter are the ones a reader would otherwise discover the
 * hard way: another person signing in on the same machine must not inherit
 * them, another company must not either, and a browser that refuses to store
 * must not be told the save worked.
 */

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

const ME = { cmpId: 1, userUuid: 'member-1' }
const YOU = { cmpId: 1, userUuid: 'member-2' }
const OTHER_COMPANY = { cmpId: 2, userUuid: 'member-1' }

const draft = (partial: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: 'Quarterly reorder points',
  field: 'reorder_point_qty',
  value: '25',
  groupId: '5',
  status: 'active',
  ...partial,
})

beforeEach(() => {
  globalWithWindow.window = { localStorage: new MemoryStorage() }
})

afterEach(() => {
  delete globalWithWindow.window
})

describe('saving and reading back', () => {
  it('keeps the question — the field, the value and the filters', () => {
    const saved = saveTemplate(ME, draft())
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      name: 'Quarterly reorder points',
      field: 'reorder_point_qty',
      value: '25',
      groupId: '5',
      status: 'active',
    })
  })

  it('never keeps a list of items', () => {
    const saved = saveTemplate(ME, draft())[0] as unknown as Record<string, unknown>
    expect(Object.keys(saved).sort()).toEqual(['field', 'groupId', 'id', 'name', 'savedAt', 'status', 'value'])
  })

  it('replaces a template of the same name instead of stacking a second one', () => {
    saveTemplate(ME, draft({ value: '25' }))
    const after = saveTemplate(ME, draft({ name: 'quarterly REORDER points', value: '40' }))
    expect(after).toHaveLength(1)
    expect(after[0].value).toBe('40')
  })

  it('refuses a nameless template rather than saving an unfindable one', () => {
    expect(saveTemplate(ME, draft({ name: '   ' }))).toEqual([])
  })

  it('returns them newest first', () => {
    saveTemplate(ME, draft({ name: 'One' }))
    saveTemplate(ME, draft({ name: 'Two' }))
    expect(loadTemplates(ME).map((t) => t.name)).toEqual(['Two', 'One'])
  })

  it('keeps a working set rather than an unbounded filing system', () => {
    for (let i = 0; i < MAX_TEMPLATES + 5; i += 1) saveTemplate(ME, draft({ name: `T${i}` }))
    expect(loadTemplates(ME)).toHaveLength(MAX_TEMPLATES)
  })
})

describe('scope', () => {
  it('does not show one member’s templates to the next person on the machine', () => {
    saveTemplate(ME, draft())
    expect(loadTemplates(YOU)).toEqual([])
  })

  it('does not carry a template built for one company into another', () => {
    saveTemplate(ME, draft())
    expect(loadTemplates(OTHER_COMPANY)).toEqual([])
  })

  it('stores nothing at all before the member is known', () => {
    expect(templatesAvailable({ cmpId: 1, userUuid: null })).toBe(false)
    expect(saveTemplate({ cmpId: 1, userUuid: null }, draft())).toEqual([])
  })
})

describe('a browser that will not store', () => {
  it('reports templates as unavailable rather than pretending', () => {
    delete globalWithWindow.window
    expect(templatesAvailable(ME)).toBe(false)
    expect(loadTemplates(ME)).toEqual([])
  })

  it('hands back what can actually be read, so a silent failure is visible', () => {
    globalWithWindow.window = {
      localStorage: Object.assign(new MemoryStorage(), {
        setItem() {
          throw new Error('QuotaExceededError')
        },
      }),
    }
    expect(saveTemplate(ME, draft())).toEqual([])
  })
})

describe('deleting', () => {
  it('removes just the one asked for', () => {
    saveTemplate(ME, draft({ name: 'One' }))
    const two = saveTemplate(ME, draft({ name: 'Two' }))
    const id = two.find((t) => t.name === 'Two')?.id as string
    expect(deleteTemplate(ME, id).map((t) => t.name)).toEqual(['One'])
  })
})

describe('corrupt storage', () => {
  it('reads as empty rather than throwing on the way into the page', () => {
    globalWithWindow.window!.localStorage.setItem('inventory.items.bulkEditTemplates.1.member-1', 'not json')
    expect(loadTemplates(ME)).toEqual([])
  })

  it('drops entries that are not templates', () => {
    globalWithWindow.window!.localStorage.setItem(
      'inventory.items.bulkEditTemplates.1.member-1',
      JSON.stringify([{ nope: true }, { id: 'a', name: 'Keep', field: 'mrp', value: '', groupId: '', status: '', savedAt: 1 }]),
    )
    expect(loadTemplates(ME).map((t) => t.name)).toEqual(['Keep'])
  })
})
