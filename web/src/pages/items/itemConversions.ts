/**
 * Reading an alternate-unit conversion out loud, and the common ones offered ready-made.
 *
 * The stored number is `conversion_factor`: HOW MANY BASE UNITS MAKE ONE OF THE ALTERNATE UNIT
 * (`inv_item_uoms`, and the same on the Box row of `Box = 12 Pcs`). That direction is the API's,
 * so it is the one the input keeps — what changes here is that the screen now says what the
 * number means in both directions instead of leaving a reader to work it out.
 */

import { toNumber } from '../../utils/format'

/** `conversion_factor` is NUMERIC(18,4); rounding anything finer would print digits the column cannot hold. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Up to 4 decimals, trailing zeros dropped: `12`, `0.0833`, `1.5`. */
export function formatFactor(value: number): string {
  const rounded = round4(value)
  if (!Number.isFinite(rounded)) return '—'
  return String(rounded)
}

export interface ConversionCaption {
  /** `1 Box = 12 Pcs` — the number as it is stored. */
  primary: string
  /** `12 Pcs = 1 Box` — the same fact the other way up, which is how people say it. */
  secondary: string
  /**
   * The reciprocal does not round-trip through 4 decimals.
   *
   * `0.0833` is the closest the column gets to one twelfth, and 1 / 0.0833 is 12.0048, not 12.
   * Saying "12" there would be a rounding the database never agreed to, so the caption says
   * "≈ 12.0048" and the user can see the factor is the lossy end of the pair.
   */
  approximate: boolean
}

/**
 * Both readings of one factor, or null when there is no usable number yet.
 *
 * Nothing is computed in floating point beyond a single division and a round to the column's own
 * precision, so the caption cannot drift from what will be stored.
 */
export function conversionCaption(
  factor: unknown,
  altSymbol: string,
  baseSymbol: string,
): ConversionCaption | null {
  const n = toNumber(factor)
  if (n === null || n <= 0) return null
  const stored = round4(n)
  if (stored <= 0) return null
  const raw = 1 / stored
  const inverse = round4(raw)
  // Approximate whenever the reciprocal had to be rounded to fit the column's four decimals.
  // Multiplying the pair back out is NOT the test: 12.0048 x 0.0833 rounds to exactly 1, which
  // would report the lossiest conversion in the product as exact.
  const approximate = Math.abs(raw - inverse) > 1e-9
  return {
    primary: `1 ${altSymbol} = ${formatFactor(stored)} ${baseSymbol}`,
    secondary: `${approximate ? '≈ ' : ''}${formatFactor(inverse)} ${altSymbol} = 1 ${baseSymbol}`,
    approximate,
  }
}

/* -------------------------------------------------------------------------- */
/* Common conversions                                                         */
/* -------------------------------------------------------------------------- */

interface Family {
  /** Symbols or names that mean "this is the base of the family". */
  base: string[]
  members: { match: string[]; factor: number }[]
}

/**
 * The conversions worth offering, by what the base unit is.
 *
 * Only relationships that are the same everywhere: a dozen is twelve wherever it is counted, a
 * kilogram is a thousand grams. Packaging sizes that vary by company (how many in a carton) are
 * NOT here — offering "case = 24" as a fact would be inventing this company's packing.
 */
