import { describe, expect, it } from 'vitest'
import { switchableCostTypes } from './CompanySettingsPage'
import type { LandedCostPolicy, LandedCostType } from '../../documents/landedCost'

const policy = (switchable: LandedCostType[]): LandedCostPolicy => ({
  capitalisable_cost_types: [...switchable, 'non_creditable_tax'],
  excluded_cost_types: [],
  switchable_cost_types: switchable,
  always_capitalised_cost_types: ['non_creditable_tax'],
  all_cost_types: [...switchable, 'non_creditable_tax'],
})

describe('which landed-cost types the settings screen offers', () => {
  it('renders exactly what the server says is switchable', () => {
    // The PHP side has a parity test tying InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES
    // to DocumentService::LANDED_COST_TYPES, and the panel derives from the same response. A
    // hard-coded copy here drifted in one direction only: a sixth switchable type would be
    // reported by the endpoint, offered by the panel — and get no checkbox on this screen, so no
    // company could ever switch it off.
    const sixth = ['freight', 'duty', 'insurance', 'handling', 'other', 'royalty'] as unknown as LandedCostType[]

    expect(switchableCostTypes(policy(sixth))).toEqual(sixth)
  })

  it('drops a type the server stopped offering', () => {
    expect(switchableCostTypes(policy(['freight', 'duty'] as LandedCostType[]))).toEqual(['freight', 'duty'])
  })

  it('falls back only when the response carries no policy block at all', () => {
    expect(switchableCostTypes(undefined)).toEqual(['freight', 'duty', 'insurance', 'handling', 'other'])
    expect(switchableCostTypes(policy([]))).toEqual(['freight', 'duty', 'insurance', 'handling', 'other'])
  })

  it('never offers the one type that is not a choice', () => {
    expect(switchableCostTypes(undefined)).not.toContain('non_creditable_tax')
  })
})
