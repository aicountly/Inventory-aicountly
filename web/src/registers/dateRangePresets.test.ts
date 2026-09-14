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
  endOfWeek,
  getDateRangeForPreset,
  isIsoDate,
  matchDateRangePreset,
  startOfMonth,
  startOfWeek,
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

  it('finds Monday-start week bounds, as Books does', () => {
    // 2026-09-14 is a Monday, 2026-09-13 the Sunday before it.
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14')
    expect(endOfWeek('2026-09-14')).toBe('2026-09-20')
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
    expect(endOfWeek('2026-09-13')).toBe('2026-09-13')
  })
})

describe('getDateRangeForPreset', () => {
  it('resolves the quick ranges', () => {
    expect(getDateRangeForPreset('today', CTX)).toEqual({ from: '2026-09-14', to: '2026-09-14' })
    expect(getDateRangeForPreset('yesterday', CTX)).toEqual({ from: '2026-09-13', to: '2026-09-13' })
    expect(getDateRangeForPreset('last_7', CTX)).toEqual({ from: '2026-09-08', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_30', CTX)).toEqual({ from: '2026-08-16', to: '2026-09-14' })
  })

  it('resolves the week ranges', () => {
    expect(getDateRangeForPreset('this_week', CTX)).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    expect(getDateRangeForPreset('this_week_to_date', CTX)).toEqual({ from: '2026-09-14', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_week', CTX)).toEqual({ from: '2026-09-07', to: '2026-09-13' })
  })

  it('resolves month, quarter and half-year ranges', () => {
    expect(getDateRangeForPreset('this_month', CTX)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('this_month_to_date', CTX)).toEqual({ from: '2026-09-01', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_month', CTX)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(getDateRangeForPreset('this_quarter', CTX)).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('this_quarter_to_date', CTX)).toEqual({ from: '2026-07-01', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_quarter', CTX)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(getDateRangeForPreset('this_half_year', CTX)).toEqual({ from: '2026-04-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('this_half_year_to_date', CTX)).toEqual({ from: '2026-04-01', to: '2026-09-14' })
    expect(getDateRangeForPreset('last_half_year', CTX)).toEqual({ from: '2025-10-01', to: '2026-03-31' })
  })

  it('anchors quarters and halves to the financial year, not to January', () => {
    // A July-June financial year: Q1 is Jul-Sep, so mid-November is Q2.
    const july = { today: '2026-11-15', fyFrom: '2026-07-01', fyTo: '2027-06-30' }
    expect(getDateRangeForPreset('this_quarter', july)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(getDateRangeForPreset('last_quarter', july)).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(getDateRangeForPreset('this_half_year', july)).toEqual({ from: '2026-07-01', to: '2026-12-31' })
    // The same date under an April-March year lands in a different quarter.
    expect(getDateRangeForPreset('this_quarter', { ...CTX, today: '2026-11-15' })).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    })
    const may = { today: '2026-11-15', fyFrom: '2026-05-01', fyTo: '2027-04-30' }
    expect(getDateRangeForPreset('this_quarter', may)).toEqual({ from: '2026-11-01', to: '2027-01-31' })
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

  it('offers Last FY off the year Manage gave us', () => {
    expect(getDateRangeForPreset('last_fy', CTX)).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(getDateRangeForPreset('last_fy', { today: '2026-11-15', fyFrom: '2026-07-01', fyTo: '2027-06-30' })).toEqual({
      from: '2025-07-01',
      to: '2026-06-30',
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
      // Two presets can resolve to the same dates — on a Monday "This
      // Week-to-date" is "Today" — so the contract is that the name offered
      // back describes the same period, not that it is the same name.
      const matched = matchDateRangePreset(range.from, range.to, CTX)
      expect(matched, `${preset.id} came back as Custom`).not.toBe(CUSTOM_PRESET_ID)
      expect(getDateRangeForPreset(matched, CTX), preset.id).toEqual(range)
    }
  })

  it('names every preset the way Books names it', () => {
    const labels = Object.fromEntries(DATE_RANGE_PRESETS.map((p) => [p.id, p.label]))
    expect(labels.this_quarter).toBe('This Quarter (FY)')
    expect(labels.last_quarter).toBe('Last Quarter (FY)')
    expect(labels.this_half_year).toBe('This Half Year (FY)')
    expect(labels.last_fy).toBe('Last FY')
    expect(labels.fy_to_date).toBe('This FY-to-date')
    // Sentence case was the tell that the two products had diverged.
    for (const preset of DATE_RANGE_PRESETS) {
      if (preset.id === CUSTOM_PRESET_ID) continue
      for (const word of preset.label.replace(/\(FY\)/g, '').split(/[\s-]+/).filter(Boolean)) {
        if (['days', 'to', 'date'].includes(word.toLowerCase())) continue
        expect(word[0], `${preset.label} is not Title Case`).toBe(word[0].toUpperCase())
      }
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
