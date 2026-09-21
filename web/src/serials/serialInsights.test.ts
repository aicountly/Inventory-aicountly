import { describe, expect, it } from 'vitest'
import { buildSerialFindings, serialInsightHeadline } from './serialInsights'
import type { SerialSummary } from '../services/masters'

function summary(patch: Partial<SerialSummary> = {}): SerialSummary {
  return {
    as_on: '2026-09-18',
    currency: 'INR',
    cost_visible: true,
    total: 1248,
    previous_total: 1114,
    previous_as_of: '2026-08-18',
    by_status: { expected: 0, in_stock: 892, reserved: 0, issued: 142, in_transit: 0, damaged: 0, returned: 0, scrapped: 0 },
    groups: { in_stock: 892, allocated: 214, out: 142 },
    warranty: { expired: 0, soon: 0, upcoming: 0, active: 0, none: 0, soon_days: 30, upcoming_days: 90 },
    in_stock_value: 0,
    unplaced: 0,
    ...patch,
  }
}

describe('buildSerialFindings', () => {
  it('says nothing at all when the summary has not arrived', () => {
    // "All clear" from a failed request is worse than a blank panel.
    expect(buildSerialFindings(null)).toEqual([])
  })

  it('stays silent on a zero — "nothing has expired" is not a finding', () => {
    expect(buildSerialFindings(summary())).toEqual([])
  })

  it('reports expired warranties first, as the one thing already gone wrong', () => {
    const findings = buildSerialFindings(
      summary({ warranty: { expired: 9, soon: 14, upcoming: 3, active: 100, none: 5, soon_days: 30, upcoming_days: 90 } }),
    )
    expect(findings[0].key).toBe('warranty_expired')
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].text).toBe('9 serial numbers are past warranty expiry.')
    expect(findings[0].filters).toEqual({ warranty_status: 'expired' })
  })

  it('quotes the window the server measured, not one of its own', () => {
    const findings = buildSerialFindings(
      summary({ warranty: { expired: 0, soon: 4, upcoming: 0, active: 0, none: 0, soon_days: 45, upcoming_days: 120 } }),
    )
    expect(findings[0].text).toBe('4 warranties expire within 45 days.')
    expect(findings[0].filters).toEqual({ warranty_status: 'expiring', warranty_days: '45' })
  })

  it('reads as English for one row as well as for many', () => {
    const findings = buildSerialFindings(summary({ unplaced: 1 }))
    expect(findings[0].text).toContain('1 serial number is held or expected')
    expect(findings[0].text).toContain('it does not appear')
  })

  it('carries filters that show exactly the serials it counted', () => {
    const findings = buildSerialFindings(summary({ by_status: { ...summary().by_status, damaged: 3, scrapped: 2 } }))
    const damaged = findings.find((f) => f.key === 'damaged')
    expect(damaged?.text).toBe('5 serial numbers are recorded as damaged or scrapped.')
    expect(damaged?.filters).toEqual({ status: 'damaged,scrapped' })
  })

  it('ranks by severity, so the queue is worked from the top', () => {
    const findings = buildSerialFindings(
      summary({
        unplaced: 2,
        by_status: { ...summary().by_status, in_transit: 4 },
        warranty: { expired: 1, soon: 0, upcoming: 0, active: 0, none: 0, soon_days: 30, upcoming_days: 90 },
      }),
    )
    expect(findings.map((f) => f.severity)).toEqual(['critical', 'warning', 'info'])
  })
})

describe('serialInsightHeadline', () => {
  it('distinguishes "still loading" from "nothing to report"', () => {
    expect(serialInsightHeadline([], null)).toBe('Figures are still loading.')
    expect(serialInsightHeadline([], summary())).toBe('Nothing needs attention across these serial numbers.')
  })

  it('does not scold an empty company', () => {
    expect(serialInsightHeadline([], summary({ total: 0 }))).toBe('No serial numbers are registered in this scope yet.')
  })

  it('counts the urgent ones when there are any', () => {
    const findings = buildSerialFindings(
      summary({ warranty: { expired: 9, soon: 2, upcoming: 0, active: 0, none: 0, soon_days: 30, upcoming_days: 90 } }),
    )
    expect(serialInsightHeadline(findings, summary())).toBe('1 thing needs attention now.')
  })
})
