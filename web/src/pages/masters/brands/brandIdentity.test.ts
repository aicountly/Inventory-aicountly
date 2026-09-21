import { describe, expect, it } from 'vitest'
import { BRAND_AVATAR_TONES, brandAvatarTone, brandHealth, brandInitials } from './brandIdentity'

describe('brandInitials', () => {
  it('takes two letters from a two-word name', () => {
    expect(brandInitials('Tata Motors')).toBe('TM')
    expect(brandInitials('LG Electronics India')).toBe('LE')
  })

  it('takes two letters from a single word, so S-brands are distinguishable', () => {
    expect(brandInitials('Samsung')).toBe('SA')
    expect(brandInitials('Sony')).toBe('SO')
  })

  it('keeps digits, so a numeric brand is not an anonymous blank', () => {
    expect(brandInitials('3M')).toBe('3M')
  })

  it('ignores punctuation and stray whitespace', () => {
    expect(brandInitials('  Procter & Gamble ')).toBe('PG')
    // An apostrophe separates words like any other punctuation, so L’Oréal is
    // L + O. That is the reading a person would give it out loud.
    expect(brandInitials('L’Oréal Paris')).toBe('LO')
    expect(brandInitials('Coca-Cola')).toBe('CC')
  })

  it('never renders empty', () => {
    expect(brandInitials('')).toBe('?')
    expect(brandInitials('   ')).toBe('?')
    expect(brandInitials('—')).toBe('?')
  })
})

describe('brandAvatarTone', () => {
  it('is stable for a name, so a brand keeps one colour everywhere', () => {
    expect(brandAvatarTone('Apple')).toBe(brandAvatarTone('Apple'))
  })

  it('always returns a tone the component can paint', () => {
    for (const name of ['Apple', 'Canon', 'Dell', 'HP', '3M', '', 'ZZZZZZZZZZZZZZ']) {
      expect(BRAND_AVATAR_TONES).toContain(brandAvatarTone(name))
    }
  })

  it('spreads short names across more than one tone', () => {
    const tones = new Set(['HP', 'LG', '3M', 'GE', 'BP'].map(brandAvatarTone))
    expect(tones.size).toBeGreaterThan(1)
  })
})

describe('brandHealth', () => {
  it('reports what is true, in the order that matters', () => {
    expect(brandHealth({ is_active: 0, item_count: 12 })).toBe('inactive')
    expect(brandHealth({ is_active: 1, item_count: 0 })).toBe('unused')
    expect(brandHealth({ is_active: 1, item_count: 12 })).toBe('active')
  })

  it('treats an uncounted brand as unused rather than inventing a count', () => {
    expect(brandHealth({ is_active: 1 })).toBe('unused')
  })
})
