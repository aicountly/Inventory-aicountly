import { describe, expect, it } from 'vitest'
import {
  addDays,
  batchState,
  daysUntil,
  expiryBand,
  expiryCaption,
  expiryPresetFromRange,
  expiryPresetRange,
  parseIsoDate,
} from './batchExpiry'

const TODAY = '2026-09-21'

describe('parseIsoDate', () => {
  it('reads a date-only value and an ISO timestamp', () => {
    expect(parseIsoDate('2026-09-21')).toBe(Date.UTC(2026, 8, 21))
    expect(parseIsoDate('2026-09-21T13:45:00')).toBe(Date.UTC(2026, 8, 21))
  })

  it('refuses empty, malformed and impossible dates rather than rolling them over', () => {
    for (const bad of [null, undefined, '', 'not a date', '2026-13-01', '2026-02-31', '0000-00-00']) {
      expect(parseIsoDate(bad)).toBeNull()
    }
  })
})

describe('daysUntil', () => {
  it('counts whole days forward and back', () => {
    expect(daysUntil('2026-09-21', TODAY)).toBe(0)
    expect(daysUntil('2026-09-30', TODAY)).toBe(9)
    expect(daysUntil('2026-09-01', TODAY)).toBe(-20)
  })

  it('crosses a DST boundary without losing a day', () => {
    // Europe/London springs forward on 2027-03-28; UTC arithmetic must not care.
    expect(daysUntil('2027-03-29', '2027-03-27')).toBe(2)
  })

  it('is null when either side is missing', () => {
    expect(daysUntil(null, TODAY)).toBeNull()
    expect(daysUntil('2026-09-30', '')).toBeNull()
  })
})

describe('batchState', () => {
  it('lets a stored status that is not active win', () => {
    expect(batchState({ status: 'quarantine', expiry_date: '2030-01-01' }, TODAY)).toBe('inactive')
    expect(batchState({ status: 'recalled', expiry_date: '2030-01-01' }, TODAY)).toBe('inactive')
    expect(batchState({ status: 'closed', expiry_date: '2030-01-01' }, TODAY)).toBe('inactive')
    expect(batchState({ status: 'expired', expiry_date: '2030-01-01' }, TODAY)).toBe('expired')
  })

  it('grades an active batch by its expiry date', () => {
    expect(batchState({ status: 'active', expiry_date: '2026-09-20' }, TODAY)).toBe('expired')
    expect(batchState({ status: 'active', expiry_date: '2026-09-21' }, TODAY)).toBe('expiring_soon')
    expect(batchState({ status: 'active', expiry_date: '2026-10-21' }, TODAY)).toBe('expiring_soon')
    expect(batchState({ status: 'active', expiry_date: '2026-10-22' }, TODAY)).toBe('active')
  })

  it('treats a batch with no expiry date as active, not as expiring', () => {
    expect(batchState({ status: 'active', expiry_date: null }, TODAY)).toBe('active')
    expect(batchState({ status: 'active', expiry_date: 'garbage' }, TODAY)).toBe('active')
    expect(batchState({}, TODAY)).toBe('active')
  })

  it('honours a narrower window than the default', () => {
    expect(batchState({ status: 'active', expiry_date: '2026-10-10' }, TODAY, 7)).toBe('active')
    expect(batchState({ status: 'active', expiry_date: '2026-09-25' }, TODAY, 7)).toBe('expiring_soon')
  })
})

describe('expiryCaption', () => {
  it('says how long is left in words, never colour alone', () => {
    expect(expiryCaption('2026-09-21', TODAY)).toBe('Expires today')
    expect(expiryCaption('2026-09-22', TODAY)).toBe('Expires tomorrow')
    expect(expiryCaption('2026-09-30', TODAY)).toBe('In 9 days')
    expect(expiryCaption('2026-09-20', TODAY)).toBe('Expired yesterday')
    expect(expiryCaption('2026-09-01', TODAY)).toBe('Expired 20 days ago')
    expect(expiryCaption('2027-03-21', TODAY)).toBe('In ~6 months')
    expect(expiryCaption('2030-09-21', TODAY)).toBe('In ~4 years')
    expect(expiryCaption(null, TODAY)).toBeNull()
  })
})

describe('expiryBand', () => {
  it('buckets a date the way the summary timeline does', () => {
    expect(expiryBand('2026-09-20', TODAY)).toBe('expired')
    expect(expiryBand('2026-10-21', TODAY)).toBe('within_30')
    expect(expiryBand('2026-12-20', TODAY)).toBe('days_31_90')
    expect(expiryBand('2027-03-20', TODAY)).toBe('days_91_180')
    expect(expiryBand('2028-01-01', TODAY)).toBe('beyond_180')
    expect(expiryBand(null, TODAY)).toBe('no_expiry')
  })
})

describe('expiry presets', () => {
  it('turns a preset into the range the API is sent', () => {
    expect(expiryPresetRange('expired', TODAY)).toEqual({ expiry_from: '', expiry_to: '2026-09-20', has_expiry: '' })
    expect(expiryPresetRange('d30', TODAY)).toEqual({ expiry_from: TODAY, expiry_to: '2026-10-21', has_expiry: '' })
    expect(expiryPresetRange('none', TODAY)).toEqual({ expiry_from: '', expiry_to: '', has_expiry: '0' })
    expect(expiryPresetRange('', TODAY)).toEqual({ expiry_from: '', expiry_to: '', has_expiry: '' })
  })

  it('recognises its own ranges when a shared URL is reopened', () => {
    for (const preset of ['expired', 'd7', 'd30', 'd60', 'd90', 'none'] as const) {
      expect(expiryPresetFromRange(expiryPresetRange(preset, TODAY), TODAY)).toBe(preset)
    }
    expect(expiryPresetFromRange({}, TODAY)).toBe('')
    expect(expiryPresetFromRange({ expiry_from: '2026-01-01', expiry_to: '2026-02-01' }, TODAY)).toBe('custom')
  })

  it('shifts dates in UTC so no timezone can move them', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('', 1)).toBe('')
  })
})
