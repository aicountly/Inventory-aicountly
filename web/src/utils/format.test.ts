import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatInt, formatMoney, formatQty, humanize, isOn, toNumber } from './format'

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
