import { describe, expect, it } from 'vitest'
import { formatRelativeTime, relativeTimeTickMs } from './relativeTime'

const NOW = Date.parse('2026-09-16T12:00:00Z')
const ago = (ms: number) => NOW - ms

describe('formatRelativeTime', () => {
  it('says nothing at all when no fetch has landed', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull()
    expect(formatRelativeTime(undefined, NOW)).toBeNull()
  })

  it('reads "just now" for the first three-quarters of a minute', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now')
    expect(formatRelativeTime(ago(44_000), NOW)).toBe('just now')
  })

  it('counts minutes, then hours, then days', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(3 * 60 * 60_000), NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(ago(26 * 60 * 60_000), NOW)).toBe('1 day ago')
  })

  /** A laptop waking, or NTP stepping the clock back. */
  it('does not print a negative age when the clock jumps backwards', () => {
    expect(formatRelativeTime(NOW + 30_000, NOW)).toBe('just now')
  })
})

describe('relativeTimeTickMs', () => {
  it('ticks often enough to stay true, and no oftener', () => {
    expect(relativeTimeTickMs(NOW, NOW)).toBe(15_000)
    expect(relativeTimeTickMs(ago(2 * 60 * 60_000), NOW)).toBe(60_000)
    expect(relativeTimeTickMs(ago(3 * 24 * 60 * 60_000), NOW)).toBe(3_600_000)
  })
})
