import { describe, expect, it } from 'vitest'
import { answeredMethods, formatVariance, methodRows, methodSpread } from './valuationMethods'
import type { MethodSnapshot } from './valuationMethods'
import type { ReportMethod, ValuationSnapshotSummary } from '../services/valuationApi'

function summary(value: number): ValuationSnapshotSummary {
  return { as_of: '2026-09-19', method: 'FIFO', total_qty: 1000, total_value: value, item_count: 20 }
}

function snapshots(values: Partial<Record<ReportMethod, number | null>>): MethodSnapshot[] {
  return (['AS_PER_MASTER', 'FIFO', 'LIFO', 'WAC'] as ReportMethod[]).map((method) => {
    const v = values[method]
    return { method, summary: v === null || v === undefined ? null : summary(v) }
  })
}

describe('valuation method comparison', () => {
  it('measures every method against the basis the books are kept on', () => {
    const rows = methodRows(snapshots({ AS_PER_MASTER: 1_000_000, FIFO: 1_010_000, LIFO: 980_000, WAC: 1_000_000 }))
    const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]))
    expect(byMethod.AS_PER_MASTER.isBasis).toBe(true)
    expect(byMethod.AS_PER_MASTER.variancePercent).toBeNull()
    expect(byMethod.FIFO.variancePercent).toBeCloseTo(1, 5)
    expect(byMethod.LIFO.variancePercent).toBeCloseTo(-2, 5)
    expect(byMethod.WAC.variancePercent).toBeCloseTo(0, 5)
  })

  it('marks a method that could not be valued as unavailable, never as zero', () => {
    // A blank in a comparison is a missing answer; a zero is a claim that this
    // method values the company's stock at nothing.
    const rows = methodRows(snapshots({ AS_PER_MASTER: 1_000_000, FIFO: null, LIFO: 980_000, WAC: null }))
    const fifo = rows.find((r) => r.method === 'FIFO')
    expect(fifo?.value).toBeNull()
    expect(fifo?.status).toBe('unavailable')
    expect(fifo?.scale).toBe(0)
    expect(answeredMethods(rows)).toBe(2)
  })

  it('does not measure a variance from a basis that did not answer', () => {
    const rows = methodRows(snapshots({ AS_PER_MASTER: null, FIFO: 1_010_000 }))
    expect(rows.find((r) => r.method === 'FIFO')?.variancePercent).toBeNull()
    expect(rows.find((r) => r.method === 'FIFO')?.delta).toBeNull()
  })

  it('never divides by a zero basis', () => {
    const rows = methodRows(snapshots({ AS_PER_MASTER: 0, FIFO: 5_000 }))
    const fifo = rows.find((r) => r.method === 'FIFO')
    expect(fifo?.delta).toBe(5_000)
    expect(fifo?.variancePercent).toBeNull()
    expect(formatVariance(fifo?.variancePercent ?? null)).toBe('—')
  })

  it('formats a variance without ever printing NaN or Infinity', () => {
    expect(formatVariance(-0.4)).toBe('-0.4%')
    expect(formatVariance(1.234)).toBe('+1.2%')
    expect(formatVariance(0)).toBe('0.0%')
    expect(formatVariance(Number.NaN)).toBe('—')
    expect(formatVariance(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatVariance(null)).toBe('—')
  })

  it('reports the widest spread only when two methods answered', () => {
    expect(methodSpread(methodRows(snapshots({ AS_PER_MASTER: 1_000_000 })))).toBeNull()
    const spread = methodSpread(methodRows(snapshots({ AS_PER_MASTER: 1_000_000, FIFO: 1_010_000, LIFO: 980_000 })))
    expect(spread?.amount).toBe(30_000)
    expect(spread?.percentOfBasis).toBeCloseTo(3, 5)
  })

  it('keeps every method in the table even when none answered', () => {
    const rows = methodRows(snapshots({}))
    expect(rows).toHaveLength(4)
    expect(answeredMethods(rows)).toBe(0)
    for (const row of rows) expect(row.statusLabel).toBe('Unavailable')
  })
})
