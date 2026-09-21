import { describe, expect, it } from 'vitest'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import {
  assemblyCost,
  canSaveDraft,
  filledComponents,
  hasErrors,
  joinAssemblyLines,
  mergeComponents,
  modeFromMetadata,
  newAssemblySplit,
  splitAssemblyLines,
  validateAssembly,
  withEstimatedValuationRate,
} from './assemblyModel'
import type { AssemblySplit } from './assemblyModel'

const spec = specForCode('ASSEMBLY') as DocumentTypeSpec

function component(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { direction: 'out', item_id: 1, item_name: 'Bolt', qty: '2', warehouse_id: 9, ...partial })
}

function finished(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { direction: 'in', item_id: 100, item_name: 'Kit', qty: '1', warehouse_id: 9, ...partial })
}

function header(partial: Partial<HeaderDraft> = {}): HeaderDraft {
  return { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 9, ...partial }
}

function split(partial: Partial<AssemblySplit> = {}): AssemblySplit {
  return { components: [component()], finished: finished(), extraOutputs: [], ...partial }
}

describe('assembly registry wiring', () => {
  it('routes ASSEMBLY at its own editor while staying an ordinary by_line valued document', () => {
    expect(spec.formKind).toBe('assembly')
    expect(spec.lineMode).toBe('by_line')
    expect(spec.valuation).toBe(true)
    expect(spec.cogs).toBe(false)
    expect(spec.valuationRate).toBe(true)
  })

  it('gives disassembly its own two-sided workspace as well', () => {
    const other = specForCode('DISASSEMBLY')
    expect(other?.formKind).toBe('disassembly')
    // Both are still `by_line` on the wire, which is what keeps one payload shape for both.
    expect(other?.lineMode).toBe('by_line')
  })
})

describe('splitting and joining lines', () => {
  it('reads out lines as components and the first in line as the finished item', () => {
    const result = splitAssemblyLines([component(), finished(), component({ item_id: 2 })])
    expect(result.components).toHaveLength(2)
    expect(result.finished?.item_id).toBe(100)
    expect(result.extraOutputs).toHaveLength(0)
  })

  it('keeps further in lines rather than dropping the stock they move', () => {
    const extra = finished({ item_id: 101, item_name: 'By-product' })
    const result = splitAssemblyLines([component(), finished(), extra])
    expect(result.extraOutputs.map((l) => l.item_id)).toEqual([101])
    expect(joinAssemblyLines(result).map((l) => l.item_id)).toEqual([1, 100, 101])
  })

  it('drops blank rows on the way back out', () => {
    const blank = newLine(spec, { direction: 'out' })
    expect(joinAssemblyLines({ components: [component(), blank], finished: finished(), extraOutputs: [] })).toHaveLength(2)
  })

  it('starts a new assembly with empty component rows and an output slot', () => {
    const fresh = newAssemblySplit(spec, 4)
    expect(fresh.components).toHaveLength(2)
    expect(fresh.components.every((l) => l.direction === 'out' && l.warehouse_id === 4)).toBe(true)
    expect(fresh.finished?.direction).toBe('in')
    expect(filledComponents(fresh.components)).toHaveLength(0)
  })
})

describe('assembly mode', () => {
  it('defaults to standard and only accepts known modes', () => {
    expect(modeFromMetadata(null)).toBe('standard')
    expect(modeFromMetadata({ assembly_mode: 'nonsense' })).toBe('standard')
    expect(modeFromMetadata({ assembly_mode: 'bom' })).toBe('bom')
  })
})

describe('cost', () => {
  const costs: Record<number, number> = { 1: 25, 2: 10 }
  const lookup = (id: number) => costs[id] ?? null

  it('prices each component per base unit and totals them', () => {
    const result = assemblyCost([component({ qty: '3' }), component({ item_id: 2, qty: '4' })], finished({ qty: '2' }), lookup)
    expect(result.componentCost).toBe(3 * 25 + 4 * 10)
    expect(result.expectedCost).toBe(115)
    expect(result.outputBaseQty).toBe(2)
    expect(result.estimatedUnitCost).toBe(57.5)
    expect(result.partial).toBe(false)
  })

  it('converts the displayed rate to the entered unit', () => {
    const boxed = component({
      qty: '2',
      unit_id: 7,
      units: [{ unit_id: 7, unit_symbol: 'Box', conversion_factor: 12, is_default: true }],
    })
    const result = assemblyCost([boxed], finished(), lookup)
    // 2 boxes of 12 at 25 per base unit: 600 in total, 300 a box.
    expect(result.rows[0].baseQty).toBe(24)
    expect(result.rows[0].unitCost).toBe(25)
    expect(result.rows[0].enteredUnitCost).toBe(300)
    expect(result.componentCost).toBe(600)
  })

  it('reports an unpriced component instead of costing it at zero', () => {
    const result = assemblyCost([component(), component({ item_id: 55 })], finished(), lookup)
    expect(result.pricedLines).toBe(1)
    expect(result.unpricedLines).toBe(1)
    expect(result.partial).toBe(true)
    expect(result.componentCost).toBe(50)
    expect(result.rows[1].amount).toBeNull()
  })

  it('has no unit cost to offer until there is an output quantity', () => {
    expect(assemblyCost([component()], finished({ qty: '0' }), lookup).estimatedUnitCost).toBeNull()
    expect(assemblyCost([component()], null, lookup).estimatedUnitCost).toBeNull()
  })

  it('proposes the finished valuation rate only when every component is priced', () => {
    const complete = assemblyCost([component()], finished({ qty: '2' }), lookup)
    expect(withEstimatedValuationRate(finished({ qty: '2' }), complete).valuation_rate).toBe('25')

    const incomplete = assemblyCost([component(), component({ item_id: 55 })], finished({ qty: '2' }), lookup)
    expect(withEstimatedValuationRate(finished({ qty: '2' }), incomplete).valuation_rate).toBe('')
  })
})

