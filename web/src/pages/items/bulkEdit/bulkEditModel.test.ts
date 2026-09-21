import { describe, expect, it } from 'vitest'
import type { BulkUpdateResult, ItemListRow } from '../../../services/items'
import { checkNewValue, findBulkField } from './bulkEditFields'
import {
  MAX_PER_APPLY,
  applyGate,
  buildChips,
  buildPayload,
  headerSelectState,
  normalizedKey,
  planBulkEdit,
  selectMissing,
  summarizeOutcome,
  toggleVisibleSelection,
} from './bulkEditModel'

/**
 * The plan: who would change, who would not, and whether Apply may run at all.
 *
 * The recurring theme is that "already has this value" is a separate outcome
 * from both "will update" and "invalid". Everything visible on the screen — the
 * cards, the badge in each row, the number inside the button, the confirmation
 * and the payload — is read off these functions, so a disagreement between them
 * is impossible by construction rather than by review.
 */

function item(partial: Partial<ItemListRow> = {}): ItemListRow {
  return {
    item_id: 1,
    item_name: 'Copper Wire',
    item_alias: null,
    print_name: null,
    item_type: 'stock',
    item_sku: null,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    stock_cat_id: null,
    item_grp_id: null,
    brand_id: null,
    valuation_method: 'FIFO',
    track_batch: 0,
    track_serial: 0,
    track_expiry: 0,
    is_active: 1,
    updated_at: null,
    created_at: null,
    unit_symbol: null,
    unit_name: null,
    grp_name: null,
    cat_name: null,
    brand_name: null,
    ...partial,
  }
}

const brand = findBulkField('brand_id')
const hsn = findBulkField('hsn_sac')

function plan(rows: ItemListRow[], selected: number[], value: string, field = brand) {
  return planBulkEdit({
    rows,
    field,
    newValue: value,
    selectedIds: new Set(selected),
    check: checkNewValue(field, value),
  })
}

describe('classifying the rows', () => {
  const rows = [item({ item_id: 1 }), item({ item_id: 2, brand_id: 8 }), item({ item_id: 3 })]

  it('separates what would change from what already holds the value', () => {
    const p = plan(rows, [1, 2], '8')
    expect(p.counts.willUpdate).toBe(1)
    expect(p.counts.unchanged).toBe(1)
    expect(p.rows.find((r) => r.row.item_id === 1)?.status).toBe('will_update')
    expect(p.rows.find((r) => r.row.item_id === 2)?.status).toBe('unchanged')
  })

  it('leaves an unticked row alone whatever it holds', () => {
    expect(plan(rows, [1], '8').rows.find((r) => r.row.item_id === 3)?.status).toBe('not_selected')
  })

  it('calls every ticked row invalid while the value cannot be written', () => {
    const p = plan(rows, [1, 2], '0')
    expect(p.counts.invalid).toBe(2)
    expect(p.counts.willUpdate).toBe(0)
  })

  it('calls every ticked row read-only when Books owns the field', () => {
    const p = plan(rows, [1, 2], '12345678', hsn)
    expect(p.counts.locked).toBe(2)
    expect(p.counts.willUpdate).toBe(0)
  })

  it('treats clearing a field as a change for the items that have one', () => {
    const p = plan(rows, [1, 2], '')
    expect(p.rows.find((r) => r.row.item_id === 2)?.status).toBe('will_update')
    expect(p.rows.find((r) => r.row.item_id === 1)?.status).toBe('unchanged')
  })
})

describe('the payload', () => {
  it('carries only the rows that would genuinely change', () => {
    const rows = [item({ item_id: 1 }), item({ item_id: 2, brand_id: 8 })]
    expect(buildPayload(plan(rows, [1, 2], '8'), brand, '8')).toEqual([{ item_id: 1, brand_id: 8 }])
  })

  it('sends null when the field is being cleared', () => {
    const rows = [item({ item_id: 2, brand_id: 8 })]
    expect(buildPayload(plan(rows, [2], ''), brand, '')).toEqual([{ item_id: 2, brand_id: null }])
  })

  it('is empty when nothing would change, so Apply cannot post a no-op batch', () => {
    const rows = [item({ item_id: 2, brand_id: 8 })]
    expect(buildPayload(plan(rows, [2], '8'), brand, '8')).toEqual([])
  })
})

