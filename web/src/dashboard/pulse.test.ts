import { describe, expect, it } from 'vitest'
import { buildPulseFindings, pulseHeadline } from './pulse'

/**
 * The briefing is the most-read text on the dashboard and the easiest place to
 * assert something untrue. Two failure modes matter: saying "all clear" because
 * a figure could not be fetched, and dressing arithmetic up as a forecast.
 */
describe('buildPulseFindings', () => {
  it('says nothing about a figure it does not know', () => {
    // null means "not loaded / failed", not "zero". A briefing that reports
    // all-clear because a request failed is the worst outcome on this screen.
    expect(buildPulseFindings({})).toHaveLength(0)
    expect(buildPulseFindings({ negativeStockRows: null, failedPostings: undefined })).toHaveLength(0)
  })

  it('says nothing about a genuine zero either', () => {
    expect(buildPulseFindings({ negativeStockRows: 0, belowReorder: 0, expiredBatches: 0 })).toHaveLength(0)
  })

  it('reports the problems it can see, worst first', () => {
    const findings = buildPulseFindings({
      pendingApproval: 7,
      belowReorder: 18,
      failedPostings: 2,
    })
    expect(findings.map((f) => f.key)).toEqual(['failed_postings', 'below_reorder', 'pending_approval'])
    expect(findings[0].severity).toBe('critical')
  })

  it('gives every finding somewhere to act', () => {
    const findings = buildPulseFindings({ negativeStockRows: 1, expiredBatches: 3, outboxFailed: 2 })
    for (const f of findings) {
      expect(f.to, `${f.key} has no destination`).toBeTruthy()
      expect(f.actionLabel, `${f.key} has no action label`).toBeTruthy()
    }
  })

  it('reads a reconciliation difference with its sign intact', () => {
    const lower = buildPulseFindings({ reconciliationDifference: 12000 })
    expect(lower[0].text).toContain('Books is lower')
    const higher = buildPulseFindings({ reconciliationDifference: -12000 })
    expect(higher[0].text).toContain('Books is higher')
  })

  it('treats an unreachable Books as a finding, not as silence', () => {
    // "No difference because we could not ask" must never render the same as
    // "no difference".
    const findings = buildPulseFindings({ reconciliationStatus: 'BOOKS_UNAVAILABLE' })
    expect(findings.map((f) => f.key)).toContain('books_unavailable')
    expect(findings[0].text).toContain('unknown rather than nil')
  })

  it('ignores a rounding-sized reconciliation difference', () => {
    expect(buildPulseFindings({ reconciliationDifference: 0.004 })).toHaveLength(0)
  })

  it('uses the caller\'s expiry window in the sentence and in the link', () => {
    const findings = buildPulseFindings({ expiringBatches: 3, expiringDays: 60 })
    expect(findings[0].text).toContain('60 days')
    expect(findings[0].to).toContain('days=60')
  })

  it('gets singular and plural right, because a briefing is read as prose', () => {
    expect(buildPulseFindings({ failedPostings: 1 })[0].text).toContain('1 document failed')
    expect(buildPulseFindings({ failedPostings: 2 })[0].text).toContain('2 documents failed')
  })
})

describe('pulseHeadline', () => {
  it('distinguishes "nothing wrong" from "nothing known"', () => {
    expect(pulseHeadline([], false)).toBe('Figures are still loading.')
    expect(pulseHeadline([], true)).toContain('Nothing needs attention')
  })

  it('leads with the count of things that are actually urgent', () => {
    const findings = buildPulseFindings({ failedPostings: 2, pendingApproval: 7 })
    expect(pulseHeadline(findings, true)).toContain('1 issue')
  })
})
