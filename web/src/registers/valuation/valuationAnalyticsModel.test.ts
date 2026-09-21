import { describe, expect, it } from 'vitest'
import {
  MAX_TREND_POINTS,
  composition,
  monthEnd,
  monthLabel,
  negativesNote,
  trendDates,
  trendDelta,
  warehouseComposition,
} from './valuationAnalyticsModel'
import type { TrendPoint, ValuedRow } from './valuationAnalyticsModel'

/** The financial year the sample dates sit in: 1 Apr 2026 – 31 Mar 2027. */
const FY = { from: '2026-04-01', to: '2027-03-31' }
const ASOF = '2026-09-16'

describe('monthEnd', () => {
  it('knows the length of every month', () => {
    expect(monthEnd(2026, 1)).toBe('2026-01-31')
    expect(monthEnd(2026, 4)).toBe('2026-04-30')
    expect(monthEnd(2026, 9)).toBe('2026-09-30')
    expect(monthEnd(2026, 12)).toBe('2026-12-31')
  })

  it('handles February in common, leap and century years', () => {
    expect(monthEnd(2026, 2)).toBe('2026-02-28')
    expect(monthEnd(2028, 2)).toBe('2028-02-29')
    expect(monthEnd(1900, 2)).toBe('1900-02-28')
    expect(monthEnd(2000, 2)).toBe('2000-02-29')
  })
})

describe('monthLabel', () => {
  it('shortens a date to month and two-digit year', () => {
    expect(monthLabel('2026-09-16')).toBe('Sep 26')
    expect(monthLabel('2027-01-31')).toBe('Jan 27')
    expect(monthLabel('2026-04-30')).toBe('Apr 26')
  })

  it('pads a year below ten rather than dropping its zero', () => {
    expect(monthLabel('2005-06-30')).toBe('Jun 05')
  })

  it('hands back anything it cannot parse instead of guessing', () => {
    expect(monthLabel('not-a-date')).toBe('not-a-date')
  })
})

