import { describe, expect, it } from 'vitest'
import { duplicateLines, duplicateSerials, runInsightRules } from './countInsights'
import { buildRows, summarise } from './countModel'
import type { LineSnapshot, SnapshotMap } from './countModel'
import { EMPTY_SNAPSHOT } from './countModel'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'

const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!
const OPTS = { today: '2026-09-18', showCost: true }

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

function rulesFor(lines: LineDraft[], snapshots: SnapshotMap = {}) {
  const rows = buildRows(lines, snapshots, OPTS)
  return runInsightRules(rows, summarise(rows))
}

function ids(result: ReturnType<typeof rulesFor>): string[] {
  return result.summary.map((i) => i.id)
}

describe('rule engine', () => {
  it('never claims to be a service', () => {
    const result = rulesFor([line({ physical_qty: '8' })])
    expect(result.source).toBe('rules')
    expect(result.confidence).toBeNull()
  })

  it('flags shrinkage beyond 20% of book quantity', () => {
    const result = rulesFor([
      line({ key: 'a', book_qty: '100', physical_qty: '70' }),
      line({ key: 'b', book_qty: '100', physical_qty: '95' }),
    ])
    const insight = result.summary.find((i) => i.id === 'high-shrinkage')
    expect(insight?.lineKeys).toEqual(['a'])
  })

  it('flags a counted figure that looks like a misplaced decimal point', () => {
    const result = rulesFor([line({ key: 'a', book_qty: '12', physical_qty: '120' })])
    expect(ids(result)).toContain('decimal-slip')
  })

  it('does not call an ordinary difference a decimal slip', () => {
    const result = rulesFor([line({ key: 'a', book_qty: '12', physical_qty: '14' })])
    expect(ids(result)).not.toContain('decimal-slip')
  })

  it('finds the same serial number counted on two lines', () => {
    const serials = [{ serial_id: 42, serial_no: 'SN-42' }]
    const rows = buildRows(
      [
        line({ key: 'a', book_qty: '10', physical_qty: '9', track_serial: true, serials }),
        line({ key: 'b', book_qty: '10', physical_qty: '9', track_serial: true, serials }),
      ],
      {},
      OPTS,
    )
    const dupes = duplicateSerials(rows)
    expect(dupes).toHaveLength(1)
    expect(dupes[0].severity).toBe('critical')
    expect(dupes[0].title).toContain('SN-42')
  })

  it('finds the same item, warehouse and batch loaded twice', () => {
    const rows = buildRows(
      [
        line({ key: 'a', item_id: 5, warehouse_id: 2, batch_id: 9 }),
        line({ key: 'b', item_id: 5, warehouse_id: 2, batch_id: 9 }),
        line({ key: 'c', item_id: 5, warehouse_id: 3, batch_id: 9 }),
      ],
      {},
      OPTS,
    )
    const dupes = duplicateLines(rows)
    expect(dupes).toHaveLength(1)
    expect(dupes[0].severity).toBe('warning')
  })

  it('names the rows that carry most of the variance value', () => {
    const result = rulesFor(
      [
        line({ key: 'a', book_qty: '10', physical_qty: '9' }),
        line({ key: 'b', book_qty: '10', physical_qty: '9' }),
      ],
      { a: snap({ unitCost: 100000 }), b: snap({ unitCost: 10 }) },
    )
    const insight = result.summary.find((i) => i.id === 'high-value-variance')
    expect(insight?.lineKeys).toEqual(['a'])
  })

  it('ranks recount suggestions by the size of the swing', () => {
    const result = rulesFor(
      [
        line({ key: 'small', book_qty: '100', physical_qty: '60' }),
        line({ key: 'big', book_qty: '100', physical_qty: '50' }),
      ],
      { small: snap({ unitCost: 1 }), big: snap({ unitCost: 1000 }) },
    )
    const recount = result.summary.find((i) => i.id === 'recount-suggestion')
    expect(recount?.lineKeys[0]).toBe('big')
    expect(result.recountRecommendations[0]).toContain('Item')
  })

  it('says so plainly when a counted sheet trips nothing', () => {
    const result = rulesFor([line({ key: 'a', book_qty: '10', physical_qty: '11' })])
    expect(ids(result)).toEqual(['all-clear'])
  })

  it('stays quiet on a sheet nobody has counted yet', () => {
    const result = rulesFor([line({ key: 'a', physical_qty: '' })])
    expect(result.summary).toEqual([])
  })
})
