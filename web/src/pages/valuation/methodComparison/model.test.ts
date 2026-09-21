import { describe, expect, it } from 'vitest'
import { REPORT_METHODS } from '../../../services/valuationApi'
import type { ReportMethod, ValuationSnapshotSummary } from '../../../services/valuationApi'
import {
  buildComparison,
  defaultAsOfDate,
  deviationSpread,
  insightSentence,
  previousPeriodDate,
  relativeBar,
  takeaways,
} from './model'
import type { MethodSnapshot } from './model'

const WORDS = {
  money: (v: number) => `₹${v}`,
  percent: (v: number) => `${v.toFixed(2)}%`,
}

function summary(value: number, items = 248, qty = 18420): ValuationSnapshotSummary {
  return { as_of: '2026-09-19', method: 'FIFO', total_qty: qty, total_value: value, item_count: items }
}

/** The figures from the approved design, which are a real spread of the four methods. */
function snapshots(
  overrides: Partial<Record<ReportMethod, ValuationSnapshotSummary | null>> = {},
): MethodSnapshot[] {
  const base: Record<ReportMethod, ValuationSnapshotSummary | null> = {
    AS_PER_MASTER: summary(8465220),
    FIFO: summary(8512940),
    LIFO: summary(8378600),
    WAC: summary(8459410),
  }
  return REPORT_METHODS.map((method) => ({ method, summary: { ...base, ...overrides }[method] }))
}

describe('buildComparison', () => {
  it('measures every method from the item-master basis', () => {
    const c = buildComparison(snapshots(), REPORT_METHODS)
    const by = Object.fromEntries(c.rows.map((r) => [r.method, r]))

    expect(by.AS_PER_MASTER.baseline).toBe(true)
    expect(by.AS_PER_MASTER.difference).toBeNull()
    expect(by.FIFO.difference).toBe(47720)
    expect(by.LIFO.difference).toBe(-86620)
    expect(by.WAC.difference).toBe(-5810)
    expect(by.FIFO.variancePercent).toBeCloseTo(0.5637, 3)
    expect(by.LIFO.variancePercent).toBeCloseTo(-1.0233, 3)
    expect(by.FIFO.relativeValue).toBeCloseTo(100.56, 2)
  })

  it('keeps the order it is given, so the table and the export agree', () => {
    expect(buildComparison(snapshots(), REPORT_METHODS).rows.map((r) => r.method)).toEqual([
      ...REPORT_METHODS,
    ])
  })

  it('names the closest and the widest method from the figures, not from a list', () => {
    const c = buildComparison(snapshots(), REPORT_METHODS)
    expect(c.closestRow?.method).toBe('WAC')
    expect(c.maxVarianceRow?.method).toBe('LIFO')
    expect(c.maxVariance).toBe(86620)
    expect(c.spread).toBe(8512940 - 8378600)
  })

  it('re-ranks when a different method is the outlier', () => {
    // Same screen, another company: FIFO is now the far one and LIFO the near.
    const c = buildComparison(
      snapshots({ FIFO: summary(9000000), LIFO: summary(8465300) }),
      REPORT_METHODS,
    )
    expect(c.closestRow?.method).toBe('LIFO')
    expect(c.maxVarianceRow?.method).toBe('FIFO')
  })

  it('rounds the difference to the precision the server sent', () => {
    // 0.1 + 0.2 arithmetic: the raw subtraction here is 47719.999999999996.
    const c = buildComparison(
      snapshots({ AS_PER_MASTER: summary(8465220.1), FIFO: summary(8512940.1) }),
      REPORT_METHODS,
    )
    expect(c.rows.find((r) => r.method === 'FIFO')?.difference).toBe(47720)
  })

  it('reports a method that did not answer as unknown, never as zero', () => {
    const c = buildComparison(snapshots({ LIFO: null }), REPORT_METHODS)
    const lifo = c.rows.find((r) => r.method === 'LIFO')!

    expect(lifo.answered).toBe(false)
    expect(lifo.stockValue).toBeNull()
    expect(lifo.difference).toBeNull()
    expect(c.answered).toBe(3)
    expect(c.maxVarianceRow?.method).toBe('FIFO')
  })

  it('leaves every difference unknown when the basis itself did not answer', () => {
    const c = buildComparison(snapshots({ AS_PER_MASTER: null }), REPORT_METHODS)

    expect(c.basis).toBeNull()
    expect(c.rows.every((r) => r.difference === null)).toBe(true)
    expect(c.closestRow).toBeNull()
    expect(c.maxVariance).toBeNull()
  })

  it('keeps the money when the basis values at zero, and drops the percentages', () => {
    const c = buildComparison(
      snapshots({ AS_PER_MASTER: summary(0), FIFO: summary(500), LIFO: summary(0), WAC: summary(0) }),
      REPORT_METHODS,
    )
    const fifo = c.rows.find((r) => r.method === 'FIFO')!

    expect(fifo.difference).toBe(500)
    expect(fifo.variancePercent).toBeNull()
    expect(fifo.relativeValue).toBeNull()
    expect(c.maxVarianceRow?.method).toBe('FIFO')
  })

  it('separates "no stock" from "no answer"', () => {
    expect(buildComparison(snapshots(), REPORT_METHODS).hasStock).toBe(true)
    // Methods answered; the shelves are empty at this date.
    const empty = buildComparison(
      REPORT_METHODS.map((method) => ({ method, summary: summary(0, 0, 0) })),
      REPORT_METHODS,
    )
    expect(empty.answered).toBe(4)
    expect(empty.hasStock).toBe(false)
    // Nothing answered at all — the caller shows an error, not an empty shelf.
    const silent = buildComparison(
      REPORT_METHODS.map((method) => ({ method, summary: null })),
      REPORT_METHODS,
    )
    expect(silent.hasStock).toBe(false)
    expect(silent.answered).toBe(0)
  })
})

