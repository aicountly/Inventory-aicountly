import { beforeEach, describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import { EMPTY_DISPATCH, EMPTY_TRANSPORT } from './challanMeta'
import { deleteTemplate, linesFromTemplate, listTemplates, saveTemplate, templateFromDraft } from './templates'

const spec = specForCode('DELIVERY_CHALLAN')!

/** The unit suite runs in node, where there is no window. */
function installStorage(): void {
  const data = new Map<string, string>()
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }
}

beforeEach(() => {
  installStorage()
})

function draft() {
  return {
    header: { ...newHeader(spec, '2026-09-18'), party_ref: '1042', party_name: 'Acme Ltd', default_warehouse_id: 3, returnable: true, narration: 'Weekly run' },
    lines: [
      newLine(spec, { item_id: 10, item_name: 'Laptop', item_sku: 'DEL-14-001', unit_id: 1, warehouse_id: 3, qty: '5', track_batch: true }),
      newLine(spec, { item_id: 11, item_name: 'Mouse', item_sku: 'WM-001', unit_id: 1, warehouse_id: 3, qty: '10' }),
      // A blank line the user never filled in: a template must not carry it.
      newLine(spec),
    ],
    transport: { ...EMPTY_TRANSPORT, vehicle_no: 'MH12AB1234' },
    dispatch: { ...EMPTY_DISPATCH, customer_ref: 'PO-42' },
  }
}

describe('templateFromDraft', () => {
  it('keeps the items and the header choices, and drops lines with no item', () => {
    const t = templateFromDraft({ name: 'Weekly spares', cmpId: 7, ...draft() })
    expect(t.lines).toHaveLength(2)
    expect(t.lines[0]).toMatchObject({ item_id: 10, item_sku: 'DEL-14-001', qty: '5' })
    expect(t.header).toMatchObject({ party_ref: '1042', returnable: true, default_warehouse_id: 3 })
    expect(t.transport.vehicle_no).toBe('MH12AB1234')
    expect(t.dispatch.customer_ref).toBe('PO-42')
    expect(t.cmp_id).toBe(7)
  })

  it('never carries batch or serial selections', () => {
    const t = templateFromDraft({ name: 'x', cmpId: 7, ...draft() })
    expect(Object.keys(t.lines[0])).not.toContain('batch_id')
    expect(Object.keys(t.lines[0])).not.toContain('serials')
  })

  it('falls back to a name rather than storing an empty one', () => {
    expect(templateFromDraft({ name: '   ', cmpId: 7, ...draft() }).name).toBe('Untitled template')
  })
})

describe('storage', () => {
  it('saves, lists per company and deletes', () => {
    const mine = templateFromDraft({ name: 'Mine', cmpId: 7, ...draft() })
    const theirs = templateFromDraft({ name: 'Theirs', cmpId: 8, ...draft() })
    expect(saveTemplate(mine)).toBe(true)
    expect(saveTemplate(theirs)).toBe(true)
    expect(listTemplates(7).map((t) => t.name)).toEqual(['Mine'])
    expect(listTemplates(8).map((t) => t.name)).toEqual(['Theirs'])
    expect(listTemplates(null)).toEqual([])
    deleteTemplate(mine.id)
    expect(listTemplates(7)).toEqual([])
  })

  it('treats unreadable storage as "no templates" rather than crashing', () => {
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    }
    expect(listTemplates(7)).toEqual([])
    expect(saveTemplate(templateFromDraft({ name: 'x', cmpId: 7, ...draft() }))).toBe(false)
  })
})

describe('linesFromTemplate', () => {
  it('rebuilds draft lines with fresh keys and no batch or serial', () => {
    const t = templateFromDraft({ name: 'Weekly', cmpId: 7, ...draft() })
    const lines = linesFromTemplate(t, spec, 9)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ item_id: 10, qty: '5', warehouse_id: 3, batch_id: null, batch_no: null })
    expect(lines[0].serials).toEqual([])
    expect(new Set(lines.map((l) => l.key)).size).toBe(2)
  })

  it('uses the fallback warehouse when the template line named none', () => {
    const t = templateFromDraft({ name: 'Weekly', cmpId: 7, ...draft() })
    t.lines[0].warehouse_id = null
    expect(linesFromTemplate(t, spec, 9)[0].warehouse_id).toBe(9)
  })
})
