import { describe, expect, it } from 'vitest'
import { newHeader } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import {
  applyCostBasis,
  averageUnitCost,
  componentsValue,
  disassemblyCounts,
  disassemblyPayload,
  duplicateComponentKeys,
  mergeDraftLines,
  mergeDuplicateComponents,
  newComponentLine,
  newFinishedLine,
  parentValue,
  splitDraftLines,
  stockImpact,
  summaryText,
  valueSummary,
} from './model'

const spec = specForCode('DISASSEMBLY')!

function finished(partial: Partial<LineDraft> = {}): LineDraft {
  return newFinishedLine(spec, { item_id: 1, item_name: 'Laptop', qty: '1', unit_id: 9, warehouse_id: 3, ...partial })
}

function component(partial: Partial<LineDraft> = {}): LineDraft {
  return newComponentLine(spec, { item_id: 2, item_name: 'Motherboard', qty: '1', unit_id: 9, warehouse_id: 3, ...partial })
}

describe('disassembly roles', () => {
  it('stamps the direction from the role, never from the user', () => {
    const lines = mergeDraftLines([finished({ direction: null })], [component({ direction: 'out' })])
    expect(lines.map((l) => l.direction)).toEqual(['out', 'in'])
  })

  it('splits a stored document back into the two sides', () => {
    const { finished: out, components } = splitDraftLines([finished(), component(), component({ item_id: 3 })])
    expect(out).toHaveLength(1)
    expect(components).toHaveLength(2)
  })

  it('treats a stored line with no direction as a component rather than dropping it', () => {
    const { finished: out, components } = splitDraftLines([{ ...component(), direction: null }])
    expect(out).toHaveLength(0)
    expect(components).toHaveLength(1)
    expect(components[0].direction).toBe('in')
  })
})

describe('payload', () => {
  it('posts the parent out and the components in', () => {
    const header = { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 3 }
    const payload = disassemblyPayload({ header, finished: [finished({ qty: '2' })], components: [component({ qty: '2', valuation_rate: '8500' })] }, spec, {
      bom_id: 7,
      cost_basis: 'component_cost',
    })
    expect(payload.document_type).toBe('DISASSEMBLY')
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines[0]).toMatchObject({ item_id: 1, direction: 'out', qty: 2 })
    expect(payload.lines[1]).toMatchObject({ item_id: 2, direction: 'in', qty: 2, valuation_rate: 8500 })
    expect(payload.metadata).toMatchObject({ bom_id: 7, cost_basis: 'component_cost' })
  })

  it('drops blank rows', () => {
    const header = { ...newHeader(spec, '2026-09-18'), default_warehouse_id: 3 }
    const payload = disassemblyPayload({ header, finished: [finished(), newFinishedLine(spec)], components: [component()] }, spec)
    expect(payload.lines).toHaveLength(2)
  })
})

describe('value', () => {
  const components = [
    component({ key: 'a', qty: '1', valuation_rate: '8500' }),
    component({ key: 'b', item_id: 3, qty: '2', valuation_rate: '1200' }),
  ]

  it('values each component at base quantity × unit cost', () => {
    expect(componentsValue(components)).toBe(10900)
    expect(averageUnitCost(components)).toBe(round(10900 / 3))
  })

  it('has no average to report before anything is entered', () => {
    expect(averageUnitCost([])).toBeNull()
  })

  it('prices the parent from the valuation read, not from the form', () => {
    expect(parentValue([finished({ qty: '2' })], (id) => (id === 1 ? 16000 : null))).toBe(32000)
    expect(parentValue([finished()], () => null)).toBeNull()
  })

  it('reports the variance between what came back and what went out', () => {
    const summary = valueSummary({ header: newHeader(spec, '2026-09-18'), finished: [finished()], components }, (id) => (id === 1 ? 11000 : null))
    expect(summary.parentValue).toBe(11000)
    expect(summary.variance).toBe(-100)
  })
})