describe('whether Apply may run', () => {
  const rows = [item({ item_id: 1 }), item({ item_id: 2, brand_id: 8 })]

  it('refuses without the write permission and says so', () => {
    const gate = applyGate(plan(rows, [1], '8'), brand, checkNewValue(brand, '8'), false)
    expect(gate.canApply).toBe(false)
    expect(gate.reason).toMatch(/write permission/)
  })

  it('refuses with nothing ticked', () => {
    expect(applyGate(plan(rows, [], '8'), brand, checkNewValue(brand, '8'), true).reason).toMatch(/at least one item/)
  })

  it('refuses when every ticked item already holds the value', () => {
    const gate = applyGate(plan(rows, [2], '8'), brand, checkNewValue(brand, '8'), true)
    expect(gate.canApply).toBe(false)
    expect(gate.reason).toMatch(/already has this/)
  })

  it('refuses a Books-owned field outright', () => {
    const gate = applyGate(plan(rows, [1], '12345678', hsn), hsn, checkNewValue(hsn, '12345678'), true)
    expect(gate.canApply).toBe(false)
    expect(gate.reason).toMatch(/Smart Books/)
  })

  it('refuses a batch larger than the API accepts, before it is sent', () => {
    const many = Array.from({ length: MAX_PER_APPLY + 1 }, (_, i) => item({ item_id: i + 1 }))
    const gate = applyGate(
      plan(many, many.map((r) => r.item_id), '8'),
      brand,
      checkNewValue(brand, '8'),
      true,
    )
    expect(gate.canApply).toBe(false)
    expect(gate.reason).toMatch(/at most 500/)
  })

  it('allows the ordinary case', () => {
    expect(applyGate(plan(rows, [1], '8'), brand, checkNewValue(brand, '8'), true)).toEqual({
      canApply: true,
      reason: null,
    })
  })
})

describe('reading the response', () => {
  const result = (rows: number[], updated = rows.length): BulkUpdateResult => ({
    updated,
    rows: rows.map((item_id) => ({ item_id, changed: ['brand_id'] })),
  })

  it('reports a complete write as complete', () => {
    expect(summarizeOutcome([1, 2], 3, result([1, 2]))).toEqual({
      updated: 2,
      skippedUnchanged: 3,
      missing: [],
      complete: true,
    })
  })

  it('reports a short answer as partial rather than a success', () => {
    const outcome = summarizeOutcome([1, 2, 3], 0, result([1, 3], 2))
    expect(outcome.complete).toBe(false)
    expect(outcome.missing).toEqual([2])
    expect(outcome.updated).toBe(2)
  })

  it('takes the count from the server, not from what was sent', () => {
    expect(summarizeOutcome([1, 2], 0, result([1, 2], 2)).updated).toBe(2)
  })
})

describe('selection', () => {
  const rows = [item({ item_id: 1 }), item({ item_id: 2 }), item({ item_id: 3 })]

  it('reports the header checkbox as none, some or all of what is on screen', () => {
    expect(headerSelectState(rows, new Set())).toBe('none')
    expect(headerSelectState(rows, new Set([1]))).toBe('some')
    expect(headerSelectState(rows, new Set([1, 2, 3]))).toBe('all')
    expect(headerSelectState([], new Set([1]))).toBe('none')
  })

  const selectionOf = (rows: ItemListRow[]) => new Map(rows.map((r) => [r.item_id, r]))

  it('adds every visible row, and clears them when they are all already ticked', () => {
    expect([...toggleVisibleSelection(rows, new Map()).keys()]).toEqual([1, 2, 3])
    expect([...toggleVisibleSelection(rows, selectionOf(rows)).keys()]).toEqual([])
  })

  it('keeps a selection made on another page when ticking this one', () => {
    const elsewhere = selectionOf([item({ item_id: 99, item_name: 'Page two item' })])
    const next = toggleVisibleSelection(rows, elsewhere)
    expect([...next.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 99])
    // …and the row it was ticked from, which is the only place its value lives.
    expect(next.get(99)?.item_name).toBe('Page two item')
  })

  it('finds the rows with no value, and proposes nothing for them', () => {
    const mixed = [item({ item_id: 1, brand_id: 8 }), item({ item_id: 2 }), item({ item_id: 3 })]
    const { next, added } = selectMissing(mixed, brand, new Map())
    expect(added).toBe(2)
    expect([...next.keys()]).toEqual([2, 3])
  })

  it('does not re-tick something already ticked', () => {
    const only = item({ item_id: 2 })
    const { added } = selectMissing([only], brand, selectionOf([only]))
    expect(added).toBe(0)
  })
})

describe('the chip row', () => {
  const base = {
    search: '',
    groupId: '',
    groupLabel: null,
    status: '',
    field: brand,
    newValue: '',
    newValueLabel: '',
    selectedCount: 0,
  }

  it('always states the field, and never offers to clear it', () => {
    const chips = buildChips(base)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ key: 'field', value: 'Brand', clearable: false })
  })

  it('names each active filter with something a reader recognises', () => {
    const chips = buildChips({
      ...base,
      search: ' wire ',
      groupId: '5',
      groupLabel: 'Raw Materials',
      status: 'inactive',
      newValue: '8',
      newValueLabel: 'Finolex',
      selectedCount: 2,
    })
    expect(chips.map((c) => `${c.label}: ${c.value}`)).toEqual([
      'Search: wire',
      'Group: Raw Materials',
      'Status: Inactive',
      'Field: Brand',
      'New value: Finolex',
      'Items: 2 selected',
    ])
  })
})

describe('the editor value in comparable form', () => {
  it('matches what an item reads back as, so equality means equality', () => {
    expect(normalizedKey(brand, '8')).toBe('8')
    expect(normalizedKey(brand, '')).toBe('')
    expect(normalizedKey(findBulkField('mrp'), '249.50')).toBe('249.5')
  })
})
