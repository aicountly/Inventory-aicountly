import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatInt,
  formatMoney,
  formatQty,
  humanize,
  isOn,
  toNumber,
} from './format'

describe('number formatting', () => {
  it('parses loosely and formats quantities without trailing zeros', () => {
    expect(toNumber('12.5000')).toBe(12.5)
    expect(toNumber('')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(formatQty('12.5000')).toBe('12.5')
    expect(formatQty(0.0001)).toBe('0.0001')
    expect(formatQty(null)).toBe('—')
    expect(formatQty(null, '0')).toBe('0')
  })

  it('formats money with two decimals and Indian grouping', () => {
    expect(formatMoney(1234567.891)).toBe('12,34,567.89')
    expect(formatMoney('5')).toBe('5.00')
    expect(formatInt(1234567)).toBe('12,34,567')
  })
})

describe('compact money', () => {
  it('shortens rupees on the Indian scale', () => {
    expect(formatCompactMoney(24800000, 'INR')).toBe('₹ 2.48 Cr')
    expect(formatCompactMoney(30000000, 'INR')).toBe('₹ 3 Cr')
    expect(formatCompactMoney(1250000, 'INR')).toBe('₹ 12.5 L')
    expect(formatCompactMoney(100000, 'INR')).toBe('₹ 1 L')
  })

  it('prints a figure below the first step in full rather than rounding it away', () => {
    expect(formatCompactMoney(84300, 'INR')).toBe('₹ 84,300')
    expect(formatCompactMoney(0, 'INR')).toBe('₹ 0')
  })

  it('keeps the minus in front of the symbol', () => {
    expect(formatCompactMoney(-24800000, 'INR')).toBe('-₹ 2.48 Cr')
  })

  it('uses the western scale for a company whose base currency is not the rupee', () => {
    // A lakh is a property of the rupee here, not of the reader's locale.
    expect(formatCompactMoney(24800000, 'USD')).toBe('$ 24.8M')
    expect(formatCompactMoney(2480, 'USD')).toBe('$ 2.48K')
  })

  it('falls back to the code for a currency Intl does not know, instead of throwing', () => {
    expect(currencySymbol('ZZZ')).toBe('ZZZ')
    expect(formatCompactMoney(24800000, 'ZZZ')).toBe('ZZZ 24.8M')
  })

  it('has an empty marker, like every other formatter here', () => {
    expect(formatCompactMoney(null, 'INR')).toBe('—')
    expect(formatCompactMoney('', 'INR', 'n/a')).toBe('n/a')
  })
})

describe('date formatting', () => {
  it('formats ISO dates and timestamps without timezone drift', () => {
    expect(formatDate('2025-04-01')).toBe('01 Apr 2025')
    expect(formatDate('2025-04-01 09:30:00')).toBe('01 Apr 2025')
    expect(formatDateTime('2025-04-01 09:30:00')).toBe('01 Apr 2025, 09:30')
    expect(formatDateTime('2025-04-01')).toBe('01 Apr 2025')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('nope')).toBe('—')
  })
})

describe('text helpers', () => {
  it('humanizes snake case and reads flags', () => {
    expect(humanize('physical_adjustment')).toBe('Physical adjustment')
    expect(humanize('PENDING_APPROVAL')).toBe('Pending approval')
    expect(humanize('')).toBe('')
    expect(isOn('1')).toBe(true)
    expect(isOn(0)).toBe(false)
    expect(isOn('yes')).toBe(true)
  })
})
