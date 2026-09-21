import { describe, expect, it } from 'vitest'
import { commonConversions, conversionCaption, formatFactor, round4 } from './itemConversions'

const PCS = { unit_id: 1, unit_name: 'Piece', unit_symbol: 'Pcs' }
const DOZ = { unit_id: 2, unit_name: 'Dozen', unit_symbol: 'DOZ' }
const GROSS = { unit_id: 3, unit_name: 'Gross', unit_symbol: 'Grs' }
const KG = { unit_id: 4, unit_name: 'Kilogram', unit_symbol: 'Kg' }

describe('conversionCaption', () => {
  it('reads the stored factor both ways up', () => {
    const caption = conversionCaption('12', 'DOZ', 'Pcs')
    expect(caption).toEqual({
      primary: '1 DOZ = 12 Pcs',
      secondary: '≈ 0.0833 DOZ = 1 Pcs',
      approximate: true,
    })
  })

  it('marks an exact pair as exact', () => {
    expect(conversionCaption('2', 'Pair', 'Pcs')).toEqual({
      primary: '1 Pair = 2 Pcs',
      secondary: '0.5 Pair = 1 Pcs',
      approximate: false,
    })
  })

  /**
   * One twelfth is not storable in NUMERIC(18,4), so the reciprocal of the stored 0.0833 is
   * 12.0048 and not 12. Printing "12" there would claim a precision the column refused.
   */
  it('says approximately when the reciprocal does not round-trip', () => {
    const caption = conversionCaption('0.0833', 'Pcs', 'DOZ')
    expect(caption?.primary).toBe('1 Pcs = 0.0833 DOZ')
    expect(caption?.secondary).toBe('≈ 12.0048 Pcs = 1 DOZ')
  })

  it('has nothing to say about a blank, zero or negative factor', () => {
    expect(conversionCaption('', 'a', 'b')).toBeNull()
    expect(conversionCaption('0', 'a', 'b')).toBeNull()
    expect(conversionCaption('-3', 'a', 'b')).toBeNull()
    expect(conversionCaption('abc', 'a', 'b')).toBeNull()
  })

  it('rounds to the four decimals the column stores', () => {
    expect(round4(1 / 3)).toBe(0.3333)
    expect(formatFactor(12.0)).toBe('12')
    expect(formatFactor(0.50000001)).toBe('0.5')
  })
})

describe('commonConversions', () => {
  it('offers the units of the base unit family that this company actually has', () => {
    const found = commonConversions(PCS, [PCS, DOZ, KG])
    expect(found).toEqual([
      { unitId: 2, unitLabel: 'Dozen (DOZ)', factor: 12, caption: '1 DOZ = 12 Pcs' },
    ])
  })

  it('leaves out units already on the item', () => {
    expect(commonConversions(PCS, [PCS, DOZ, GROSS], [2]).map((c) => c.unitId)).toEqual([3])
  })

  it('has nothing to offer for a base unit outside the known families', () => {
    expect(commonConversions({ unit_id: 9, unit_name: 'Batch', unit_symbol: 'BCH' }, [PCS, DOZ])).toEqual([])
    expect(commonConversions(null, [PCS, DOZ])).toEqual([])
  })

  /**
   * Stock kept in dozens, bought in pieces — the direction the Ballpoint Pens item actually takes.
   * The offered factor is the reciprocal already rounded to the column's four decimals, so the
   * menu proposes exactly what will be stored rather than an unstorable one twelfth.
   */
  it('works from the other end of a family too', () => {
    expect(commonConversions(DOZ, [DOZ, PCS])).toEqual([
      { unitId: 1, unitLabel: 'Piece (Pcs)', factor: 0.0833, caption: '1 Pcs = 0.0833 DOZ' },
    ])
  })

  it('never offers the base unit or a duplicate of itself', () => {
    const found = commonConversions(PCS, [PCS, DOZ, GROSS])
    expect(found.map((c) => c.unitId)).toEqual([2, 3])
    expect(found.some((c) => c.unitId === PCS.unit_id)).toBe(false)
  })

  it('matches on the unit name when the symbol does not say it', () => {
    const spelled = { unit_id: 7, unit_name: 'Dozen', unit_symbol: null }
    expect(commonConversions(PCS, [PCS, spelled]).map((c) => c.factor)).toEqual([12])
  })
})