describe('cost allocation', () => {
  const components = [component({ key: 'a', qty: '1' }), component({ key: 'b', item_id: 3, qty: '3' })]
  const cost = (id: number) => (id === 2 ? 8000 : 1000)

  it('uses the live cost of each item by default', () => {
    const out = applyCostBasis(components, 'component_cost', 11000, cost)
    expect(out.map((l) => l.valuation_rate)).toEqual(['8000', '1000'])
  })

  it('spreads the parent value by quantity', () => {
    const out = applyCostBasis(components, 'by_qty', 12000, cost)
    // 1 : 3 of 12000 → 3000 over 1, and 9000 over 3.
    expect(out.map((l) => l.valuation_rate)).toEqual(['3000', '3000'])
  })

  it('spreads the parent value by component value', () => {
    const out = applyCostBasis(components, 'by_value', 11000, cost)
    // weights 8000 and 3000 → 8000 and 3000 of the parent's 11000.
    expect(out[0].valuation_rate).toBe('8000')
    expect(out[1].valuation_rate).toBe('1000')
  })

  it('is idempotent, so the prefill effect settles instead of looping', () => {
    const once = applyCostBasis(components, 'by_value', 11000, cost)
    const twice = applyCostBasis(once, 'by_value', 11000, cost)
    expect(twice.map((l) => l.valuation_rate)).toEqual(once.map((l) => l.valuation_rate))
  })

  it('leaves manual costs alone', () => {
    const typed = [component({ key: 'a', valuation_rate: '42' })]
    expect(applyCostBasis(typed, 'manual', 999, cost)[0].valuation_rate).toBe('42')
  })
})

describe('stock impact', () => {
  it('groups by unit instead of adding incompatible quantities', () => {
    const groups = stockImpact(
      {
        header: newHeader(spec, '2026-09-18'),
        finished: [finished({ qty: '1' })],
        components: [component({ key: 'a', qty: '2' }), component({ key: 'b', item_id: 4, unit_id: 10, qty: '5' })],
      },
      (id) => (id === 9 ? 'Nos' : 'Kg'),
    )
    expect(groups).toEqual([
      { direction: 'out', unit: 'Nos', qty: 1, lines: 1 },
      { direction: 'in', unit: 'Nos', qty: 2, lines: 1 },
      { direction: 'in', unit: 'Kg', qty: 5, lines: 1 },
    ])
  })
})

describe('duplicates', () => {
  it('flags identical component rows', () => {
    const rows = [component({ key: 'a' }), component({ key: 'b' }), component({ key: 'c', item_id: 9 })]
    expect([...duplicateComponentKeys(rows)].sort()).toEqual(['a', 'b'])
  })

  it('never flags serial-controlled rows, which are different pieces of stock', () => {
    const rows = [component({ key: 'a', track_serial: true }), component({ key: 'b', track_serial: true })]
    expect(duplicateComponentKeys(rows).size).toBe(0)
  })

  it('merges duplicates by adding their quantities', () => {
    const merged = mergeDuplicateComponents([component({ key: 'a', qty: '1' }), component({ key: 'b', qty: '2' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].qty).toBe('3')
  })
})

describe('summary sentence', () => {
  const header = newHeader(spec, '2026-09-18')

  it('counts the rows that are on screen', () => {
    const draft = { header, finished: [finished()], components: [component({ key: 'a' }), component({ key: 'b', item_id: 3 })] }
    expect(summaryText(draft)).toBe('2 components will be produced from 1 finished product.')
    expect(disassemblyCounts(draft)).toEqual({ finishedLines: 1, componentLines: 2, qtyOut: 1, qtyIn: 2 })
  })

  it('never claims zero components while component rows exist', () => {
    const draft = { header, finished: [], components: [component()] }
    expect(summaryText(draft)).toContain('1 component entered')
  })

  it('asks for the finished product first on an empty document', () => {
    expect(summaryText({ header, finished: [], components: [] })).toContain('Nothing entered yet')
  })
})

function round(n: number): number {
  return Number(`${Math.round(Number(`${n}e4`))}e-4`)
}
