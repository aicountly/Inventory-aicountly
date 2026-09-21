import { describe, expect, it } from 'vitest'
import { deltaPercent, monthWindow, previousMonthWindow } from './insightWindows'

describe('monthWindow', () => {
  it('spans the whole calendar month the date falls in', () => {
    expect(monthWindow('2026-09-18')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthWindow('2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(monthWindow('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('knows February in a leap year and out of one', () => {
    expect(monthWindow('2024-02-10')?.to).toBe('2024-02-29')
    expect(monthWindow('2026-02-10')?.to).toBe('2026-02-28')
    // A century that is not a leap year, which the naive %4 rule gets wrong.
    expect(monthWindow('2100-02-10')?.to).toBe('2100-02-28')
  })

  it('refuses anything that is not an ISO date', () => {
    expect(monthWindow('')).toBeNull()
    expect(monthWindow('18-09-2026')).toBeNull()
    expect(monthWindow('2026-13-01')).toBeNull()
  })
})

describe('previousMonthWindow', () => {
  it('steps back one month', () => {
    expect(previousMonthWindow('2026-09-18')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('crosses the year boundary', () => {
    expect(previousMonthWindow('2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('lands on the right February', () => {
    expect(previousMonthWindow('2024-03-01')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
})

describe('deltaPercent', () => {
  it('reports the change as whole points', () => {
    expect(deltaPercent(112, 100)).toBe(12)
    expect(deltaPercent(92, 100)).toBe(-8)
    expect(deltaPercent(100, 100)).toBe(0)
  })

  it('has no answer when the baseline was zero', () => {
    // "+100%" from nothing is not a fact about the business, and "+∞%" beside a
    // KPI is worse than no chip at all.
    expect(deltaPercent(250, 0)).toBeNull()
    expect(deltaPercent(0, 0)).toBeNull()
  })

  it('ignores values that are not finite numbers', () => {
    expect(deltaPercent(Number.NaN, 10)).toBeNull()
    expect(deltaPercent(10, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
