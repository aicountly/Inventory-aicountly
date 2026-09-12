import { describe, expect, it } from 'vitest'
import { bomPayload, emptyHeader, headerFromBom, isBomValid, linesFromBom, newLine, validateBom } from './bomForm'
import type { BomHeaderDraft } from './bomForm'
import type { Bom } from '../../services/masters'

const finished = { item_id: 10, item_name: 'Chair', item_sku: 'CH-1', unit_id: 1 }

function header(over: Partial<BomHeaderDraft> = {}): BomHeaderDraft {
  return { ...emptyHeader(), bom_name: 'Chair BOM', finished, yield_qty: '1', ...over }
}

describe('validateBom', () => {
  it('requires a name, a finished item, a positive yield and a component line', () => {
    const v = validateBom({ ...emptyHeader(), yield_qty: '0' }, [])
    expect(v.header).toEqual({ bom_name: 'Name is required', finished: 'Pick the finished item', yield_qty: 'Yield must be greater than zero' })
    expect(v.general).toBe('Add at least one component line.')
    expect(isBomValid(v)).toBe(false)
  })

  it('rejects the finished item as its own component, negative qty and bad scrap', () => {
    const self = { ...newLine(), item: finished, qty: '1' }
    const neg = { ...newLine(), item: { item_id: 2, item_name: 'Leg' }, qty: '-1' }
    const scrap = { ...newLine(), item: { item_id: 3, item_name: 'Seat' }, qty: '1', scrap_percent: '120' }
    const v = validateBom(header(), [self, neg, scrap])
    expect(v.lines[self.key]).toMatch(/own component/)
    expect(v.lines[neg.key]).toMatch(/negative/)
    expect(v.lines[scrap.key]).toMatch(/between 0 and 100/)
  })

  it('needs at least one component with quantity', () => {
    const by = { ...newLine('by_product'), item: { item_id: 4, item_name: 'Sawdust' }, qty: '2' }
    expect(validateBom(header(), [by]).general).toMatch(/quantity greater than zero/)
    const ok = { ...newLine(), item: { item_id: 2, item_name: 'Leg' }, qty: '4' }
    expect(isBomValid(validateBom(header(), [ok, by]))).toBe(true)
  })
})

describe('bomPayload', () => {
  it('serialises the header and ordered lines', () => {
    const leg = { ...newLine(), item: { item_id: 2, item_name: 'Leg' }, qty: '4', unit_id: '7', scrap_percent: '2.5' }
    const dust = { ...newLine('scrap'), item: { item_id: 4, item_name: 'Sawdust' }, qty: '0.1', unit_id: '', scrap_percent: '' }
    expect(bomPayload(header({ yield_unit_id: '3' }), [leg, dust])).toEqual({
      bom_name: 'Chair BOM',
      finished_item_id: 10,
      yield_qty: 1,
      yield_unit_id: 3,
      is_active: 1,
      lines: [
        { item_id: 2, qty: 4, unit_id: 7, line_kind: 'component', scrap_percent: 2.5, sort_order: 0 },
        { item_id: 4, qty: 0.1, unit_id: null, line_kind: 'scrap', scrap_percent: 0, sort_order: 1 },
      ],
    })
  })
})

describe('drafts from an API row', () => {
  const bom: Bom = {
    bom_id: 5,
    bom_name: 'Chair BOM',
    finished_item_id: 10,
    yield_qty: 2,
    yield_unit_id: null,
    is_active: 1,
    finished_item_name: 'Chair',
    finished_item_sku: 'CH-1',
    finished_item_unit_id: 1,
    yield_unit_symbol: null,
    line_count: 1,
    lines: [{ bom_line_id: 1, item_id: 2, qty: 4, unit_id: 7, line_kind: 'component', scrap_percent: 0, sort_order: 0, item_name: 'Leg', item_sku: null, unit_symbol: 'Pcs' }],
  }

  it('maps header and lines', () => {
    expect(headerFromBom(bom)).toEqual({ bom_name: 'Chair BOM', finished: { item_id: 10, item_name: 'Chair', item_sku: 'CH-1', unit_id: 1 }, yield_qty: '2', yield_unit_id: '', is_active: true })
    const lines = linesFromBom(bom.lines ?? [])
    expect(lines[0]).toMatchObject({ line_kind: 'component', qty: '4', unit_id: '7', scrap_percent: '0', item: { item_id: 2, item_name: 'Leg' } })
  })
})
