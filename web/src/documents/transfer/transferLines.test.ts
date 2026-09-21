import { describe, expect, it } from 'vitest'
import type { ItemSearchRow } from '../../services/lookupApi'
import { newHeader, newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  appendItems,
  duplicateLineAt,
  importIntoLines,
  itemPatch,
  lineFromItem,
  scanIntoLines,
  swapHeader,
  swapLines,
  swapWouldClearAllocations,
} from './transferLines'

const SPEC = specForCode('STOCK_TRANSFER')!

function item(partial: Partial<ItemSearchRow> = {}): ItemSearchRow {
  return {
    item_id: 10,
    item_name: 'Laptop Dell Inspiron 15',
    item_alias: null,
    print_name: null,
    item_sku: 'PRD-001',
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 5,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: 'FIFO',
    default_warehouse_id: 1,
    units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
    ...partial,
  }
}

function line(patch: Partial<LineDraft> = {}): LineDraft {
  return newLine(SPEC, { item_id: 10, item_name: 'Laptop', qty: '2', ...patch })
}

describe('choosing an item for a line', () => {
  it('takes the item, its units and its tracking flags', () => {
    const patch = itemPatch(item({ track_batch: 1, track_serial: 1, print_name: 'Dell 15' }))
    expect(patch.item_id).toBe(10)
    expect(patch.item_name).toBe('Dell 15')
    expect(patch.track_batch).toBe(true)
    expect(patch.track_serial).toBe(true)
    expect(patch.unit_id).toBe(5)
  })

  it('drops the batch and serials that belonged to the item before it', () => {
    const patch = itemPatch(item())
    expect(patch.batch_id).toBeNull()
    expect(patch.batch_no).toBeNull()
    expect(patch.serials).toEqual([])
  })
})

describe('duplicating a line', () => {
  it('puts the copy directly under the original and keeps the batch', () => {
    const a = line({ batch_id: 7, batch_no: 'B7' })
    const b = line({ item_id: 11 })
    const out = duplicateLineAt([a, b], a.key)
    expect(out.map((l) => l.item_id)).toEqual([10, 10, 11])
    expect(out[1].batch_id).toBe(7)
    expect(out[1].key).not.toBe(a.key)
  })

  it('never copies the serial numbers — a serial is one physical thing', () => {
    const a = line({ track_serial: true, serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const out = duplicateLineAt([a], a.key)
    expect(out[0].serials).toHaveLength(1)
    expect(out[1].serials).toEqual([])
  })

  it('leaves the list alone when the key is not on it', () => {
    const a = line()
    expect(duplicateLineAt([a], 'missing')).toEqual([a])
  })
})

describe('adding items in bulk', () => {
  it('appends one line per item and clears the empty row they were added from', () => {
    const out = appendItems(SPEC, [newLine(SPEC)], [item(), item({ item_id: 11, item_name: 'Sheet' })])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.item_id)).toEqual([10, 11])
    expect(out.every((l) => l.qty === '1')).toBe(true)
  })

  it('keeps the lines that already carry something', () => {
    const existing = line({ item_id: 99 })
    expect(appendItems(SPEC, [existing], [item()]).map((l) => l.item_id)).toEqual([99, 10])
  })
})

describe('scanning', () => {
  it('adds one to the row the item is already on', () => {
    const existing = line({ qty: '3' })
    const out = scanIntoLines(SPEC, [existing], item())
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe('4')
  })

  it('starts a row when the item is not on the transfer yet', () => {
    const out = scanIntoLines(SPEC, [newLine(SPEC)], item({ item_id: 12, item_name: 'Adapter' }))
    expect(out).toHaveLength(1)
    expect(out[0].item_id).toBe(12)
    expect(out[0].qty).toBe('1')
  })

  it('gives a serial-tracked item its own row every time, so the serials still add up', () => {
    const existing = line({ track_serial: true, qty: '1', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const out = scanIntoLines(SPEC, [existing], item({ track_serial: 1 }))
    expect(out).toHaveLength(2)
    expect(out[0].qty).toBe('1')
    expect(out[1].qty).toBe('1')
  })
})

describe('importing', () => {
  it('brings the quantity from the file and keeps a batch number as a note', () => {
    const out = importIntoLines(SPEC, [newLine(SPEC)], [
      { row: item(), qty: 10, batchNo: null },
      { row: item({ item_id: 11 }), qty: 100, batchNo: 'BCH-SEP26-01' },
    ])
    expect(out.map((l) => l.qty)).toEqual(['10', '100'])
    expect(out[0].description).toBe('')
    expect(out[1].description).toBe('Batch from import: BCH-SEP26-01')
    // A note, not an allocation: the batch that is issued is picked on the row.
    expect(out[1].batch_id).toBeNull()
  })
})

describe('swapping source and destination', () => {
  it('turns the header around', () => {
    const header = { ...newHeader(SPEC, '2026-09-18'), from_warehouse_id: 1, to_warehouse_id: 2 }
    expect(swapHeader(header)).toMatchObject({ from_warehouse_id: 2, to_warehouse_id: 1 })
  })

  it('turns each row override around and clears what belonged to the old source', () => {
    const l = line({ from_warehouse_id: 3, warehouse_id: 4, batch_id: 7, batch_no: 'B7', serials: [{ serial_id: 1, serial_no: 'SN-1' }] })
    const [out] = swapLines([l])
    expect(out.from_warehouse_id).toBe(4)
    expect(out.warehouse_id).toBe(3)
    expect(out.batch_id).toBeNull()
    expect(out.batch_no).toBeNull()
    expect(out.serials).toEqual([])
    // Everything that is still true after the swap survives it.
    expect(out.item_id).toBe(10)
    expect(out.qty).toBe('2')
  })

  it('leaves a line following the header still following it', () => {
    const [out] = swapLines([line()])
    expect(out.from_warehouse_id).toBeNull()
    expect(out.warehouse_id).toBeNull()
  })

  it('only asks first when there is an allocation to lose', () => {
    expect(swapWouldClearAllocations([line()])).toBe(false)
    expect(swapWouldClearAllocations([line({ batch_id: 7 })])).toBe(true)
    expect(swapWouldClearAllocations([line({ serials: [{ serial_id: 1, serial_no: 'SN-1' }] })])).toBe(true)
  })
})

describe('lineFromItem', () => {
  it('builds a complete line from a search row', () => {
    const l = lineFromItem(SPEC, item({ track_batch: 1 }), '25', 'note')
    expect(l).toMatchObject({ item_id: 10, item_sku: 'PRD-001', qty: '25', description: 'note', track_batch: true, unit_id: 5 })
    expect(l.key).toBeTruthy()
  })
})
