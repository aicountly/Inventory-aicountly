import { describe, expect, it } from 'vitest'
import { LANDED_COST_TYPES, defaultBasisFor, defaultCostType, newCharge, offeredCostTypes } from './landedCost'
import type { LandedCostPolicy, LandedCostType } from './landedCost'

/**
 * Which cost types a screen may offer, given the company's capitalisation policy.
 *
 * The policy itself is Inventory's and the server enforces it with a 422; this is only the part
 * that decides what a `<select>` shows. Two behaviours are load-bearing:
 *
 *   - an excluded type is not offered, because the server would refuse it and offering it only
 *     teaches the operator to type something that cannot be saved;
 *   - a type ALREADY on a saved charge IS offered even after the policy switched it off, because a
 *     `<select>` whose value is not among its options renders blank and the next change rewrites
 *     the stored charge to whatever option is first. A draft saved last month must not quietly
 *     become a freight charge; the server's refusal on save is the honest way to learn about it.
 */

function policy(excluded: LandedCostType[]): LandedCostPolicy {
  const capitalisable = LANDED_COST_TYPES.filter((t) => !excluded.includes(t))
  return {
    capitalisable_cost_types: [...capitalisable],
    excluded_cost_types: [...excluded],
    switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
    always_capitalised_cost_types: ['non_creditable_tax'],
    all_cost_types: [...LANDED_COST_TYPES],
  }
}

describe('offeredCostTypes', () => {
  it('offers everything until a policy has been read', () => {
    // The policy is fetched; before it arrives, nothing is hidden. Hiding a type on a failed or
    // pending read would look exactly like a policy nobody set.
    expect(offeredCostTypes(null)).toEqual([...LANDED_COST_TYPES])
  })

  it('offers only what the company capitalises', () => {
    expect(offeredCostTypes(policy(['freight', 'other']))).toEqual(['duty', 'insurance', 'handling', 'non_creditable_tax'])
  })

  it('keeps the vocabulary order rather than the policy list order', () => {
    expect(offeredCostTypes(policy([]))).toEqual([...LANDED_COST_TYPES])
  })

  it('always offers a non-creditable tax, because it is not a switch', () => {
    expect(offeredCostTypes(policy(['freight', 'duty', 'insurance', 'handling', 'other']))).toEqual(['non_creditable_tax'])
  })

  it('still offers the type already on a saved charge after the policy switched it off', () => {
    // Without this the select renders blank and the next edit rewrites a stored freight charge into
    // whatever is first in the list — a silent change to a cost that is already in someone's books.
    expect(offeredCostTypes(policy(['freight']), 'freight')).toContain('freight')
    expect(offeredCostTypes(policy(['freight']), 'freight').at(-1)).toBe('freight')
  })

  it('does not duplicate a current type that is still capitalised', () => {
    const offered = offeredCostTypes(policy(['other']), 'freight')
    expect(offered.filter((t) => t === 'freight')).toHaveLength(1)
  })
})

describe('a new charge row', () => {
  it('starts as freight when freight is capitalised', () => {
    expect(defaultCostType(policy([]))).toBe('freight')
    expect(newCharge({}, policy([])).cost_type).toBe('freight')
  })

  /** Seeding a row with a type the server would refuse is a 422 the user never asked for. */
  it('starts as something the company actually capitalises when freight is off', () => {
    expect(defaultCostType(policy(['freight']))).toBe('duty')
    expect(newCharge({}, policy(['freight'])).cost_type).toBe('duty')
    expect(newCharge({}, policy(['freight', 'duty', 'insurance', 'handling', 'other'])).cost_type).toBe('non_creditable_tax')
  })

  it('pairs the seeded type with the basis that type actually has', () => {
    // A company that expenses all five switchable types leaves non_creditable_tax as the only
    // thing the panel can offer. Seeded on 'value' it pre-fills a pro-rata NON-CREDITABLE TAX —
    // one line's blocked input tax smeared across every line of the receipt. The server accepts it
    // (any basis is valid for any type), no total moves and nothing is dropped; the only symptom
    // is a per-line stock cost that is silently wrong.
    expect(newCharge({}, policy([])).allocation_basis).toBe('value')
    expect(newCharge({}, policy(['freight'])).allocation_basis).toBe('value')
    expect(newCharge({}, policy(['freight', 'duty', 'insurance', 'handling', 'other'])).allocation_basis).toBe('direct')
    expect(defaultBasisFor('non_creditable_tax')).toBe('direct')
    expect(defaultBasisFor('freight')).toBe('value')
  })

  it('still lets a caller state the basis itself', () => {
    // chargesFromMetadata replays a stored charge verbatim; it must not be re-defaulted.
    expect(newCharge({ cost_type: 'non_creditable_tax', allocation_basis: 'manual' }).allocation_basis).toBe('manual')
    expect(newCharge({ cost_type: 'non_creditable_tax' }).allocation_basis).toBe('direct')
  })

  it('still defaults to freight when no policy has been read', () => {
    expect(newCharge().cost_type).toBe('freight')
  })
})