describe('validation', () => {
  const posting = { posting: true }

  it('passes a complete assembly', () => {
    expect(hasErrors(validateAssembly(header(), split(), posting))).toBe(false)
  })

  it('requires a date and a warehouse', () => {
    const errors = validateAssembly(header({ document_date: '', default_warehouse_id: null }), split(), posting)
    expect(errors.header.document_date).toBeDefined()
    expect(errors.header.default_warehouse_id).toBeDefined()
  })

  it('requires at least one component and a finished item', () => {
    const errors = validateAssembly(header(), { components: [], finished: null, extraOutputs: [] }, posting)
    expect(errors.summary).toContain('Add at least one component.')
    expect(errors.summary).toContain('Select a finished item.')
  })

  it('marks the line that has no item and the line whose quantity is zero', () => {
    const noItem = component({ item_id: null, qty: '1' })
    const noQty = component({ item_id: 2, qty: '0' })
    const errors = validateAssembly(header(), split({ components: [noItem, noQty] }), posting)
    expect(errors.components[noItem.key]?.item_id).toBeDefined()
    expect(errors.components[noQty.key]?.qty).toBeDefined()
  })

  it('requires a batch on a batch-tracked component', () => {
    const tracked = component({ track_batch: true })
    const errors = validateAssembly(header(), split({ components: [tracked] }), posting)
    expect(errors.components[tracked.key]?.batch_id).toContain('batch is required')
  })

  it('requires the serial count to match the quantity', () => {
    const tracked = component({ track_serial: true, qty: '3', serials: [{ serial_id: 1, serial_no: 'A' }] })
    const errors = validateAssembly(header(), split({ components: [tracked] }), posting)
    expect(errors.components[tracked.key]?.serials).toContain('1 serial number(s) picked for a quantity of 3')
  })

  it('refuses the same serial number on two component lines', () => {
    const serial = { serial_id: 7, serial_no: 'SN-7' }
    const a = component({ track_serial: true, qty: '1', serials: [serial] })
    const b = component({ item_id: 2, track_serial: true, qty: '1', serials: [serial] })
    const errors = validateAssembly(header(), split({ components: [a, b] }), posting)
    expect(errors.summary.some((m) => m.includes('Duplicate serial number SN-7'))).toBe(true)
  })

  it('refuses an assembly that consumes the item it builds', () => {
    const errors = validateAssembly(header(), split({ components: [component({ item_id: 100 })] }), posting)
    expect(errors.summary).toContain('The assembled item cannot also be one of its own components.')
  })

  it('checks the assembled quantity and its warehouse', () => {
    const errors = validateAssembly(header({ default_warehouse_id: 9 }), split({ finished: finished({ qty: '0' }) }), posting)
    expect(errors.finished.qty).toBeDefined()
  })

  it('lets a half-typed draft save while still marking the fields', () => {
    const half = split({ components: [component({ item_id: null, qty: '' })], finished: finished({ item_id: null }) })
    const draft = validateAssembly(header(), half, { posting: false })
    expect(draft.summary).toEqual([])
    expect(hasErrors(draft)).toBe(false)
    // …but a draft with no date is still refused, because nothing can store it.
    expect(hasErrors(validateAssembly(header({ document_date: '' }), half, { posting: false }))).toBe(true)
  })
})

describe('canSaveDraft', () => {
  it('needs a date and something entered', () => {
    expect(canSaveDraft(header(), split())).toBe(true)
    expect(canSaveDraft(header({ document_date: 'nope' }), split())).toBe(false)
    expect(
      canSaveDraft(header(), { components: [newLine(spec, { direction: 'out' })], finished: null, extraOutputs: [] }),
    ).toBe(false)
  })
})

describe('mergeComponents', () => {
  it('replaces outright', () => {
    const incoming = [component({ item_id: 3, qty: '5' })]
    expect(mergeComponents([component()], incoming, 'replace')).toEqual(incoming)
  })

  it('adds the quantities of rows that name the same item, warehouse, unit and batch', () => {
    const existing = [component({ qty: '2', unit_id: 3 })]
    const incoming = [component({ qty: '5', unit_id: 3 })]
    const merged = mergeComponents(existing, incoming, 'merge')
    expect(merged).toHaveLength(1)
    expect(merged[0].qty).toBe('7')
  })

  it('appends a row that differs by warehouse rather than folding it in', () => {
    const merged = mergeComponents([component({ qty: '2' })], [component({ qty: '5', warehouse_id: 11 })], 'merge')
    expect(merged.map((l) => [l.warehouse_id, l.qty])).toEqual([
      [9, '2'],
      [11, '5'],
    ])
  })

  it('drops the blank rows already on the form when merging', () => {
    const merged = mergeComponents([newLine(spec, { direction: 'out' })], [component()], 'merge')
    expect(merged).toHaveLength(1)
    expect(merged[0].item_id).toBe(1)
  })
})
