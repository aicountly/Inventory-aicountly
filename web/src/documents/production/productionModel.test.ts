import { describe, expect, it } from 'vitest'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  buildComponentRows,
  buildInsights,
  buildSuggestion,
  capacity,
  costSummary,
  findFinishedLine,
  indexAvailability,
  lineKind,
  productionIssues,
  readinessFrom,
} from './productionModel'

const SPEC = specForCode('PRODUCTION')!

function component(partial: Partial<LineDraft> & { item_id: number; qty: string }): LineDraft {
  return newLine(SPEC, {
    item_name: `Item ${partial.item_id}`,
    direction: 'out',
    warehouse_id: 1,
    units: [{ unit_id: 5, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }],
    unit_id: 5,
    origin: 'bom',
    metadata: { line_kind: 'component' },
    ...partial,
  })
}

function finished(qty: string, rate: string): LineDraft {
  return newLine(SPEC, {
    item_id: 99,
    item_name: 'Office chair',
    direction: 'in',
    warehouse_id: 1,
    units: [{ unit_id: 5, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }],
    unit_id: 5,
    qty,
    rate,
    origin: 'bom',
    metadata: { line_kind: 'finished' },
  })
}

const warehouseName = (id: number | null) => (id === null ? '' : id === 1 ? 'Main' : `Warehouse ${id}`)
const unitLabel = () => 'Nos'

describe('lineKind / findFinishedLine', () => {
  it('reads the kind the BOM explosion stamped on the line', () => {
    expect(lineKind(component({ item_id: 1, qty: '2' }))).toBe('component')
    expect(lineKind(finished('4', '0'))).toBe('finished')
    expect(lineKind(newLine(SPEC))).toBe('manual')
  })

  it('finds the finished line among the exploded lines', () => {
    const lines = [component({ item_id: 1, qty: '2' }), finished('4', '25')]
    expect(findFinishedLine(lines)?.item_id).toBe(99)
    expect(findFinishedLine([component({ item_id: 1, qty: '2' })])).toBeNull()
  })
})

describe('indexAvailability', () => {
  it('splits availability by warehouse and totals it', () => {
    const idx = indexAvailability([
      { item_id: 1, warehouse_id: 1, available: 10 },
      { item_id: 1, warehouse_id: 2, available: 5 },
      { item_id: 2, warehouse_id: 1, available: 3 },
    ])
    expect(idx.get(1)?.byWarehouse.get(1)).toBe(10)
    expect(idx.get(1)?.byWarehouse.get(2)).toBe(5)
    expect(idx.get(1)?.total).toBe(15)
    expect(idx.get(2)?.total).toBe(3)
  })

  it('counts warehouse-less stock in the total but never offers it to a line', () => {
    const idx = indexAvailability([
      { item_id: 1, warehouse_id: null, available: 7 },
      { item_id: 1, warehouse_id: 1, available: 2 },
    ])
    expect(idx.get(1)?.total).toBe(9)
    expect(idx.get(1)?.byWarehouse.get(1)).toBe(2)
    expect(idx.get(1)?.byWarehouse.size).toBe(1)
  })
})

