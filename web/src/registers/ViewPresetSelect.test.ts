import { describe, expect, it } from 'vitest'
import { presetMatching, visibilityForPreset } from './ViewPresetSelect'
import type { RegisterViewPreset } from './RegisterConfig'

const COLUMNS = [
  { key: 'item_name', alwaysVisible: true },
  { key: 'sku' },
  { key: 'warehouse' },
  { key: 'qty' },
  { key: 'cost', defaultVisible: false },
  { key: 'value' },
]

const PRESETS: RegisterViewPreset[] = [
  { id: 'default', label: 'Default' },
  { id: 'valuation', label: 'Valuation', columns: ['item_name', 'qty', 'cost', 'value'] },
  { id: 'lean', label: 'Lean', columns: ['qty'] },
]

describe('visibilityForPreset', () => {
  it('falls back to the register’s shipped columns when a preset names none', () => {
    // That is what "Default" is: the config already says which columns ship on.
    expect(visibilityForPreset(COLUMNS, PRESETS[0])).toEqual({
      item_name: true,
      sku: true,
      warehouse: true,
      qty: true,
      cost: false,
      value: true,
    })
    expect(visibilityForPreset(COLUMNS, undefined)).toEqual(visibilityForPreset(COLUMNS, PRESETS[0]))
  })

  it('turns on exactly what the preset names and nothing else', () => {
    expect(visibilityForPreset(COLUMNS, PRESETS[1])).toEqual({
      item_name: true,
      sku: false,
      warehouse: false,
      qty: true,
      cost: true,
      value: true,
    })
  })

  it('cannot hide a column that identifies the row', () => {
    // A grid of numbers with no name against them is not a register, so `alwaysVisible`
    // survives a preset that forgot to list it.
    expect(visibilityForPreset(COLUMNS, PRESETS[2]).item_name).toBe(true)
  })
})

describe('presetMatching', () => {
  it('names the preset the columns on screen actually are', () => {
    expect(presetMatching(COLUMNS, visibilityForPreset(COLUMNS, PRESETS[1]), PRESETS)).toBe('valuation')
    expect(presetMatching(COLUMNS, visibilityForPreset(COLUMNS, PRESETS[0]), PRESETS)).toBe('default')
  })

  it('names none once a column has been changed by hand', () => {
    // The control then reads "Custom". Showing "Valuation" over a grid that is no longer
    // the valuation view would make the screen's own label a liar.
    const edited = { ...visibilityForPreset(COLUMNS, PRESETS[1]), sku: true }
    expect(presetMatching(COLUMNS, edited, PRESETS)).toBe('')
  })

  it('is stable regardless of the order the map happens to be in', () => {
    const shuffled = { value: true, item_name: true, cost: true, qty: true, sku: false, warehouse: false }
    expect(presetMatching(COLUMNS, shuffled, PRESETS)).toBe('valuation')
  })
})