describe('insightSentence', () => {
  it('states the closest method and the widest one', () => {
    const text = insightSentence(buildComparison(snapshots(), REPORT_METHODS), WORDS)

    expect(text).toContain('Weighted average is closest')
    expect(text).toContain('₹5810 lower')
    expect(text).toContain('LIFO differs most')
    expect(text).toContain('₹86620 lower')
  })

  it('says "higher" when the method values above the basis', () => {
    const c = buildComparison(snapshots({ LIFO: null, WAC: null }), REPORT_METHODS)
    expect(insightSentence(c, WORDS)).toContain('₹47720 higher')
  })

  it('does not repeat one method as both closest and widest', () => {
    const c = buildComparison(snapshots({ LIFO: null, WAC: null }), REPORT_METHODS)
    expect(insightSentence(c, WORDS)).not.toContain('differs most')
  })

  it('has nothing to say without a basis to measure from', () => {
    expect(insightSentence(buildComparison(snapshots({ AS_PER_MASTER: null }), REPORT_METHODS), WORDS)).toBeNull()
  })
})

describe('takeaways', () => {
  it('restates the figures on screen and recommends no method', () => {
    const lines = takeaways(buildComparison(snapshots(), REPORT_METHODS), WORDS).map((t) => t.text)

    expect(lines[0]).toContain('Weighted average is closest')
    expect(lines[1]).toContain('LIFO differs most')
    expect(lines[2]).toContain('span ₹134340')
    expect(lines.join(' ')).not.toMatch(/\bbest\b|\bshould (use|switch)\b|recommend/i)
  })

  it('points at the drilldown, and says so more firmly past a percent', () => {
    const wide = takeaways(buildComparison(snapshots(), REPORT_METHODS), WORDS)
    expect(wide.at(-1)?.text).toContain('not what you expected')

    const narrow = takeaways(
      buildComparison(snapshots({ LIFO: summary(8465300) }), REPORT_METHODS),
      WORDS,
    )
    expect(narrow.at(-1)?.text).not.toContain('not what you expected')
  })

  it('still produces a next step when there is nothing to compare', () => {
    const lines = takeaways(buildComparison(snapshots({ AS_PER_MASTER: null }), REPORT_METHODS), WORDS)
    expect(lines).toHaveLength(1)
  })
})

describe('relativeBar', () => {
  const c = buildComparison(snapshots(), REPORT_METHODS)
  const spread = deviationSpread(c.rows)
  const row = (m: ReportMethod) => c.rows.find((r) => r.method === m)!

  it('puts the widest deviation at the full half-track and the basis at the centre', () => {
    expect(relativeBar(row('LIFO'), spread).width).toBeCloseTo(50, 5)
    expect(relativeBar(row('AS_PER_MASTER'), spread)).toEqual({ deviation: 0, width: 0, direction: 'level' })
  })

  it('scales the others against it and keeps their direction', () => {
    const fifo = relativeBar(row('FIFO'), spread)
    const wac = relativeBar(row('WAC'), spread)

    expect(fifo.direction).toBe('above')
    expect(wac.direction).toBe('below')
    expect(fifo.width).toBeGreaterThan(wac.width)
    expect(fifo.width).toBeLessThan(50)
  })

  it('does not divide by zero when every method matches the basis', () => {
    const flat = buildComparison(
      REPORT_METHODS.map((method) => ({ method, summary: summary(1000) })),
      REPORT_METHODS,
    )
    const bar = relativeBar(flat.rows[1], deviationSpread(flat.rows))
    expect(bar.width).toBe(0)
    expect(bar.direction).toBe('level')
  })

  it('calls a rounding tail level rather than a difference', () => {
    const hair = buildComparison(
      snapshots({ FIFO: summary(8465220 + 8465220 * 0.00001) }),
      REPORT_METHODS,
    )
    expect(relativeBar(hair.rows.find((r) => r.method === 'FIFO')!, deviationSpread(hair.rows)).direction).toBe('level')
  })
})

describe('previousPeriodDate', () => {
  it('goes back one calendar month', () => {
    expect(previousPeriodDate('2026-09-19')).toBe('2026-08-19')
  })

  it('crosses the year boundary', () => {
    expect(previousPeriodDate('2026-01-15')).toBe('2025-12-15')
  })

  it('clamps to the shorter month instead of spilling into the next one', () => {
    expect(previousPeriodDate('2026-03-31')).toBe('2026-02-28')
    expect(previousPeriodDate('2024-03-30')).toBe('2024-02-29')
  })

  it('refuses anything that is not a plain ISO date', () => {
    expect(previousPeriodDate('')).toBeNull()
    expect(previousPeriodDate('19-09-2026')).toBeNull()
  })
})

describe('defaultAsOfDate', () => {
  const fy = { from: '2026-04-01', to: '2027-03-31' }

  it('opens on today while today is inside the selected year', () => {
    expect(defaultAsOfDate('2026-09-19', fy)).toBe('2026-09-19')
  })

  it('holds a closed year at its last day rather than valuing past it', () => {
    expect(defaultAsOfDate('2026-09-19', { from: '2025-04-01', to: '2026-03-31' })).toBe('2026-03-31')
  })

  it('holds a year that has not opened yet at its first day', () => {
    expect(defaultAsOfDate('2026-09-19', { from: '2027-04-01', to: '2028-03-31' })).toBe('2027-04-01')
  })

  it('falls back to today when the year range is unknown', () => {
    expect(defaultAsOfDate('2026-09-19', { from: '', to: '' })).toBe('2026-09-19')
  })
})
