/**
 * Ready-made sets of charge ROWS.
 *
 * These are local starting points, not stored templates: they seed empty rows with the cost types
 * and bases a consignment of that shape usually carries, and every amount is left blank for the
 * operator to key from the bill. Nothing is fetched and nothing is saved — Inventory has no charge
 * template store, and a menu that implied one would promise a round trip that does not exist.
 *
 * A preset whose cost type this company does not capitalise is dropped from the set rather than
 * offered and refused: see offeredCostTypes().
 */

import { newCharge } from '../landedCost'
import type { AllocationBasis, ChargeDraft, LandedCostPolicy, LandedCostType } from '../landedCost'

export interface ChargePreset {
  key: string
  label: string
  description: string
  rows: { cost_type: LandedCostType; description: string; allocation_basis: AllocationBasis }[]
}

export const CHARGE_PRESETS: ChargePreset[] = [
  {
    key: 'import',
    label: 'Import consignment',
    description: 'Freight, duty, insurance and clearing',
    rows: [
      { cost_type: 'freight', description: 'International freight', allocation_basis: 'value' },
      { cost_type: 'duty', description: 'Basic customs duty', allocation_basis: 'value' },
      { cost_type: 'insurance', description: 'Marine insurance', allocation_basis: 'value' },
      { cost_type: 'handling', description: 'Clearing and handling', allocation_basis: 'value' },
    ],
  },
  {
    key: 'domestic',
    label: 'Domestic inward',
    description: 'Road freight and unloading',
    rows: [
      { cost_type: 'freight', description: 'Inward road freight', allocation_basis: 'value' },
      { cost_type: 'handling', description: 'Loading and unloading', allocation_basis: 'qty' },
    ],
  },
  {
    key: 'freight-only',
    label: 'Freight only',
    description: 'A single carriage bill',
    rows: [{ cost_type: 'freight', description: '', allocation_basis: 'value' }],
  },
]

/** The preset's rows, minus any cost type this company does not capitalise. */
export function presetCharges(preset: ChargePreset, policy: LandedCostPolicy | null): ChargeDraft[] {
  const allowed = policy === null ? null : policy.capitalisable_cost_types
  return preset.rows
    .filter((row) => allowed === null || allowed.includes(row.cost_type))
    .map((row) => newCharge({ cost_type: row.cost_type, description: row.description, allocation_basis: row.allocation_basis }, policy))
}
