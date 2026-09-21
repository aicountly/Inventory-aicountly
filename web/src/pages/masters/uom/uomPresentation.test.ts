import { describe, expect, it } from 'vitest'
import {
  changeWarnings,
  convertUnits,
  duplicateClusters,
  findSimilarUnits,
  normaliseUnitToken,
  suggestUqc,
  unitMagnitude,
  unitType,
  validateUnitDraft,
} from './uomPresentation'
import type { Uom } from '../../../services/masters'

const unit = (over: Partial<Uom> & { unit_id: number; unit_name: string }): Uom => ({
  unit_symbol: over.unit_name.slice(0, 3).toUpperCase(),
  print_name: over.unit_name,
  uqc_gst: null,
  decimal_places: 4,
  is_active: 1,
  ...over,
})

describe('normaliseUnitToken', () => {
  it('folds case, punctuation and plurals onto one token', () => {
    for (const spelling of ['Kilogram', 'kilograms', 'KILO-GRAM', ' Kilogram ', 'Kilo Gram']) {
      expect(normaliseUnitToken(spelling)).toBe('kilogram')
    }
  })

  it('leaves short codes alone, so GMS does not become GM', () => {
    expect(normaliseUnitToken('GMS')).toBe('gms')
    expect(normaliseUnitToken('PCS')).toBe('pcs')
    expect(normaliseUnitToken('NOS')).toBe('nos')
  })

  it('handles -es plurals without eating the stem', () => {
    expect(normaliseUnitToken('Boxes')).toBe('box')
    expect(normaliseUnitToken('Bunches')).toBe('bunch')
    expect(normaliseUnitToken('Glasses')).toBe('glass')
  })

  it('strips only the -s from a word that merely ends in e', () => {
    // A blanket -es rule turned "Litres" into "litr" and stopped it matching
    // "Litre" — the exact collision this function exists to catch.
    expect(normaliseUnitToken('Litres')).toBe('litre')
    expect(normaliseUnitToken('Litre')).toBe('litre')
    expect(normaliseUnitToken('Pieces')).toBe('piece')
    expect(normaliseUnitToken('Tonnes')).toBe('tonne')
  })

  it('is empty for nothing', () => {
    expect(normaliseUnitToken(null)).toBe('')
    expect(normaliseUnitToken('  ')).toBe('')
  })
})

describe('unitMagnitude', () => {
  it('reads the name before the GST code', () => {
    // The live data has Feet filed under NOS, because the schema has no code
    // for feet. Feet is still a length.
    const feet = unitMagnitude({ unit_name: 'Feet', unit_symbol: 'FT', uqc_gst: 'NOS' })
    expect(feet).toEqual({ dimension: 'length', factor: 0.3048, base: 'metre' })
  })

  it('falls back to the symbol, then the code', () => {
    expect(unitMagnitude({ unit_name: 'Werble', unit_symbol: 'KG', uqc_gst: null })?.dimension).toBe('mass')
    expect(unitMagnitude({ unit_name: 'Werble', unit_symbol: 'WB', uqc_gst: 'LTR' })?.dimension).toBe('volume')
  })

  it('refuses to size packaging', () => {
    for (const name of ['Box', 'Carton', 'Bag', 'Bundle', 'Set']) {
      expect(unitMagnitude({ unit_name: name, unit_symbol: name.slice(0, 3), uqc_gst: null })).toBeNull()
    }
  })

  it('knows the counts that are definitions', () => {
    expect(unitMagnitude({ unit_name: 'Dozen', unit_symbol: 'DOZ', uqc_gst: 'DOZ' })?.factor).toBe(12)
    expect(unitMagnitude({ unit_name: 'Pair', unit_symbol: 'PR', uqc_gst: 'PRS' })?.factor).toBe(2)
    expect(unitMagnitude({ unit_name: 'Gross', unit_symbol: 'GRS', uqc_gst: 'GRS' })?.factor).toBe(144)
  })
})