describe('buildComponentRows', () => {
  const lines = [
    component({ item_id: 1, qty: '16' }),
    component({ item_id: 2, qty: '5' }),
    finished('4', '4740'),
  ]
  const availability = indexAvailability([
    { item_id: 1, warehouse_id: 1, available: 1250 },
    { item_id: 2, warehouse_id: 1, available: 5 },
    { item_id: 2, warehouse_id: 2, available: 40 },
  ])

  it('excludes the finished line and numbers the rest from one', () => {
    const rows = buildComponentRows({ lines, availability, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.index)).toEqual([1, 2])
  })

  it('expresses each requirement per finished unit', () => {
    const rows = buildComponentRows({ lines, availability, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    expect(rows[0].perFinishedUnit).toBe(4)
    expect(rows[1].perFinishedUnit).toBe(1.25)
  })

  it('marks a line short when the selected warehouse cannot cover it, and lists the alternatives', () => {
    const short = [component({ item_id: 2, qty: '12' })]
    const rows = buildComponentRows({ lines: short, availability, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    expect(rows[0].status).toBe('insufficient')
    expect(rows[0].shortBy).toBe(7)
    expect(rows[0].alternates).toEqual([{ warehouseId: 2, available: 40 }])
    expect(rows[0].availableElsewhere).toBe(40)
  })

  it('calls a line tight when what is left will not cover one more finished unit', () => {
    const rows = buildComponentRows({ lines, availability, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    // item 2: 5 available, 5 required, 1.25 per unit -> nothing left for another unit.
    expect(rows[1].status).toBe('tight')
    // item 1: 1250 available, 16 required, 4 per unit -> plenty of headroom.
    expect(rows[0].status).toBe('in_stock')
  })

  it('leaves availability unknown rather than assuming zero', () => {
    const rows = buildComponentRows({ lines, availability: null, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    expect(rows[0].availableHere).toBeNull()
    expect(rows[0].status).toBe('unknown')
  })

  it('converts the quantity to base units before comparing it with availability', () => {
    const boxes = [
      component({
        item_id: 3,
        qty: '2',
        units: [{ unit_id: 9, unit_symbol: 'Box', conversion_factor: 12, is_default: true }],
        unit_id: 9,
      }),
    ]
    const rows = buildComponentRows({
      lines: boxes,
      availability: indexAvailability([{ item_id: 3, warehouse_id: 1, available: 20 }]),
      unitCosts: null,
      productionQty: 1,
      fallbackWarehouseId: 1,
    })
    expect(rows[0].requiredBase).toBe(24)
    expect(rows[0].status).toBe('insufficient')
    expect(rows[0].shortBy).toBe(4)
  })

  it('costs a line at the unit cost per base unit', () => {
    const rows = buildComponentRows({
      lines,
      availability,
      unitCosts: new Map([[1, 1.5]]),
      productionQty: 4,
      fallbackWarehouseId: 1,
    })
    expect(rows[0].totalCost).toBe(24)
    expect(rows[1].totalCost).toBeNull()
  })

  it('flags batch and serial work without inventing a block', () => {
    const rows = buildComponentRows({
      lines: [
        component({ item_id: 4, qty: '2', track_batch: true }),
        component({ item_id: 5, qty: '2', track_serial: true, serials: [{ serial_id: 1, serial_no: 'A' }] }),
      ],
      availability: null,
      unitCosts: null,
      productionQty: 1,
      fallbackWarehouseId: 1,
    })
    expect(rows[0].needsBatch).toBe(true)
    expect(rows[1].needsSerial).toBe(false)
    expect(rows[1].serialMismatch).toBe(true)
  })
})

describe('costSummary', () => {
  it('adds up component cost and the value the finished goods come in at', () => {
    const lines = [component({ item_id: 1, qty: '16' }), component({ item_id: 2, qty: '5' }), finished('4', '4740')]
    const rows = buildComponentRows({
      lines,
      availability: null,
      unitCosts: new Map([
        [1, 1.5],
        [2, 850],
      ]),
      productionQty: 4,
      fallbackWarehouseId: 1,
    })
    const summary = costSummary(rows, findFinishedLine(lines), 4)
    expect(summary.componentCost).toBe(4274)
    expect(summary.costComplete).toBe(true)
    expect(summary.finishedValue).toBe(18960)
    expect(summary.valueAdd).toBe(14686)
  })

  it('withholds the value add while any component cost is unknown', () => {
    const lines = [component({ item_id: 1, qty: '16' }), component({ item_id: 2, qty: '5' }), finished('4', '4740')]
    const rows = buildComponentRows({ lines, availability: null, unitCosts: new Map([[1, 1.5]]), productionQty: 4, fallbackWarehouseId: 1 })
    const summary = costSummary(rows, findFinishedLine(lines), 4)
    expect(summary.costComplete).toBe(false)
    expect(summary.costedComponents).toBe(1)
    expect(summary.valueAdd).toBeNull()
  })

  it('reports no finished value when no rate was entered — posting decides the cost', () => {
    const lines = [component({ item_id: 1, qty: '16' }), finished('4', '')]
    const rows = buildComponentRows({ lines, availability: null, unitCosts: new Map([[1, 1]]), productionQty: 4, fallbackWarehouseId: 1 })
    const summary = costSummary(rows, findFinishedLine(lines), 4)
    expect(summary.finishedValue).toBeNull()
    expect(summary.valueAdd).toBeNull()
  })
})

describe('capacity', () => {
  it('takes the minimum over the components whose availability is known', () => {
    const lines = [component({ item_id: 1, qty: '16' }), component({ item_id: 2, qty: '5' })]
    const rows = buildComponentRows({
      lines,
      availability: indexAvailability([
        { item_id: 1, warehouse_id: 1, available: 1250 },
        { item_id: 2, warehouse_id: 1, available: 30 },
      ]),
      unitCosts: null,
      productionQty: 4,
      fallbackWarehouseId: 1,
    })
    const cap = capacity(rows)
    // item 1: 1250 / 4 = 312.5, item 2: 30 / 1.25 = 24
    expect(cap.maxProducible).toBe(24)
    expect(cap.limiting?.line.item_id).toBe(2)
  })

  it('has no answer when nothing is readable', () => {
    const rows = buildComponentRows({ lines: [component({ item_id: 1, qty: '16' })], availability: null, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    expect(capacity(rows).maxProducible).toBeNull()
  })
})

describe('productionIssues', () => {
  const base = {
    hasBom: true,
    hasFinishedItem: true,
    productionQty: 4,
    warehouseId: 1,
    exploded: true,
    negativeStockPolicy: 'block' as const,
    warehouseName,
  }

  it('asks for the header fields the server requires', () => {
    const issues = productionIssues({ ...base, rows: [], hasBom: false, hasFinishedItem: false, productionQty: 0, warehouseId: null, exploded: false })
    expect(issues.map((i) => i.id)).toEqual(['finished-item', 'bom', 'qty', 'warehouse'])
    expect(issues.every((i) => i.severity === 'blocking')).toBe(true)
  })

  it('blocks a shortage only where the company blocks negative stock', () => {
    const rows = buildComponentRows({
      lines: [component({ item_id: 2, qty: '12' })],
      availability: indexAvailability([{ item_id: 2, warehouse_id: 1, available: 5 }]),
      unitCosts: null,
      productionQty: 4,
      fallbackWarehouseId: 1,
    })
    expect(productionIssues({ ...base, rows }).find((i) => i.id.startsWith('short-'))?.severity).toBe('blocking')
    expect(productionIssues({ ...base, rows, negativeStockPolicy: 'warn' }).find((i) => i.id.startsWith('short-'))?.severity).toBe('attention')
  })

  it('never blocks on a missing batch — the posting engine issues at warehouse level', () => {
    const rows = buildComponentRows({ lines: [component({ item_id: 4, qty: '2', track_batch: true })], availability: null, unitCosts: null, productionQty: 1, fallbackWarehouseId: 1 })
    const issue = productionIssues({ ...base, rows }).find((i) => i.id.startsWith('batch-'))
    expect(issue?.severity).toBe('attention')
  })

  it('blocks a partial serial allocation, which the server rejects', () => {
    const rows = buildComponentRows({
      lines: [component({ item_id: 5, qty: '3', track_serial: true, serials: [{ serial_id: 1, serial_no: 'A' }] })],
      availability: null,
      unitCosts: null,
      productionQty: 1,
      fallbackWarehouseId: 1,
    })
    expect(productionIssues({ ...base, rows }).find((i) => i.id.startsWith('serial-'))?.severity).toBe('blocking')
  })
})

describe('readinessFrom', () => {
  const opts = { hasBom: true, productionQty: 4, exploded: true, checking: false }

  it('walks the states in order', () => {
    expect(readinessFrom([], { ...opts, hasBom: false }).readiness).toBe('idle')
    expect(readinessFrom([], { ...opts, productionQty: 0 }).readiness).toBe('awaiting_qty')
    expect(readinessFrom([], { ...opts, exploded: false }).readiness).toBe('awaiting_explosion')
    expect(readinessFrom([], { ...opts, checking: true }).readiness).toBe('checking')
    expect(readinessFrom([], opts).readiness).toBe('ready')
  })

  it('counts blockers ahead of attention items', () => {
    const state = readinessFrom(
      [
        { id: 'a', severity: 'blocking', message: '' },
        { id: 'b', severity: 'attention', message: '' },
      ],
      opts,
    )
    expect(state).toEqual({ readiness: 'blocked', blocking: 1, attention: 1 })
  })
})

describe('buildInsights / buildSuggestion', () => {
  const lines = [component({ item_id: 1, qty: '16' }), component({ item_id: 2, qty: '5' })]
  const rows = buildComponentRows({
    lines,
    availability: indexAvailability([
      { item_id: 1, warehouse_id: 1, available: 1250 },
      { item_id: 2, warehouse_id: 1, available: 30 },
    ]),
    unitCosts: null,
    productionQty: 4,
    fallbackWarehouseId: 1,
  })

  it('reports sufficiency and the limiting component', () => {
    const insights = buildInsights({ rows, capacity: capacity(rows), productionQty: 4, warehouseName, unitLabel, expiringBatches: [], availabilityKnown: true })
    expect(insights.find((i) => i.id === 'stock')?.tone).toBe('good')
    expect(insights.find((i) => i.id === 'capacity')?.text).toContain('24 finished units')
  })

  it('says availability is unreadable rather than reporting zero shortages', () => {
    const blind = buildComponentRows({ lines, availability: null, unitCosts: null, productionQty: 4, fallbackWarehouseId: 1 })
    const insights = buildInsights({ rows: blind, capacity: capacity(blind), productionQty: 4, warehouseName, unitLabel, expiringBatches: [], availabilityKnown: false })
    expect(insights[0].id).toBe('availability-unknown')
    expect(insights.find((i) => i.id === 'stock')).toBeUndefined()
  })

  it('points a shortage at the warehouses that hold the stock, and moves nothing', () => {
    const shortRows = buildComponentRows({
      lines: [component({ item_id: 2, qty: '12' })],
      availability: indexAvailability([
        { item_id: 2, warehouse_id: 1, available: 5 },
        { item_id: 2, warehouse_id: 2, available: 40 },
      ]),
      unitCosts: null,
      productionQty: 4,
      fallbackWarehouseId: 1,
    })
    const text = buildSuggestion({ rows: shortRows, capacity: capacity(shortRows), productionQty: 4, fefoEnabled: false, warehouseName, hasBom: true })
    expect(text).toContain('Warehouse 2')
    expect(text).toContain('nothing is moved for you')
  })

  it('has an empty-state suggestion before a BOM is chosen', () => {
    expect(buildSuggestion({ rows: [], capacity: { maxProducible: null, limiting: null }, productionQty: 0, fefoEnabled: false, warehouseName, hasBom: false })).toContain('Select the finished item')
  })
})
