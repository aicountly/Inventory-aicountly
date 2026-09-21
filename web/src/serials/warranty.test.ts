import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WARRANTY_THRESHOLDS,
  daysUntil,
  warrantyPhrase,
  warrantyState,
  warrantyTone,
} from './warranty'

const TODAY = '2026-09-18'

describe('daysUntil', () => {
  it('counts whole days forward', () => {
    expect(daysUntil('2026-09-18', TODAY)).toBe(0)
    expect(daysUntil('2026-09-19', TODAY)).toBe(1)
    expect(daysUntil('2026-10-18', TODAY)).toBe(30)
  })

  it('goes negative once the warranty has run out', () => {
    expect(daysUntil('2026-09-17', TODAY)).toBe(-1)
  })

  it('is null for a serial with no warranty on it', () => {
    expect(daysUntil(null, TODAY)).toBeNull()
    expect(daysUntil('', TODAY)).toBeNull()
    expect(daysUntil('not a date', TODAY)).toBeNull()
  })

  it('reads a timestamp as its date', () => {
    expect(daysUntil('2026-09-20 13:45:00', TODAY)).toBe(2)
  })

  // A date subtracted in local time is a day out for half of every day in
  // India, which is one working day of difference on a warranty report.
  it('does not drift with a daylight-saving boundary between the two dates', () => {
    expect(daysUntil('2027-04-18', '2026-10-18')).toBe(182)
  })
})

describe('warrantyState', () => {
  it('names the five states around the thresholds', () => {
    expect(warrantyState('2026-09-17', TODAY)).toBe('expired')
    expect(warrantyState('2026-09-18', TODAY)).toBe('urgent')
    expect(warrantyState('2026-10-18', TODAY)).toBe('urgent')
    expect(warrantyState('2026-10-19', TODAY)).toBe('upcoming')
    expect(warrantyState('2026-12-17', TODAY)).toBe('upcoming')
    expect(warrantyState('2026-12-18', TODAY)).toBe('active')
    expect(warrantyState(null, TODAY)).toBe('none')
  })

  it('uses the window the server sent rather than its own', () => {
    const wide = { soonDays: 120, upcomingDays: 365 }
    expect(warrantyState('2026-12-18', TODAY, wide)).toBe('urgent')
    expect(warrantyState('2026-12-18', TODAY, DEFAULT_WARRANTY_THRESHOLDS)).toBe('active')
  })
})

describe('warrantyPhrase', () => {
  it('counts in days while the answer is a task', () => {
    expect(warrantyPhrase('2026-09-18', TODAY)).toBe('Expires today')
    expect(warrantyPhrase('2026-09-19', TODAY)).toBe('Expires tomorrow')
    expect(warrantyPhrase('2026-10-09', TODAY)).toBe('Expires in 21 days')
  })

  it('counts in months and years once it is a fact', () => {
    expect(warrantyPhrase('2027-08-20', TODAY)).toBe('11 months left')
    expect(warrantyPhrase('2029-04-15', TODAY)).toBe('2.6 years left')
  })

  it('says only that it has expired, not by how much', () => {
    expect(warrantyPhrase('2020-01-01', TODAY)).toBe('Expired')
  })

  it('says nothing at all when no warranty was recorded', () => {
    expect(warrantyPhrase(null, TODAY)).toBeNull()
  })
})

describe('warrantyTone', () => {
  it('keeps "no warranty" quiet — it is not a problem, it is an absence', () => {
    expect(warrantyTone('none')).toBe('neutral')
    expect(warrantyTone('active')).toBe('success')
    expect(warrantyTone('upcoming')).toBe('warning')
    expect(warrantyTone('urgent')).toBe('danger')
    expect(warrantyTone('expired')).toBe('danger')
  })
})
