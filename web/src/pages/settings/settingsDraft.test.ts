import { describe, expect, it } from 'vitest'
import {
  configurationHealth,
  draftPatch,
  isDirty,
  normaliseExcluded,
  toDraft,
  validateDraft,
} from './settingsDraft'
import type { SettingsDraft } from './settingsDraft'
import type { LandedCostPolicy, LandedCostType } from '../../documents/landedCost'
import type { CompanySettings } from '../../services/settingsApi'

const policy = (excluded: LandedCostType[] = []): LandedCostPolicy => ({
  capitalisable_cost_types: (['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'] as LandedCostType[]).filter(
    (t) => !excluded.includes(t),
  ),
  excluded_cost_types: excluded,
  switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
  always_capitalised_cost_types: ['non_creditable_tax'],
  all_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
})

/** A row as the database hands it back: booleans as strings, the excluded set as a column. */
const row = (over: Partial<CompanySettings> = {}): CompanySettings => ({
  cmp_id: 7,
  default_valuation_method: 'FIFO',
  valuation_scope: 'company',
  negative_stock_policy: 'allow',
  approval_required: '0',
  fefo_enabled: '1',
  cogs_revision_mode: 'inline',
  base_currency_code: 'INR',
  landed_cost_excluded_types: null,
  landed_cost_policy: policy(),
  settings: {},
  updated_at: '2026-09-13 06:45:00',
  updated_by: 'migration:prod-20260913-0114',
  ...over,
})

describe('the settings row, as a form value', () => {
  it('reads the column shapes the API actually returns', () => {
    const draft = toDraft(row())
    expect(draft.approval_required).toBe(false)
    expect(draft.fefo_enabled).toBe(true)
    expect(draft.default_valuation_method).toBe('FIFO')
  })

  it('normalises what a hand-edited row may hold', () => {
    const draft = toDraft(row({ base_currency_code: ' inr ', default_valuation_method: 'avg', valuation_scope: 'WAREHOUSE', negative_stock_policy: 'BLOCK' }))
    expect(draft.base_currency_code).toBe('INR')
    // 'avg' is a Books-side alias the server maps to WAC; the screen must not offer a value that
    // is not in its own list, so anything unrecognised falls back rather than rendering blank.
    expect(draft.default_valuation_method).toBe('FIFO')
    expect(draft.valuation_scope).toBe('warehouse')
    expect(draft.negative_stock_policy).toBe('block')
  })

  it('prefers the resolved policy block over the raw column', () => {
    const draft = toDraft(row({ landed_cost_excluded_types: 'freight', landed_cost_policy: policy(['duty']) }))
    expect(draft.landed_cost_excluded_types).toEqual(['duty'])
  })

  it('falls back to the column when the response predates the policy block', () => {
    const draft = toDraft(row({ landed_cost_excluded_types: 'other,freight', landed_cost_policy: undefined }))
    expect(draft.landed_cost_excluded_types).toEqual(['freight', 'other'])
  })
})

describe('the excluded set', () => {
  it('is ordered by the vocabulary, not by what the caller typed', () => {
    expect(normaliseExcluded('other, duty ,freight')).toEqual(['freight', 'duty', 'other'])
  })

  it('drops duplicates and anything that is not switchable', () => {
    // non_creditable_tax is not a switch: a row that somehow holds it must not render as a cleared
    // checkbox, because the server refuses to store it either way.
    expect(normaliseExcluded('freight,freight,non_creditable_tax,nonsense')).toEqual(['freight'])
  })

  it('treats null, empty and absent alike — nothing excluded', () => {
    expect(normaliseExcluded(null)).toEqual([])
    expect(normaliseExcluded('')).toEqual([])
    expect(normaliseExcluded(undefined)).toEqual([])
  })
})

describe('what Save actually sends', () => {
  const loaded = toDraft(row())

  it('is nothing at all for a form that was only looked at', () => {
    // The bug this exists to prevent: comparing the raw row against the form marks it dirty on
    // arrival, and one stray click rewrites updated_by on a live valuation policy.
    expect(isDirty(loaded, toDraft(row()))).toBe(false)
    expect(draftPatch(loaded, toDraft(row()))).toEqual({})
  })

  it('carries only the field that changed', () => {
    const edited: SettingsDraft = { ...loaded, negative_stock_policy: 'block' }
    expect(draftPatch(loaded, edited)).toEqual({ negative_stock_policy: 'block' })
    expect(isDirty(loaded, edited)).toBe(true)
  })

  it('sends the whole excluded list when one type is switched off', () => {
    const edited: SettingsDraft = { ...loaded, landed_cost_excluded_types: ['duty'] }
    expect(draftPatch(loaded, edited)).toEqual({ landed_cost_excluded_types: ['duty'] })
  })

  it('does not count a re-ordered excluded list as an edit', () => {
    const server = toDraft(row({ landed_cost_policy: policy(['freight', 'duty']) }))
    const reordered: SettingsDraft = { ...server, landed_cost_excluded_types: ['freight', 'duty'] }
    expect(isDirty(server, reordered)).toBe(false)
  })

  it('stays quiet while nothing has loaded', () => {
    expect(isDirty(null, loaded)).toBe(false)
    expect(isDirty(loaded, null)).toBe(false)
  })
})

describe('validation', () => {
  const loaded = toDraft(row())

  it('accepts a three-letter code', () => {
    expect(validateDraft(loaded)).toEqual({})
  })

  it('refuses a half-typed currency before the server has to', () => {
    expect(validateDraft({ ...loaded, base_currency_code: 'IN' }).base_currency_code).toBeTruthy()
    expect(validateDraft({ ...loaded, base_currency_code: '' }).base_currency_code).toBeTruthy()
  })
})

describe('the configuration summary', () => {
  it('reports the method and the scope', () => {
    const health = configurationHealth(toDraft(row({ negative_stock_policy: 'block' })))
    expect(health.tone).toBe('good')
    expect(health.detail).toContain('FIFO')
    expect(health.detail).toContain('company-wide')
  })

  it('states the negative stock policy without grading it', () => {
    // "allow" is the product default and a deliberate choice for plenty of companies; colouring the
    // card amber for it would make the normal case look like a fault.
    const health = configurationHealth(toDraft(row({ negative_stock_policy: 'allow' })))
    expect(health.tone).toBe('good')
    expect(health.detail).toContain('negative stock allowed')
  })

  it('flags a charge type the company has switched off, ahead of anything else', () => {
    const health = configurationHealth(toDraft(row({ landed_cost_policy: policy(['freight']) })))
    expect(health.tone).toBe('attention')
    expect(health.detail).toContain('1 charge type is expensed')
  })

  it('says nothing definite before the settings have loaded', () => {
    expect(configurationHealth(null).tone).toBe('good')
  })
})
