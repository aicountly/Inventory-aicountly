import { describe, expect, it } from 'vitest'
import type { Bom } from '../../../services/masters'
import {
  BOM_STATUS_LABEL,
  COST_UNAVAILABLE,
  bomCode,
  bomHealth,
  bomStatus,
  compactCost,
  componentChips,
  componentLabel,
  creationTrend,
  exactCost,
  sharePercent,
  yieldLabel,
} from './bomPresentation'

function bom(over: Partial<Bom> = {}): Bom {
  return {
    bom_id: 7,
    bom_name: 'Office chair - standard',
    finished_item_id: 900,
    yield_qty: 1,
    yield_unit_id: 1,
    is_active: 1,
    finished_item_name: 'Office chair',
    finished_item_sku: 'ITM-CH-001',
    finished_item_is_active: 1,
    yield_unit_symbol: 'pc',
    line_count: 3,
    component_count: 3,
    components_preview: [
      { item_id: 1, item_name: 'Wooden seat', item_sku: 'WS-1', qty: 1, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
      { item_id: 2, item_name: 'Metal leg', item_sku: 'ML-1', qty: 4, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
      { item_id: 3, item_name: 'Screw', item_sku: 'SC-1', qty: 16, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
    ],
    ...over,
  }
}

describe('bomCode', () => {
  it('prefers what the API sent', () => {
    expect(bomCode(bom({ bom_code: 'BOM-042' }))).toBe('BOM-042')
  })

  it('formats the id the same way the API does when the field is absent', () => {
    expect(bomCode(bom({ bom_id: 7 }))).toBe('BOM-007')
    expect(bomCode(bom({ bom_id: 1234 }))).toBe('BOM-1234')
  })
})

describe('bomStatus', () => {
  it('reads the stored flag and nothing else', () => {
    expect(bomStatus({ is_active: 1 })).toBe('active')
    expect(bomStatus({ is_active: 0 })).toBe('inactive')
    // The API sends ints as strings on some drivers.
    expect(bomStatus({ is_active: '1' as unknown as number })).toBe('active')
  })

  /*
   * The record has no draft state. The label exists so a future API state has
   * somewhere to land, but nothing may derive it today — a bill shown as a
   * draft that the server considers active is a live manufacturing recipe
   * presented as work in progress.
   */
  it('never invents a draft', () => {
    expect(BOM_STATUS_LABEL.draft).toBe('Draft')
    for (const flag of [0, 1, '0', '1', null, undefined]) {
      expect(bomStatus({ is_active: flag as unknown as number })).not.toBe('draft')
    }
  })
})

describe('componentChips', () => {
  it('counts from component_count, not from the capped preview', () => {
    // Nine components, four previewed by the API, three chips on screen.
    const row = bom({
      component_count: 9,
      components_preview: bom().components_preview?.slice(0, 4),
    })
    const chips = componentChips(row, 3)
    expect(chips.visible).toHaveLength(3)
    expect(chips.total).toBe(9)
    expect(chips.hidden).toBe(6)
    expect(chips.previewMissing).toBe(false)
  })

  it('reports a missing preview instead of drawing nothing', () => {
    const chips = componentChips(bom({ components_preview: undefined, component_count: 5 }))
    expect(chips.previewMissing).toBe(true)
    expect(chips.total).toBe(5)
    expect(chips.visible).toEqual([])
  })

  it('labels a chip with its quantity and unit', () => {
    expect(componentLabel(bom().components_preview![1])).toBe('Metal leg · 4 pc')
  })
})

describe('yieldLabel', () => {
  it('joins the quantity and the unit, and copes without a unit', () => {
    expect(yieldLabel({ yield_qty: 1, yield_unit_symbol: 'pc' })).toBe('1 pc')
    expect(yieldLabel({ yield_qty: 2.5, yield_unit_symbol: null })).toBe('2.5')
  })
})

describe('bomHealth', () => {
  it('passes a complete bill', () => {
    expect(bomHealth(bom())).toEqual({ level: 'ok', reasons: [] })
  })

  it('flags an inactive component by name', () => {
    const preview = bom().components_preview!
    const health = bomHealth(bom({ components_preview: [{ ...preview[0], item_is_active: 0 }, preview[1], preview[2]] }))
    expect(health.level).toBe('review')
    expect(health.reasons[0]).toContain('Wooden seat')
  })

  it('flags an inactive finished item, a zero quantity and a zero yield', () => {
    const preview = bom().components_preview!
    const health = bomHealth(
      bom({
        finished_item_is_active: 0,
        yield_qty: 0,
        components_preview: [{ ...preview[0], qty: 0 }, preview[1], preview[2]],
      }),
    )
    expect(health.reasons).toEqual([
      'The finished item is inactive.',
      'A component has no quantity.',
      'Yield quantity must be greater than zero.',
    ])
  })

  it('flags implausible scrap', () => {
    const preview = bom().components_preview!
    const health = bomHealth(bom({ components_preview: [{ ...preview[0], scrap_percent: 80 }, preview[1], preview[2]] }))
    expect(health.reasons[0]).toMatch(/Scrap above 50%/)
  })

  /*
   * A list fetched without `with_preview` carries no components to inspect.
   * That is a missing input, not a finding, and a table full of amber chips
   * because of it would train the eye to ignore the column.
   */
  it('says nothing about components it was never given', () => {
    const health = bomHealth(bom({ components_preview: undefined, component_count: undefined }))
    expect(health).toEqual({ level: 'ok', reasons: [] })
  })

  it('does flag a bill the API said has no components', () => {
    const health = bomHealth(bom({ components_preview: [], component_count: 0 }))
    expect(health.reasons[0]).toMatch(/No component lines/)
  })
})

describe('money', () => {
  it('prints the phrase rather than a zero when nothing could be priced', () => {
    expect(compactCost(null, 'INR')).toBe(COST_UNAVAILABLE)
    expect(exactCost(null, 'INR')).toBe(COST_UNAVAILABLE)
    expect(exactCost(undefined, 'INR')).toBe(COST_UNAVAILABLE)
  })

  it('still prints a real zero', () => {
    expect(exactCost(0, 'INR')).toBe('₹0.00')
    expect(compactCost(0, 'INR')).not.toBe(COST_UNAVAILABLE)
  })

  it('follows the company currency instead of assuming rupees', () => {
    expect(exactCost(1234.5, 'USD')).toBe('USD 1,234.50')
    expect(compactCost(1246000, 'INR')).toBe('₹ 12.46 L')
    expect(compactCost(1246000, 'USD')).toBe('$ 1.25M')
  })
})

describe('summary captions', () => {
  it('shares round to whole percentages and refuse to divide by nothing', () => {
    expect(sharePercent(20, 24)).toBe(83)
    expect(sharePercent(0, 0)).toBeNull()
    expect(sharePercent(4, 0)).toBeNull()
  })

  it('shows a trend chip only when something was actually created', () => {
    expect(creationTrend({ created_last_30_days: 4, created_previous_30_days: 1 })).toEqual({
      badge: '+4',
      caption: 'added in the last 30 days',
    })
    expect(creationTrend({ created_last_30_days: 0, created_previous_30_days: 9 })).toEqual({
      badge: null,
      caption: 'none added in 30 days',
    })
  })
})
