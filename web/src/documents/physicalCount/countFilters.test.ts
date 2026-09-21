import { describe, expect, it } from 'vitest'
import { activeFilterCount, DEFAULT_FILTERS, filterRows, hasAnyFilter } from './countFilters'
import type { CountFilters } from './countFilters'
import { buildRows, EMPTY_SNAPSHOT } from './countModel'
import type { SnapshotMap } from './countModel'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'

const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!
const WAREHOUSES: Record<number, string> = { 1: 'Main Warehouse', 2: 'Secondary WH' }
const warehouseName = (id: number | null | undefined) => (id ? (WAREHOUSES[id] ?? '') : '')

function line(partial: Partial<LineDraft>): LineDraft {
  return newLine(COUNT, { warehouse_id: 1, book_qty: '10', physical_qty: '', origin: 'count', ...partial })
}

const LINES = [
  line({ key: 'short', item_id: 1, item_sku: 'ITM-001', item_name: 'HP Laptop 15s', physical_qty: '8', batch_no: 'B2403' }),
  line({ key: 'excess', item_id: 2, item_sku: 'ITM-002', item_name: 'Logitech Mouse', physical_qty: '13', warehouse_id: 2 }),
  line({ key: 'match', item_id: 3, item_sku: 'ITM-003', item_name: 'Dell Monitor', physical_qty: '10' }),
  line({ key: 'pending', item_id: 4, item_sku: 'ITM-004', item_name: 'Office Chair', physical_qty: '' }),
  line({
    key: 'serial',
    item_id: 5,
    item_sku: 'ITM-005',
    item_name: 'Router X1',
    physical_qty: '9',
    track_serial: true,
  }),
]

const SNAPSHOTS: SnapshotMap = {
  short: { ...EMPTY_SNAPSHOT, unitCost: 45000, warehouseName: 'Main Warehouse' },
  excess: { ...EMPTY_SNAPSHOT, unitCost: 1200, warehouseName: 'Secondary WH' },
  match: { ...EMPTY_SNAPSHOT, unitCost: 12000, warehouseName: 'Main Warehouse' },
  pending: { ...EMPTY_SNAPSHOT, unitCost: 5500, warehouseName: 'Main Warehouse' },
  serial: { ...EMPTY_SNAPSHOT, unitCost: 900, warehouseName: 'Main Warehouse' },
}

const ROWS = buildRows(LINES, SNAPSHOTS, { today: '2026-09-18', showCost: true })

function keys(filters: Partial<CountFilters>): string[] {
  return filterRows(ROWS, { ...DEFAULT_FILTERS, ...filters }, warehouseName).map((r) => r.line.key)
}

describe('presets', () => {
  it('shows everything by default', () => {
    expect(keys({})).toHaveLength(5)
  })

  it('narrows to variance, shortage, excess and exact match', () => {
    expect(keys({ preset: 'variance' }).sort()).toEqual(['excess', 'serial', 'short'])
    expect(keys({ preset: 'shortage' }).sort()).toEqual(['serial', 'short'])
    expect(keys({ preset: 'excess' })).toEqual(['excess'])
    expect(keys({ preset: 'match' })).toEqual(['match'])
  })

  it('separates counted from not counted', () => {
    expect(keys({ preset: 'pending' })).toEqual(['pending'])
    expect(keys({ preset: 'counted' })).toHaveLength(4)
  })

  it('finds rows that need attention and rows with serial checks', () => {
    expect(keys({ preset: 'exceptions' })).toEqual(['serial'])
    expect(keys({ preset: 'serial' })).toEqual(['serial'])
  })
})

describe('field filters', () => {
  it('filters by warehouse', () => {
    expect(keys({ warehouseId: 2 })).toEqual(['excess'])
  })

  it('filters to serial-tracked lines', () => {
    expect(keys({ serialTracked: true })).toEqual(['serial'])
  })

  it('filters by the size of the value swing', () => {
    expect(keys({ minVarianceValue: 50000 })).toEqual(['short'])
  })

  it('drops rows with no known variance value when a value floor is set', () => {
    const noCost = buildRows(LINES, {}, { today: '2026-09-18', showCost: false })
    const out = filterRows(noCost, { ...DEFAULT_FILTERS, minVarianceValue: 1 }, warehouseName)
    expect(out).toHaveLength(0)
  })

  it('combines filters rather than replacing one with another', () => {
    expect(keys({ preset: 'variance', warehouseId: 1 }).sort()).toEqual(['serial', 'short'])
  })
})

describe('search', () => {
  it('matches item code, name, warehouse and batch', () => {
    expect(keys({ search: 'ITM-002' })).toEqual(['excess'])
    expect(keys({ search: 'laptop' })).toEqual(['short'])
    expect(keys({ search: 'secondary' })).toEqual(['excess'])
    expect(keys({ search: 'B2403' })).toEqual(['short'])
  })

  it('matches a serial number already named on a line', () => {
    const withSerial = buildRows(
      [line({ key: 'x', item_id: 9, item_name: 'Thing', physical_qty: '9', serials: [{ serial_id: 1, serial_no: 'SN-7788' }] })],
      {},
      { today: '2026-09-18', showCost: true },
    )
    const out = filterRows(withSerial, { ...DEFAULT_FILTERS, search: 'sn-7788' }, warehouseName)
    expect(out).toHaveLength(1)
  })

  it('is case insensitive and ignores surrounding space', () => {
    expect(keys({ search: '  Dell  ' })).toEqual(['match'])
  })
})

describe('explicit row sets', () => {
  it('shows exactly the rows an insight pointed at', () => {
    expect(keys({ lineKeys: ['short', 'match'] }).sort()).toEqual(['match', 'short'])
  })

  it('still applies the other filters inside that set', () => {
    expect(keys({ lineKeys: ['short', 'match'], preset: 'shortage' })).toEqual(['short'])
  })
})

describe('filter counting', () => {
  it('counts only the narrowing choices, not the search text', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: 'abc' })).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, preset: 'shortage', warehouseId: 1 })).toBe(2)
  })

  it('reports that something is narrowing the sheet, search included', () => {
    expect(hasAnyFilter(DEFAULT_FILTERS)).toBe(false)
    expect(hasAnyFilter({ ...DEFAULT_FILTERS, search: 'abc' })).toBe(true)
  })
})
