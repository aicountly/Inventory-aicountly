import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatGeneratedStamp } from './format'

/**
 * The "Generated" line on a printed register or challan.
 *
 * It says when the paper in the reader's hand was produced, so it has to be the
 * clock on their wall. Built from the UTC instant it is 5h30m out in India and
 * anything printed after 18:30 IST carries yesterday's date — on a document
 * that is signed and handed to somebody else.
 */

const ORIGINAL_TZ = process.env.TZ

describe('formatGeneratedStamp', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Kolkata'
  })
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  it('stamps the local clock, not the UTC instant', () => {
    // 09:00 IST on 15 September, which is still 14 September in UTC.
    const at = new Date('2026-09-14T03:30:00Z')
    expect(at.toISOString()).toBe('2026-09-14T03:30:00.000Z')
    expect(formatGeneratedStamp(at)).toMatch(/^14 Sept? 2026, 09:00$/)
  })

  it('never carries yesterday on an evening challan', () => {
    // 00:15 IST on 15 September — 18:45 UTC on the 14th.
    expect(formatGeneratedStamp(new Date('2026-09-14T18:45:00Z'))).toMatch(/^15 Sept? 2026, 00:15$/)
  })

  it('pads single-digit months, days, hours and minutes', () => {
    expect(formatGeneratedStamp(new Date('2026-01-02T00:35:00Z'))).toBe('02 Jan 2026, 06:05')
  })
})
