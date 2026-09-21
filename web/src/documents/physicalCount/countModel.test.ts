import { describe, expect, it } from 'vitest'
import {
  assessReadiness,
  buildRows,
  differenceOf,
  EMPTY_SNAPSHOT,
  isCounted,
  summarise,
  varianceValueOf,
  variancePctOf,
} from './countModel'
import type { LineSnapshot, SnapshotMap } from './countModel'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'

const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!
const TODAY = '2026-09-18'

let seq = 0
function line(partial: Partial<LineDraft> = {}): LineDraft {
  seq += 1
  return newLine(COUNT, {
    key: `k${seq}`,
    item_id: seq,
    item_name: `Item ${seq}`,
    warehouse_id: 1,
    book_qty: '10',
    physical_qty: '10',
    origin: 'count',
    ...partial,
  })
}

function snap(partial: Partial<LineSnapshot> = {}): LineSnapshot {
  return { ...EMPTY_SNAPSHOT, ...partial }
}

function snapshots(entries: Record<string, LineSnapshot>): SnapshotMap {
  return entries
}

const OPTS = { today: TODAY, showCost: true }

describe('line derivations', () => {
  it('treats a blank counted quantity as uncounted, not as zero', () => {
    const l = line({ physical_qty: '' })
    expect(isCounted(l)).toBe(false)
    expect(differenceOf(l)).toBeNull()

    const zero = line({ physical_qty: '0' })
    expect(isCounted(zero)).toBe(true)
    expect(differenceOf(zero)).toBe(-10)
  })

  it('derives variance value and percentage only when both inputs are known', () => {
    expect(varianceValueOf(-2, 45000)).toBe(-90000)
    expect(varianceValueOf(-2, null)).toBeNull()
    expect(varianceValueOf(null, 45000)).toBeNull()

    expect(variancePctOf(line({ book_qty: '10' }), -2)).toBeCloseTo(0.2)
    expect(variancePctOf(line({ book_qty: '0' }), 3)).toBeNull()
  })

  it('classifies shortage, excess, match and pending', () => {
    const rows = buildRows(
      [
        line({ key: 'a', physical_qty: '8' }),
        line({ key: 'b', physical_qty: '13' }),
        line({ key: 'c', physical_qty: '10' }),
        line({ key: 'd', physical_qty: '' }),
      ],
      {},
      OPTS,
    )
    expect(rows.map((r) => r.status)).toEqual(['shortage', 'excess', 'ok', 'pending'])
  })

  it('flags a non-numeric counted quantity as a critical exception', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: 'eight' })], {}, OPTS)
    expect(rows[0].status).toBe('exception')
    expect(rows[0].exceptions[0].kind).toBe('invalid_qty')
  })

  it('requires serial numbers to be named for a serial-tracked shortage only', () => {
    const short = buildRows([line({ key: 'a', track_serial: true, physical_qty: '8' })], {}, OPTS)
    expect(short[0].exceptions.map((e) => e.kind)).toContain('serial_missing')

    const excess = buildRows([line({ key: 'b', track_serial: true, physical_qty: '12' })], {}, OPTS)
    expect(excess[0].exceptions).toHaveLength(0)

    const named = buildRows(
      [
        line({
          key: 'c',
          track_serial: true,
          physical_qty: '8',
          serials: [
            { serial_id: 1, serial_no: 'S1' },
            { serial_id: 2, serial_no: 'S2' },
          ],
        }),
      ],
      {},
      OPTS,
    )
    expect(named[0].exceptions).toHaveLength(0)
  })

  it('warns about an expired batch and blocks a batch-tracked line with no batch', () => {
    const expired = buildRows(
      [line({ key: 'a', batch_no: 'B1', track_batch: true, batch_id: 7, physical_qty: '9' })],
      snapshots({ a: snap({ batchExpiry: '2026-01-01' }) }),
      OPTS,
    )
    expect(expired[0].exceptions.map((e) => e.kind)).toEqual(['batch_expired'])
    expect(expired[0].status).toBe('shortage')

    const missing = buildRows([line({ key: 'b', track_batch: true, batch_id: null, physical_qty: '9' })], {}, OPTS)
    expect(missing[0].exceptions.map((e) => e.kind)).toEqual(['batch_missing'])
    expect(missing[0].status).toBe('exception')
  })

  it('withholds cost-derived figures when the reader may not see cost', () => {
    const maps = snapshots({ a: snap({ unitCost: 100 }) })
    const withCost = buildRows([line({ key: 'a', physical_qty: '8' })], maps, OPTS)
    const withoutCost = buildRows([line({ key: 'a', physical_qty: '8' })], maps, { today: TODAY, showCost: false })
    expect(withCost[0].varianceValue).toBe(-200)
    expect(withoutCost[0].varianceValue).toBeNull()
  })
})