describe('convertUnits', () => {
  const kg = { unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS' }
  const gram = { unit_name: 'Gram', unit_symbol: 'G', uqc_gst: 'GMS' }
  const litre = { unit_name: 'Litre', unit_symbol: 'L', uqc_gst: 'LTR' }
  const box = { unit_name: 'Box', unit_symbol: 'BOX', uqc_gst: 'BOX' }

  it('converts within a dimension', () => {
    expect(convertUnits(kg, gram, 25)).toEqual({ ok: true, value: 25000, dimension: 'mass' })
    expect(convertUnits(gram, kg, 500)).toEqual({ ok: true, value: 0.5, dimension: 'mass' })
  })

  it('refuses across dimensions rather than inventing a factor', () => {
    expect(convertUnits(kg, litre, 1)).toEqual({ ok: false, reason: 'different-dimensions' })
  })

  it('refuses packaging on either side', () => {
    expect(convertUnits(box, kg, 5)).toEqual({ ok: false, reason: 'unknown-from' })
    expect(convertUnits(kg, box, 5)).toEqual({ ok: false, reason: 'unknown-to' })
  })

  it('refuses a value that is not a number', () => {
    expect(convertUnits(kg, gram, Number.NaN)).toEqual({ ok: false, reason: 'bad-value' })
  })

  it('round-trips through awkward factors', () => {
    const ft = { unit_name: 'Feet', unit_symbol: 'FT', uqc_gst: 'NOS' }
    const m = { unit_name: 'Meter', unit_symbol: 'M', uqc_gst: 'MTR' }
    const there = convertUnits(ft, m, 10)
    expect(there.ok).toBe(true)
    const back = there.ok ? convertUnits(m, ft, there.value) : null
    expect(back?.ok && back.value).toBeCloseTo(10, 10)
  })
})

describe('findSimilarUnits', () => {
  const rows: Uom[] = [
    unit({ unit_id: 1, unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS', usage_count: 18 }),
    unit({ unit_id: 2, unit_name: 'Litre', unit_symbol: 'L', uqc_gst: 'LTR' }),
    unit({ unit_id: 3, unit_name: 'Kilos', unit_symbol: 'KGX', uqc_gst: null }),
  ]

  it('flags an exact name collision as high confidence', () => {
    const [first] = findSimilarUnits({ unit_name: 'kilograms', unit_symbol: 'KGM' }, rows)
    expect(first.row.unit_id).toBe(1)
    expect(first.reason).toBe('name')
    expect(first.confidence).toBe('high')
  })

  it('flags a symbol collision', () => {
    const matches = findSimilarUnits({ unit_name: 'Kay Gee', unit_symbol: 'kg' }, rows)
    expect(matches[0]).toMatchObject({ reason: 'symbol', confidence: 'high' })
  })

  it('flags a unit of the same size as worth a look, not a certainty', () => {
    const matches = findSimilarUnits({ unit_name: 'Kilo', unit_symbol: 'KLO' }, rows)
    expect(matches.some((m) => m.row.unit_id === 1 && m.confidence === 'medium')).toBe(true)
  })

  it('never flags the row being edited against itself', () => {
    const matches = findSimilarUnits({ unit_name: 'Kilogram', unit_symbol: 'KG' }, rows, 1)
    expect(matches.map((m) => m.row.unit_id)).not.toContain(1)
    // "Kilos" is still reported: it is the same size of the same quantity under
    // another spelling, which is the duplicate this screen exists to surface.
    expect(matches.map((m) => m.row.unit_id)).toEqual([3])
  })

  it('says nothing about an empty draft', () => {
    expect(findSimilarUnits({ unit_name: '', unit_symbol: '' }, rows)).toEqual([])
  })

  it('puts certainties first', () => {
    const matches = findSimilarUnits({ unit_name: 'Kilogram', unit_symbol: 'KLO' }, rows)
    expect(matches[0].confidence).toBe('high')
  })
})

describe('duplicateClusters', () => {
  it('groups the spellings of one unit and suggests the most-used as canonical', () => {
    const rows: Uom[] = [
      unit({ unit_id: 1, unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS', usage_count: 18 }),
      unit({ unit_id: 2, unit_name: 'Kilograms', unit_symbol: 'KGS', uqc_gst: null, usage_count: 1 }),
      unit({ unit_id: 3, unit_name: 'Litre', unit_symbol: 'L', uqc_gst: 'LTR', usage_count: 10 }),
    ]
    const clusters = duplicateClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].rows.map((r) => r.unit_id).sort()).toEqual([1, 2])
    expect(clusters[0].canonical.unit_id).toBe(1)
    expect(clusters[0].confidence).toBe('high')
  })

  it('finds nothing in a clean master', () => {
    const rows: Uom[] = [
      unit({ unit_id: 1, unit_name: 'Kilogram', unit_symbol: 'KG' }),
      unit({ unit_id: 2, unit_name: 'Litre', unit_symbol: 'L' }),
      unit({ unit_id: 3, unit_name: 'Meter', unit_symbol: 'M' }),
    ]
    expect(duplicateClusters(rows)).toEqual([])
  })

  it('reports a cluster once, not once per shared token', () => {
    const rows: Uom[] = [
      unit({ unit_id: 1, unit_name: 'Dozen', unit_symbol: 'DOZ', print_name: 'Dozen' }),
      unit({ unit_id: 2, unit_name: 'Dozen', unit_symbol: 'DOZ', print_name: 'Dozen' }),
    ]
    expect(duplicateClusters(rows)).toHaveLength(1)
  })
})

describe('suggestUqc', () => {
  it('suggests from the name with high confidence', () => {
    expect(suggestUqc({ unit_name: 'Kilogram', unit_symbol: 'XX', print_name: null })).toEqual({
      code: 'KGS',
      confidence: 'high',
      from: 'name',
    })
  })

  it('falls back to the symbol at lower confidence', () => {
    expect(suggestUqc({ unit_name: 'Werble', unit_symbol: 'PCS', print_name: null })).toMatchObject({
      code: 'PCS',
      confidence: 'medium',
    })
  })

  it('says nothing for a unit the schema has no code for', () => {
    expect(suggestUqc({ unit_name: 'Feet', unit_symbol: 'FT', print_name: 'Feet' })).toBeNull()
    expect(suggestUqc({ unit_name: 'Inch', unit_symbol: 'IN', print_name: 'Inch' })).toBeNull()
  })

  it('says nothing for a unit it does not recognise at all', () => {
    expect(suggestUqc({ unit_name: 'Blorp', unit_symbol: 'BLP', print_name: null })).toBeNull()
  })
})

describe('unitType', () => {
  it('trusts what the API said', () => {
    expect(unitType({ uqc_gst: null, uom_type: 'standard' })).toBe('standard')
  })

  it('falls back to whether a code is present', () => {
    expect(unitType({ uqc_gst: 'KGS' })).toBe('standard')
    expect(unitType({ uqc_gst: null })).toBe('custom')
    expect(unitType({ uqc_gst: '  ' })).toBe('custom')
  })
})

describe('validateUnitDraft', () => {
  it('requires a name and a symbol', () => {
    const errors = validateUnitDraft({ unit_name: '  ', unit_symbol: '' })
    expect(errors.unit_name).toBeTruthy()
    expect(errors.unit_symbol).toBeTruthy()
  })

  it('accepts a complete draft', () => {
    expect(
      validateUnitDraft({ unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS', decimal_places: 3 }, { knownUqcCodes: ['KGS'] }),
    ).toEqual({})
  })

  it('holds decimals to what the column stores', () => {
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', decimal_places: 9 }).decimal_places).toBeTruthy()
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', decimal_places: -1 }).decimal_places).toBeTruthy()
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', decimal_places: 2.5 }).decimal_places).toBeTruthy()
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', decimal_places: 0 }).decimal_places).toBeUndefined()
  })

  it('checks the UQC against the catalogue when it has one', () => {
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', uqc_gst: 'ZZZ' }, { knownUqcCodes: ['KGS'] }).uqc_gst).toBeTruthy()
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', uqc_gst: 'kgs' }, { knownUqcCodes: ['KGS'] }).uqc_gst).toBeUndefined()
  })

  it('falls back to a shape check when the catalogue could not be read', () => {
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', uqc_gst: 'KGS' }).uqc_gst).toBeUndefined()
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', uqc_gst: 'K1' }).uqc_gst).toBeTruthy()
  })

  it('leaves an empty UQC alone — it is optional', () => {
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'A', uqc_gst: '' }, { knownUqcCodes: ['KGS'] }).uqc_gst).toBeUndefined()
  })

  it('rejects an over-long symbol before the server has to', () => {
    expect(validateUnitDraft({ unit_name: 'A', unit_symbol: 'X'.repeat(17) }).unit_symbol).toBeTruthy()
  })
})

describe('changeWarnings', () => {
  const before = unit({ unit_id: 1, unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'KGS' })

  it('warns when the printed symbol changes', () => {
    expect(changeWarnings(before, { unit_name: 'Kilogram', unit_symbol: 'KGM', uqc_gst: 'KGS' })).toHaveLength(1)
  })

  it('warns when the reported code changes', () => {
    expect(changeWarnings(before, { unit_name: 'Kilogram', unit_symbol: 'KG', uqc_gst: 'MTS' })).toHaveLength(1)
  })

  it('stays quiet when neither changed', () => {
    expect(changeWarnings(before, { unit_name: 'Kilo', unit_symbol: 'KG', uqc_gst: 'kgs' })).toEqual([])
  })
})