const FAMILIES: Family[] = [
  {
    base: ['pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'unit', 'units', 'each', 'ea'],
    members: [
      { match: ['pair', 'pr', 'prs'], factor: 2 },
      { match: ['dozen', 'doz', 'dz'], factor: 12 },
      { match: ['gross', 'grs'], factor: 144 },
    ],
  },
  {
    base: ['g', 'gm', 'gms', 'gram', 'grams'],
    members: [
      { match: ['kg', 'kgs', 'kilogram', 'kilograms'], factor: 1000 },
      { match: ['quintal', 'qtl'], factor: 100000 },
      { match: ['tonne', 'ton', 'mt'], factor: 1000000 },
    ],
  },
  {
    base: ['kg', 'kgs', 'kilogram', 'kilograms'],
    members: [
      { match: ['quintal', 'qtl'], factor: 100 },
      { match: ['tonne', 'ton', 'mt'], factor: 1000 },
    ],
  },
  {
    base: ['ml', 'millilitre', 'milliliter', 'millilitres'],
    members: [{ match: ['l', 'ltr', 'litre', 'liter', 'litres'], factor: 1000 }],
  },
  {
    base: ['l', 'ltr', 'litre', 'liter', 'litres'],
    members: [{ match: ['kl', 'kilolitre', 'kiloliter'], factor: 1000 }],
  },
  {
    base: ['cm', 'centimetre', 'centimeter'],
    members: [
      { match: ['m', 'mtr', 'metre', 'meter', 'metres'], factor: 100 },
      { match: ['inch', 'in'], factor: 2.54 },
      { match: ['ft', 'feet', 'foot'], factor: 30.48 },
    ],
  },
  {
    base: ['m', 'mtr', 'metre', 'meter', 'metres'],
    members: [
      { match: ['km', 'kilometre', 'kilometer'], factor: 1000 },
      { match: ['ft', 'feet', 'foot'], factor: 0.3048 },
      { match: ['yard', 'yd'], factor: 0.9144 },
    ],
  },
  {
    base: ['sqft', 'sq ft', 'squarefeet', 'squarefoot'],
    members: [{ match: ['sqm', 'sq m', 'squaremetre', 'squaremeter'], factor: 10.7639 }],
  },
]

const key = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

function matches(unit: { unit_name: string; unit_symbol: string | null }, names: string[]): boolean {
  const symbol = key(unit.unit_symbol)
  const name = key(unit.unit_name)
  return names.some((n) => {
    const k = key(n)
    return k !== '' && (symbol === k || name === k)
  })
}

export interface CommonConversion {
  unitId: number
  unitLabel: string
  /** Base units in one of this unit — the number the row will carry. */
  factor: number
  caption: string
}

export interface ConversionUnit {
  unit_id: number
  unit_name: string
  unit_symbol: string | null
}

/**
 * Ready-made rows for the item's base unit, limited to units this company actually has.
 *
 * `usedUnitIds` keeps the list to things that can still be added: offering "Dozen" to an item that
 * already has a Dozen row produces a duplicate the validator will reject.
 */
export function commonConversions(
  baseUnit: ConversionUnit | null,
  units: readonly ConversionUnit[],
  usedUnitIds: readonly number[] = [],
): CommonConversion[] {
  if (!baseUnit) return []
  const used = new Set(usedUnitIds.map(Number))
  const baseSymbol = baseUnit.unit_symbol || baseUnit.unit_name
  const out: CommonConversion[] = []
  const add = (unit: ConversionUnit, factor: number) => {
    if (unit.unit_id === baseUnit.unit_id || used.has(unit.unit_id) || factor <= 0) return
    if (out.some((c) => c.unitId === unit.unit_id)) return
    const symbol = unit.unit_symbol || unit.unit_name
    out.push({
      unitId: unit.unit_id,
      unitLabel: `${unit.unit_name}${unit.unit_symbol ? ` (${unit.unit_symbol})` : ''}`,
      factor,
      caption: `1 ${symbol} = ${formatFactor(factor)} ${baseSymbol}`,
    })
  }

  // The item's base unit is the family's base — the members are the bigger units above it.
  const asBase = FAMILIES.find((f) => matches(baseUnit, f.base))
  if (asBase) {
    for (const member of asBase.members) {
      const unit = units.find((u) => matches(u, member.match))
      if (unit) add(unit, member.factor)
    }
  }

  /*
   * The item's base unit is a MEMBER of a family — stock kept in dozens, bought in pieces.
   *
   * Worth handling rather than leaving the menu empty: the relationship is just as standard read
   * downwards, and it is the direction the Ballpoint-Pens case actually takes. The factor is the
   * reciprocal, rounded to the four decimals the column stores, so what the menu offers is exactly
   * what will be saved — 0.0833, not an unstorable one twelfth.
   */
  for (const family of FAMILIES) {
    const member = family.members.find((m) => matches(baseUnit, m.match))
    if (!member) continue
    const unit = units.find((u) => matches(u, family.base))
    if (unit) add(unit, round4(1 / member.factor))
  }

  return out
}
