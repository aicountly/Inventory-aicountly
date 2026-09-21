import { describe, expect, it } from 'vitest'
import { emptyItemForm } from './itemForm'
import type { ItemFormState } from './itemForm'
import type { ItemSearchRow } from '../../services/items'
import { classifyDuplicates, hasBlockingDuplicate } from './itemDuplicates'

const row = (over: Partial<ItemSearchRow> = {}): ItemSearchRow => ({
  item_id: 1,
  item_name: 'Bolt M8',
  item_alias: null,
  print_name: null,
  item_sku: null,
  item_upc: null,
  hsn_sac: null,
  unit_id: 1,
  unit_symbol: 'Pcs',
  track_batch: 0,
  track_serial: 0,
  valuation_method: 'FIFO',
  default_warehouse_id: null,
  ...over,
})

const draft = (over: Partial<ItemFormState> = {}): ItemFormState => ({ ...emptyItemForm(), ...over })

describe('classifyDuplicates', () => {
  it('says nothing about an empty draft', () => {
    expect(classifyDuplicates(draft(), [row()])).toEqual([])
  })

  /** The two the server itself refuses with a 409 — this only says so a round trip earlier. */
  it('treats an exact name and an exact SKU as conflicts', () => {
    const rows = [row({ item_id: 2, item_name: 'Bolt M8' }), row({ item_id: 3, item_name: 'Nut M8', item_sku: 'NUT-8' })]
    const matches = classifyDuplicates(draft({ item_name: 'bolt m8', item_sku: 'nut-8' }), rows)
    expect(matches.map((m) => m.reason)).toEqual(['name', 'sku'])
    expect(hasBlockingDuplicate(matches)).toBe(true)
  })

  /**
   * `item_upc` carries no uniqueness rule in ItemsController, so refusing a save on it here would
   * refuse what the API would have accepted. It is reported and nothing more.
   */
  it('reports a shared barcode as a warning, never a conflict', () => {
    const rows = [row({ item_id: 4, item_name: 'Something else', item_upc: '890123' })]
    const matches = classifyDuplicates(draft({ item_name: 'Fresh item', item_upc: '890123' }), rows)
    expect(matches[0].reason).toBe('barcode')
    expect(hasBlockingDuplicate(matches)).toBe(false)
  })

  it('never blocks on a merely similar name', () => {
    const rows = [row({ item_id: 6, item_name: 'Bolt M8 galvanised' })]
    const matches = classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows)
    expect(matches[0].reason).toBe('similar')
    expect(hasBlockingDuplicate(matches)).toBe(false)
  })

  it('matches an alias as well as a name', () => {
    const rows = [row({ item_id: 7, item_name: 'Hexagon bolt', item_alias: 'Bolt M8' })]
    expect(classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows)[0].reason).toBe('similar')
  })

  it('ignores the item being edited, so a record is never its own duplicate', () => {
    const rows = [row({ item_id: 8, item_name: 'Bolt M8' })]
    expect(classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows, 8)).toEqual([])
  })

  it('reports each item once and puts conflicts first', () => {
    const rows = [
      row({ item_id: 10, item_name: 'Bolt M8 long' }),
      row({ item_id: 11, item_name: 'Bolt M8' }),
      row({ item_id: 10, item_name: 'Bolt M8 long' }),
    ]
    const matches = classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows)
    expect(matches.map((m) => m.item.item_id)).toEqual([11, 10])
    expect(matches[0].severity).toBe('conflict')
  })

  it('shows at most four, so a warning never becomes a list', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row({ item_id: 100 + i, item_name: `Bolt M8 variant ${i}` }))
    expect(classifyDuplicates(draft({ item_name: 'Bolt M8' }), rows)).toHaveLength(4)
  })
})
