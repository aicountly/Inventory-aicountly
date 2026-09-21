import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import { clearDraft, draftKey, isWorthKeeping, readDraft, saveDraft } from './draftStorage'

const SPEC = specForCode('STOCK_JOURNAL')!
const SCOPE = { cmpId: 1, boId: 0, fyId: 3 }

/**
 * `environment: node` — the unit project has no DOM, which is exactly the
 * condition local recovery has to survive: no window, no localStorage, no crash.
 */
function withStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  vi.stubGlobal('window', { localStorage: fake })
  return store
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('draftKey', () => {
  it('separates one company, branch, year and document from another', () => {
    expect(draftKey(SCOPE)).not.toBe(draftKey({ ...SCOPE, cmpId: 2 }))
    expect(draftKey(SCOPE)).not.toBe(draftKey({ ...SCOPE, boId: 4 }))
    expect(draftKey(SCOPE)).not.toBe(draftKey({ ...SCOPE, fyId: 4 }))
    expect(draftKey(SCOPE)).not.toBe(draftKey({ ...SCOPE, documentId: 9 }))
    expect(draftKey(SCOPE)).toContain('new')
  })
})

describe('local recovery', () => {
  it('round-trips a draft', () => {
    withStorage()
    const header = { ...newHeader(SPEC, '2026-09-18'), reason_code: 'DAMAGE' }
    const lines = [newLine(SPEC, { item_id: 4, qty: '2' })]
    saveDraft(SCOPE, header, lines)

    const back = readDraft(SCOPE)
    expect(back?.header.reason_code).toBe('DAMAGE')
    expect(back?.lines[0].item_id).toBe(4)
  })

  it('forgets a draft once it is cleared', () => {
    withStorage()
    saveDraft(SCOPE, newHeader(SPEC, '2026-09-18'), [])
    clearDraft(SCOPE)
    expect(readDraft(SCOPE)).toBeNull()
  })

  it('drops a draft older than a day rather than offering stale work back', () => {
    const store = withStorage()
    saveDraft(SCOPE, newHeader(SPEC, '2026-09-18'), [])
    const stored = JSON.parse(store.get(draftKey(SCOPE)) as string)
    stored.savedAt = Date.now() - 25 * 60 * 60 * 1000
    store.set(draftKey(SCOPE), JSON.stringify(stored))
    expect(readDraft(SCOPE)).toBeNull()
  })

  it('ignores a payload from another version, or corrupt JSON', () => {
    const store = withStorage()
    store.set(draftKey(SCOPE), JSON.stringify({ version: 99, savedAt: Date.now(), header: {}, lines: [] }))
    expect(readDraft(SCOPE)).toBeNull()
    store.set(draftKey(SCOPE), 'not json')
    expect(readDraft(SCOPE)).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('window', undefined)
    expect(() => saveDraft(SCOPE, newHeader(SPEC, '2026-09-18'), [])).not.toThrow()
    expect(readDraft(SCOPE)).toBeNull()
    expect(() => clearDraft(SCOPE)).not.toThrow()
  })

  it('never throws when storage refuses to write', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => {},
      },
    })
    expect(() => saveDraft(SCOPE, newHeader(SPEC, '2026-09-18'), [])).not.toThrow()
  })
})

describe('isWorthKeeping', () => {
  const blank = newHeader(SPEC, '2026-09-18')

  it('does not offer an untouched new document back', () => {
    expect(isWorthKeeping(blank, [newLine(SPEC), newLine(SPEC)])).toBe(false)
  })

  it('keeps anything the user actually typed', () => {
    expect(isWorthKeeping({ ...blank, reason_code: 'DAMAGE' }, [])).toBe(true)
    expect(isWorthKeeping({ ...blank, narration: 'note' }, [])).toBe(true)
    expect(isWorthKeeping(blank, [newLine(SPEC, { item_id: 3 })])).toBe(true)
    expect(isWorthKeeping(blank, [newLine(SPEC, { qty: '5' })])).toBe(true)
  })
})
