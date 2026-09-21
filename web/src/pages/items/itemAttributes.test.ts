import { describe, expect, it } from 'vitest'
import { attributesChanged, attributesToDraft, draftToAttributes, emptyAttributes, normaliseTags } from './itemAttributes'

describe('attributesToDraft', () => {
  it('reads the fields this screen owns and sorts the rest into custom rows', () => {
    const draft = attributesToDraft({
      description: 'Smooth writing ballpoint pens.',
      tags: ['Stationery', 'Writing'],
      gsm: 70,
      supplier_code: 'SUP-9',
    })
    expect(draft.description).toBe('Smooth writing ballpoint pens.')
    expect(draft.tags).toEqual(['Stationery', 'Writing'])
    expect(draft.custom).toEqual([
      { key: 'gsm', value: '70' },
      { key: 'supplier_code', value: 'SUP-9' },
    ])
  })

  /** PHP turns `{}` into `[]` on the way back through json_decode($x, true). */
  it('treats an array, a null and a string as nothing recorded', () => {
    expect(attributesToDraft([])).toEqual(emptyAttributes())
    expect(attributesToDraft(null)).toEqual(emptyAttributes())
    expect(attributesToDraft('nope')).toEqual(emptyAttributes())
  })

  it('keeps nested values out of the editor but does not drop them', () => {
    const draft = attributesToDraft({ spec: { voltage: 240 }, history: [1, 2] })
    expect(draft.custom).toEqual([])
    expect(draft.preserved).toEqual({ spec: { voltage: 240 }, history: [1, 2] })
  })

  it('accepts tags written as a comma-separated string', () => {
    expect(normaliseTags(' Office , Writing ,, Office ')).toEqual(['Office', 'Writing'])
  })
})

describe('draftToAttributes', () => {
  it('omits empty fields rather than writing blank strings', () => {
    const draft = { ...emptyAttributes(), description: '  ', notes: 'Keep dry' }
    expect(draftToAttributes(draft)).toEqual({ notes: 'Keep dry' })
  })

  it('writes preserved values back untouched', () => {
    const draft = { ...emptyAttributes(), description: 'A', preserved: { spec: { voltage: 240 } } }
    expect(draftToAttributes(draft)).toEqual({ description: 'A', spec: { voltage: 240 } })
  })

  it('will not let a custom row shadow a field this screen owns', () => {
    const draft = { ...emptyAttributes(), description: 'Real', custom: [{ key: 'description', value: 'Hijack' }] }
    expect(draftToAttributes(draft)).toEqual({ description: 'Real' })
  })

  it('drops custom rows with no key or no value', () => {
    const draft = { ...emptyAttributes(), custom: [{ key: '', value: 'x' }, { key: 'k', value: '  ' }] }
    expect(draftToAttributes(draft)).toEqual({})
  })
})

describe('attributesChanged', () => {
  /**
   * The payload only carries `attributes` when this says true, and the server only rewrites the
   * column when the payload carries it — so a false here is what protects a value written by
   * another app from a user who only came to fix a typo in the item name.
   */
  it('is false for a round trip, whatever the key order', () => {
    const original = { tags: ['A'], description: 'D', gsm: 70 }
    expect(attributesChanged(original, attributesToDraft(original))).toBe(false)
    expect(attributesChanged({ gsm: 70, description: 'D', tags: ['A'] }, attributesToDraft(original))).toBe(false)
  })

  it('is true once a field is edited or cleared', () => {
    const original = { description: 'D' }
    const edited = { ...attributesToDraft(original), description: 'D2' }
    expect(attributesChanged(original, edited)).toBe(true)
    expect(attributesChanged(original, { ...attributesToDraft(original), description: '' })).toBe(true)
  })

  it('is false when an item with no attributes is left alone', () => {
    expect(attributesChanged(null, emptyAttributes())).toBe(false)
  })
})