describe('trendDates', () => {
  it('ends on the as-at date so the line agrees with the total above it', () => {
    const dates = trendDates(ASOF, '6', FY)
    expect(dates[dates.length - 1]).toBe(ASOF)
  })

  it('walks back in month ends', () => {
    expect(trendDates(ASOF, '6', FY)).toEqual([
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-16',
    ])
  })

  it('drops the months that fall before the financial year opened', () => {
    // Twelve months back from September 2026 reaches October 2025, but the
    // snapshot endpoint is FY-scoped and cannot answer for those dates.
    const dates = trendDates(ASOF, '12', FY)
    expect(dates.every((d) => d >= FY.from)).toBe(true)
    expect(dates).toHaveLength(6)
  })

  it('never returns a date after the one being asked about', () => {
    const dates = trendDates(ASOF, '12', FY)
    expect(dates.every((d) => d <= ASOF)).toBe(true)
  })

  it('runs the financial year from its opening month', () => {
    const dates = trendDates(ASOF, 'fy', FY)
    expect(dates[0]).toBe('2026-04-30')
    expect(dates[dates.length - 1]).toBe(ASOF)
  })

  it('never asks for more points than the ceiling allows', () => {
    const wide = { from: '2020-04-01', to: '2027-03-31' }
    expect(trendDates(ASOF, 'fy', wide).length).toBeLessThanOrEqual(MAX_TREND_POINTS)
    expect(trendDates(ASOF, '12', wide).length).toBeLessThanOrEqual(MAX_TREND_POINTS)
  })

  it('collapses the duplicate when the as-at date is itself a month end', () => {
    const dates = trendDates('2026-09-30', '3', FY)
    expect(dates).toEqual(['2026-07-31', '2026-08-31', '2026-09-30'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('returns nothing for a date it cannot parse', () => {
    expect(trendDates('16/09/2026', '6', FY)).toEqual([])
  })

  it('gives a single point when the as-at date is the first day of the year', () => {
    expect(trendDates('2026-04-01', '6', FY)).toEqual(['2026-04-01'])
  })
})

describe('trendDelta', () => {
  const point = (date: string, value: number): TrendPoint => ({
    date,
    label: date,
    value,
    qty: 0,
  })

  it('compares the last two measured points', () => {
    const delta = trendDelta([point('a', 100), point('b', 120), point('c', 150)])
    expect(delta?.current.value).toBe(150)
    expect(delta?.previous.value).toBe(120)
  })

  it('has nothing to say about a single point', () => {
    expect(trendDelta([point('a', 100)])).toBeNull()
    expect(trendDelta([])).toBeNull()
  })
})

describe('composition', () => {
  const rows: ValuedRow[] = [
    { key: '1', label: 'Test Item', value: 65.58, qty: 523 },
    { key: '2', label: 'Dimmy', value: 10.43, qty: 442 },
  ]

  it('takes every share of the server total, not of the rows it was given', () => {
    // The whole set is worth 200; these two rows are only part of it, so their
    // shares must be of 200 and the rest must show as a remainder.
    const view = composition(rows, 200)
    const byKey = Object.fromEntries(view.slices.map((s) => [s.key, s]))
    expect(byKey['1'].share).toBeCloseTo(32.79, 2)
    expect(byKey.__others__.value).toBeCloseTo(123.99, 2)
  })

  it('adds no remainder row when the named rows are the whole set', () => {
    const view = composition(rows, 76.01)
    expect(view.slices.map((s) => s.key)).toEqual(['1', '2'])
  })

  it('ignores a remainder of less than a rupee left by rounding', () => {
    const view = composition(rows, 76.62)
    expect(view.slices.some((s) => s.key === '__others__')).toBe(false)
  })

  it('orders the slices largest first', () => {
    const view = composition([rows[1], rows[0]], 76.01)
    expect(view.slices.map((s) => s.label)).toEqual(['Test Item', 'Dimmy'])
  })

  it('caps the named slices and leaves the rest to the remainder', () => {
    const many: ValuedRow[] = Array.from({ length: 9 }, (_, i) => ({
      key: String(i),
      label: `Item ${i}`,
      value: 100 - i,
    }))
    const view = composition(many, 1000, { maxSlices: 3 })
    expect(view.slices).toHaveLength(4)
    expect(view.slices[3].key).toBe('__others__')
  })

  it('keeps negative rows out of the split and counts them', () => {
    const view = composition(
      [...rows, { key: '3', label: 'Written down', value: -12 }],
      76.01,
    )
    expect(view.slices.some((s) => s.key === '3')).toBe(false)
    expect(view.negatives).toBe(1)
  })

  it('refuses to draw a composition of a total that is not positive', () => {
    expect(composition(rows, 0).invalid).toBe(true)
    expect(composition(rows, -50).invalid).toBe(true)
    expect(composition([], 100).invalid).toBe(true)
  })
})

describe('negativesNote', () => {
  it('says nothing when nothing was left out', () => {
    expect(negativesNote(composition([{ key: '1', label: 'A', value: 10 }], 10))).toBeNull()
  })

  it('names what was left out, and agrees with itself on number', () => {
    const one = composition([{ key: '1', label: 'A', value: 10 }, { key: '2', label: 'B', value: -1 }], 10)
    expect(negativesNote(one)).toContain('1 item')
    expect(negativesNote(one)).toContain(' is ')

    const two = composition(
      [
        { key: '1', label: 'A', value: 10 },
        { key: '2', label: 'B', value: -1 },
        { key: '3', label: 'C', value: -2 },
      ],
      10,
    )
    expect(two.negatives).toBe(2)
    expect(negativesNote(two)).toContain('2 items')
    expect(negativesNote(two)).toContain(' are ')
  })
})

describe('warehouseComposition', () => {
  const warehouses = [
    { warehouseId: 1, name: 'Main store', value: 60, qty: 600 },
    { warehouseId: 2, name: 'Overflow', value: 16.01, qty: 365 },
  ]
  const total = { value: 76.01, qty: 965 }

  it('splits by value', () => {
    const view = warehouseComposition(warehouses, total, 'value')
    expect(view.slices.map((s) => s.label)).toEqual(['Main store', 'Overflow'])
    expect(view.slices[0].share).toBeCloseTo(78.94, 1)
  })

  it('splits by quantity against the quantity total', () => {
    const view = warehouseComposition(warehouses, total, 'qty')
    expect(view.total).toBe(965)
    expect(view.slices[0].value).toBe(600)
  })

  it('names the stock the warehouses do not account for', () => {
    // The company holds 100 but only 76.01 of it is against a warehouse; the
    // difference is real stock and must not vanish from the chart.
    const view = warehouseComposition(warehouses, { value: 100, qty: 965 }, 'value')
    const remainder = view.slices.find((s) => s.key === '__others__')
    expect(remainder?.label).toBe('Unassigned to a warehouse')
    expect(remainder?.value).toBeCloseTo(23.99, 2)
  })

  it('draws one bar for a single warehouse holding everything', () => {
    const view = warehouseComposition(
      [{ warehouseId: 1, name: 'Main store', value: 76.02, qty: 965 }],
      { value: 76.02, qty: 965 },
      'value',
    )
    expect(view.slices).toHaveLength(1)
    expect(view.slices[0].share).toBe(100)
  })
})
