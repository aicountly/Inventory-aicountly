import { describe, expect, it } from 'vitest'
import {
  ALL_DATES_PRESET_ID,
  CUSTOM_PRESET_ID,
  DATE_RANGE_PRESETS,
  DEFAULT_DATE_PRESET_ID,
  addDays,
  daysBetween,
  describeDateRange,
  endOfMonth,
  endOfQuarter,
  getDateRangeForPreset,
  isIsoDate,
  matchDateRangePreset,
  startOfMonth,
  startOfQuarter,
} from './dateRangePresets'

const CTX = { today: '2026-09-14', fyFrom: '2026-04-01', fyTo: '2027-03-31' }

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-09-14')).toBe(true)
    expect(isIsoDate('2026-9-14')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-14', 1)).toBe('2026-09-15')
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('nope', 1)).toBe('')
  })

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-01', '2026-09-14')).toBe(13)
    expect(daysBetween('2026-09-14', '2026-09-01')).toBe(-13)
    expect(daysBetween('x', '2026-09-01')).toBeNull()
  })

  it('finds month bounds including February in a leap year', () => {
    expect(startOfMonth('2026-09-14')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-14')).toBe('2026-09-30')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
  })

  it('finds calendar quarter bounds', () => {
    expect(startOfQuarter('2026-09-14')).toBe('2026-07-01')
    expect(endOfQuarter('2026-09-14')).toBe('2026-09-30')
    expect(startOfQuarter('2026-01-05')).toBe('2026-01-01')
    expect(endOfQuarter('2026-12-31')).toBe('2026-12-31')
  })
})

describe('getDateRangeForPreset', () => {
  it('resolves the quick ranges', () => {
    expect(getDateRangeForPreset('today', CTX)).toEqual({ from: '2026-09-14', to: '2026-09-14' })
    expect(getDateRangeForPreset('yesterday', CTX)).toEqual({ from: '2026-09-13', to: '2026-09-13' })
    expect(getDateRangeForPreset('last_7', CTX)).toEqual({ from: '2026-09-08', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_30', CTX)).toEqual({ from: '2026-08-16', to: '2026-09-14' })
  })

  it('resolves month and quarter ranges', () => {
    expect(getDateRangeForPreset('this_month', CTX)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('last_month', CTX)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(getDateRangeForPreset('this_quarter', CTX)).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('last_quarter', CTX)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
  })

  it('rolls last month back across a year boundary', () => {
    const ctx = { ...CTX, today: '2026-01-15' }
    expect(getDateRangeForPreset('last_month', ctx)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(getDateRangeForPreset('last_quarter', ctx)).toEqual({ from: '2025-10-01', to: '2025-12-31' })
  })

  it('uses the financial year for This FY and never runs past today for FY to date', () => {
    expect(getDateRangeForPreset(DEFAULT_DATE_PRESET_ID, CTX)).toEqual({ from: '2026-04-01', to: '2027-03-31' })
    expect(getDateRangeForPreset('fy_to_date', CTX)).toEqual({ from: '2026-04-01', to: '2026-09-14' })
    // Once the year is over, FY-to-date is the whole year, not a future date.
    expect(getDateRangeForPreset('fy_to_date', { ...CTX, today: '2027-06-01' })).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
    })
  })

  it('returns empty bounds for All dates and null for Custom', () => {
    expect(getDateRangeForPreset(ALL_DATES_PRESET_ID, CTX)).toEqual({ from: '', to: '' })
    expect(getDateRangeForPreset(CUSTOM_PRESET_ID, CTX)).toBeNull()
    expect(getDateRangeForPreset('nonsense', CTX)).toBeNull()
  })

  it('degrades to empty strings when the FY is not known yet', () => {
    expect(getDateRangeForPreset(DEFAULT_DATE_PRESET_ID, { today: '2026-09-14', fyFrom: '', fyTo: '' })).toEqual({
      from: '',
      to: '',
    })
  })
})

describe('matchDateRangePreset', () => {
  it('round-trips every resolvable preset', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      const range = getDateRangeForPreset(preset.id, CTX)
      if (!range || (!range.from && !range.to)) continue
      expect(matchDateRangePreset(range.from, range.to, CTX), preset.id).toBe(preset.id)
    }
  })

  it('reports All dates for an empty range and Custom for anything unmatched', () => {
    expect(matchDateRangePreset('', '', CTX)).toBe(ALL_DATES_PRESET_ID)
    expect(matchDateRangePreset('2026-05-02', '2026-05-09', CTX)).toBe(CUSTOM_PRESET_ID)
    expect(matchDateRangePreset('2026-04-01', '', CTX)).toBe(CUSTOM_PRESET_ID)
  })

  it('prefers This FY over FY to date when both would match', () => {
    // On the last day of the FY the two ranges coincide; the declaration order
    // puts This FY first, and that is the name the reader recognises.
    const ctx = { ...CTX, today: '2027-03-31' }
    expect(matchDateRangePreset('2026-04-01', '2027-03-31', ctx)).toBe(DEFAULT_DATE_PRESET_ID)
  })
})

describe('describeDateRange', () => {
  it('describes open, closed and single-day ranges', () => {
    expect(describeDateRange('', '')).toBe('All dates')
    expect(describeDateRange('2026-04-01', '')).toBe('From 2026-04-01')
    expect(describeDateRange('', '2026-04-01')).toBe('Up to 2026-04-01')
    expect(describeDateRange('2026-04-01', '2026-04-01')).toBe('2026-04-01')
    expect(describeDateRange('2026-04-01', '2027-03-31')).toBe('2026-04-01 to 2027-03-31')
  })
})
