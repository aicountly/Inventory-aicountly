import { describe, expect, it } from 'vitest'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { assemblyInsights } from './assemblyInsights'
import type { InsightInput } from './assemblyInsights'
import { assemblyCost } from './assemblyModel'

const spec = specForCode('ASSEMBLY') as DocumentTypeSpec

function component(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(spec, { direction: 'out', item_id: 1, item_name: 'Bolt', qty: '2', ...partial })
}

function ok(key: string): Record<string, AvailabilityCheckResult> {
  return { [key]: { index: 0, item_id: 1, requested: 2, available: 10, on_hand: 10, ok: true } }
}

function short(key: string, gap = 8): Record<string, AvailabilityCheckResult> {
  return { [key]: { index: 0, item_id: 1, requested: 20, available: 12, on_hand: 12, ok: false, short_by: gap } }
}

function input(partial: Partial<InsightInput> = {}): InsightInput {
  const components = partial.components ?? []
  return {
    components,
    finished: null,
    availability: {},
    cost: assemblyCost(components, partial.finished ?? null, () => null),
    bomForFinished: null,
    mode: 'standard',
    lastAssembly: null,
    ...partial,
  }
}

describe('assemblyInsights', () => {
  it('says nothing about an empty form with nothing to suggest', () => {
    expect(assemblyInsights(input())).toEqual([])
  })

  it('names the worst shortage first', () => {
    const line = component()
    const result = assemblyInsights(input({ components: [line], availability: short(line.key) }))
    expect(result[0].kind).toBe('shortage')
    expect(result[0].tone).toBe('critical')
    expect(result[0].message).toContain('Bolt')
    expect(result[0].message).toContain('8')
  })

  it('stays quiet when everything is available', () => {
    const line = component()
    const result = assemblyInsights(input({ components: [line], availability: ok(line.key) }))
    expect(result.some((i) => i.kind === 'shortage')).toBe(false)
  })

  it('flags a serial-tracked line whose serials do not match the quantity', () => {
    const line = component({ track_serial: true, qty: '3', serials: [{ serial_id: 1, serial_no: 'A' }] })
    const result = assemblyInsights(input({ components: [line] }))
    expect(result.some((i) => i.kind === 'missing_serials')).toBe(true)
  })

  it('asks for the assembled item once components exist', () => {
    const result = assemblyInsights(input({ components: [component()] }))
    expect(result.some((i) => i.kind === 'no_output')).toBe(true)
  })

  it('offers the BOM of the chosen item while the component list is still empty', () => {
    const result = assemblyInsights(
      input({
        finished: newLine(spec, { direction: 'in', item_id: 100, item_name: 'Kit', qty: '1' }),
        bomForFinished: { bom_id: 3, bom_name: 'Kit BOM' },
      }),
    )
    const hit = result.find((i) => i.kind === 'bom_available')
    expect(hit?.actionLabel).toBe('Import from BOM')
    expect(hit?.message).toContain('Kit BOM')
  })

  it('stops offering a BOM once the user has said this kit is custom', () => {
    const result = assemblyInsights(
      input({
        mode: 'custom',
        finished: newLine(spec, { direction: 'in', item_id: 100, item_name: 'Kit', qty: '1' }),
        bomForFinished: { bom_id: 3, bom_name: 'Kit BOM' },
      }),
    )
    expect(result.some((i) => i.kind === 'bom_available')).toBe(false)
  })

  it('remarks on one component carrying most of the cost', () => {
    const dear = component({ item_id: 1, qty: '1', item_name: 'Board' })
    const cheap = component({ item_id: 2, qty: '1', item_name: 'Bolt' })
    const components = [dear, cheap]
    const costs: Record<number, number> = { 1: 900, 2: 100 }
    const result = assemblyInsights(
      input({ components, cost: assemblyCost(components, null, (id) => costs[id] ?? null) }),
    )
    const hit = result.find((i) => i.kind === 'cost_concentration')
    expect(hit?.message).toContain('Board')
    expect(hit?.message).toContain('90%')
  })

  it('does not remark when the cost is spread evenly', () => {
    const components = [component({ item_id: 1, qty: '1' }), component({ item_id: 2, qty: '1' })]
    const costs: Record<number, number> = { 1: 500, 2: 500 }
    const result = assemblyInsights(
      input({ components, cost: assemblyCost(components, null, (id) => costs[id] ?? null) }),
    )
    expect(result.some((i) => i.kind === 'cost_concentration')).toBe(false)
  })

  it('offers the previous assembly only while nothing has been entered', () => {
    const last = { document_id: 5, document_no: 'ASM-00023', finished_item: 'Office table' }
    expect(assemblyInsights(input({ lastAssembly: last })).some((i) => i.kind === 'repeat_last')).toBe(true)
    expect(
      assemblyInsights(input({ components: [component()], lastAssembly: last })).some((i) => i.kind === 'repeat_last'),
    ).toBe(false)
  })
})
