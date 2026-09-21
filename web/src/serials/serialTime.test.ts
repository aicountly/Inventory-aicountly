import { describe, expect, it } from 'vitest'
import { relativeUpdated, serverTimeMs } from './serialTime'

describe('serverTimeMs', () => {
  it('reads the space-separated form the API writes', () => {
    expect(serverTimeMs('2026-09-18 08:30:00')).toBe(new Date('2026-09-18T08:30:00').getTime())
  })

  it('reads the ISO form too', () => {
    expect(serverTimeMs('2026-09-18T08:30:00')).toBe(new Date('2026-09-18T08:30:00').getTime())
  })

  it('is null for a missing or unparseable value', () => {
    expect(serverTimeMs(null)).toBeNull()
    expect(serverTimeMs('')).toBeNull()
    expect(serverTimeMs('not a time')).toBeNull()
  })
})

describe('relativeUpdated', () => {
  const now = new Date('2026-09-18T10:00:00').getTime()

  it('says how long ago the row changed', () => {
    expect(relativeUpdated('2026-09-18 08:00:00', now)).toBe('2 hours ago')
    expect(relativeUpdated('2026-09-17 10:00:00', now)).toBe('1 day ago')
  })

  it('never prints a negative age when the clocks disagree', () => {
    expect(relativeUpdated('2026-09-18 10:05:00', now)).toBe('just now')
  })

  it('says nothing rather than inventing an age', () => {
    expect(relativeUpdated(null, now)).toBeNull()
  })
})
