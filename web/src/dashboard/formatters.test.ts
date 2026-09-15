import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatCurrencyCompact,
  formatQtyCompact,
  formatRatio,
  greetingFor,
  percentOf,
  plural,
  relativeTimeFromNow,
} from './formatters'

describe('formatCurrencyCompact', () => {
  it('uses the Indian crore / lakh / thousand scale', () => {
    expect(formatCurrencyCompact(1_24_00_000)).toBe('₹1.24 Cr')
    expect(formatCurrencyCompact(3_40_000)).toBe('₹3.40 L')
    expect(formatCurrencyCompact(8_200)).toBe('₹8.2 K')
  })

  it('keeps small amounts as plain currency', () => {
    expect(formatCurrencyCompact(940)).toContain('940')
    expect(formatCurrencyCompact(0)).toContain('0')
  })

  it('carries the sign on negative stock value', () => {
    expect(formatCurrencyCompact(-3_40_000)).toBe('-₹3.40 L')
    expect(formatCurrencyCompact(-1_24_00_000)).toBe('-₹1.24 Cr')
  })

  it('accepts the numeric strings the API sends and rejects junk', () => {
    expect(formatCurrencyCompact('340000')).toBe('₹3.40 L')
    expect(formatCurrencyCompact(null)).toBe('—')
    expect(formatCurrencyCompact('')).toBe('—')
    expect(formatCurrencyCompact('not a number')).toBe('—')
  })

  it('switches scale exactly at the boundary, not near it', () => {
    expect(formatCurrencyCompact(99_999)).toBe('₹100.0 K')
    expect(formatCurrencyCompact(1_00_000)).toBe('₹1.00 L')
    expect(formatCurrencyCompact(99_99_999)).toBe('₹100.00 L')
    expect(formatCurrencyCompact(1_00_00_000)).toBe('₹1.00 Cr')
  })
})

describe('formatQtyCompact', () => {
  it('scales like currency but without a symbol', () => {
    expect(formatQtyCompact(1_24_00_000)).toBe('1.24 Cr')
    expect(formatQtyCompact(8_200)).toBe('8.2 K')
  })

  it('keeps small quantities readable, including fractions', () => {
    expect(formatQtyCompact(12.5)).toBe('12.5')
    expect(formatQtyCompact(0)).toBe('0')
    expect(formatQtyCompact(-4)).toBe('-4')
  })
})

describe('formatCount / formatRatio', () => {
  it('groups counts the Indian way', () => {
    expect(formatCount(1234567)).toBe('12,34,567')
    expect(formatCount(null)).toBe('0')
  })

  it('shows ratios to two decimals', () => {
    expect(formatRatio(3)).toBe('3.00')
    expect(formatRatio(null)).toBe('—')
  })
})

describe('greetingFor', () => {
  it('follows the local hour', () => {
    const at = (h: number) => new Date(2026, 0, 15, h, 0, 0)
    expect(greetingFor(at(6))).toBe('Good morning')
    expect(greetingFor(at(11))).toBe('Good morning')
    expect(greetingFor(at(12))).toBe('Good afternoon')
    expect(greetingFor(at(16))).toBe('Good afternoon')
    expect(greetingFor(at(17))).toBe('Good evening')
    expect(greetingFor(at(23))).toBe('Good evening')
  })
})

describe('relativeTimeFromNow', () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0)

  it('counts backwards in the largest sensible unit', () => {
    expect(relativeTimeFromNow(now - 3_000, now)).toBe('just now')
    expect(relativeTimeFromNow(now - 42_000, now)).toBe('42s ago')
    expect(relativeTimeFromNow(now - 4 * 60_000, now)).toBe('4m ago')
    expect(relativeTimeFromNow(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTimeFromNow(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  it('never renders a negative age from a clock skew', () => {
    expect(relativeTimeFromNow(now + 60_000, now)).toBe('just now')
  })

  it('is honest about missing or unparseable timestamps', () => {
    expect(relativeTimeFromNow(null, now)).toBe('—')
    expect(relativeTimeFromNow(undefined, now)).toBe('—')
    expect(relativeTimeFromNow('nonsense', now)).toBe('—')
  })
})

describe('percentOf', () => {
  it('is a share of the total, clamped to 0-100', () => {
    expect(percentOf(25, 100)).toBe(25)
    expect(percentOf(150, 100)).toBe(100)
    expect(percentOf(-5, 100)).toBe(0)
  })

  it('returns 0 rather than Infinity or NaN when there is no total', () => {
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(5, null)).toBe(0)
    expect(percentOf(null, null)).toBe(0)
  })
})

describe('plural', () => {
  it('agrees with the count', () => {
    expect(plural(1, 'batch', 'batches')).toBe('1 batch')
    expect(plural(4, 'batch', 'batches')).toBe('4 batches')
    expect(plural(0, 'item')).toBe('0 items')
  })
})