describe('summary', () => {
  it('counts warehouses, progress, shortages, excesses and value', () => {
    const rows = buildRows(
      [
        line({ key: 'a', warehouse_id: 1, book_qty: '10', physical_qty: '8' }),
        line({ key: 'b', warehouse_id: 1, book_qty: '25', physical_qty: '25' }),
        line({ key: 'c', warehouse_id: 2, book_qty: '15', physical_qty: '18' }),
        line({ key: 'd', warehouse_id: 3, book_qty: '5', physical_qty: '' }),
      ],
      snapshots({
        a: snap({ unitCost: 45000 }),
        b: snap({ unitCost: 1200 }),
        c: snap({ unitCost: 12000 }),
        d: snap({ unitCost: 320 }),
      }),
      OPTS,
    )
    const s = summarise(rows)
    expect(s.warehousesSelected).toBe(3)
    expect(s.itemsLoaded).toBe(4)
    expect(s.countedLines).toBe(3)
    expect(s.pendingLines).toBe(1)
    expect(s.progressPct).toBe(75)
    expect(s.shortageItems).toBe(1)
    expect(s.excessItems).toBe(1)
    expect(s.matchedItems).toBe(1)
    expect(s.varianceValue).toBe(-90000 + 36000)
    expect(s.qtyShort).toBe(2)
    expect(s.qtyExcess).toBe(3)
    expect(s.netQtyVariance).toBe(1)
  })

  it('reports no variance value at all rather than zero when no cost is known', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '8' })], {}, { today: TODAY, showCost: false })
    expect(summarise(rows).varianceValue).toBeNull()
  })

  it('reports zero progress on an empty sheet instead of dividing by zero', () => {
    expect(summarise([]).progressPct).toBe(0)
    expect(summarise([]).pendingLines).toBe(0)
  })
})

describe('posting readiness', () => {
  const header = { document_date: TODAY }

  it('is empty before anything is loaded', () => {
    const r = assessReadiness([], header)
    expect(r.level).toBe('empty')
    expect(r.canPost).toBe(false)
  })

  it('allows a partial count but warns about the lines left uncounted', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '8' }), line({ key: 'b', physical_qty: '' })], {}, OPTS)
    const r = assessReadiness(rows, header)
    expect(r.canPost).toBe(true)
    const warning = r.issues.find((i) => i.lineKeys?.includes('b'))
    expect(warning?.blocking).toBe(false)
    expect(warning?.message).toMatch(/uncounted/)
  })

  it('still blocks when nothing differs, even with lines left uncounted', () => {
    // The server drops equal lines and then refuses a document with none left,
    // so "counted three, all matched, 122 to go" is not saveable.
    const rows = buildRows([line({ key: 'a', physical_qty: '10' }), line({ key: 'b', physical_qty: '' })], {}, OPTS)
    expect(assessReadiness(rows, header).canPost).toBe(false)
  })

  it('asks for a counted quantity when nothing has been counted at all', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '' })], {}, OPTS)
    const r = assessReadiness(rows, header)
    expect(r.canPost).toBe(false)
    expect(r.issues.some((i) => i.blocking && /at least one counted quantity/i.test(i.message))).toBe(true)
  })

  it('blocks on a critical exception even when everything is counted', () => {
    const rows = buildRows([line({ key: 'a', track_serial: true, physical_qty: '8' })], {}, OPTS)
    const r = assessReadiness(rows, header)
    expect(r.canPost).toBe(false)
    expect(r.summary).toMatch(/require attention/)
  })

  it('blocks a sheet where nothing differs from book, as the server would', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '10' })], {}, OPTS)
    expect(assessReadiness(rows, header).canPost).toBe(false)
  })

  it('blocks a missing document date', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '8' })], {}, OPTS)
    expect(assessReadiness(rows, { document_date: '' }).canPost).toBe(false)
  })

  it('is ready when counted, differing and clean', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '8' }), line({ key: 'b', physical_qty: '10' })], {}, OPTS)
    const r = assessReadiness(rows, header)
    expect(r.canPost).toBe(true)
    expect(r.level).toBe('ready')
    expect(r.summary).toBe('Ready for audit')
  })

  it('lets a warning through but still reports it', () => {
    const rows = buildRows(
      [line({ key: 'a', track_batch: true, batch_id: 3, batch_no: 'B1', physical_qty: '8' })],
      snapshots({ a: snap({ batchExpiry: '2020-01-01' }) }),
      OPTS,
    )
    const r = assessReadiness(rows, header)
    expect(r.canPost).toBe(true)
    expect(r.issues.some((i) => !i.blocking)).toBe(true)
  })

  it('blocks on a cross-row exception supplied by the rule engine', () => {
    const rows = buildRows([line({ key: 'a', physical_qty: '8' })], {}, OPTS)
    const r = assessReadiness(rows, header, [
      { id: 'x', lineKey: 'a', kind: 'serial_duplicate', severity: 'critical', title: 'dup', detail: '' },
    ])
    expect(r.canPost).toBe(false)
  })
})
