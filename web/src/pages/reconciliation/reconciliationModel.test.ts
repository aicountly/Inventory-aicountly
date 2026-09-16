import { describe, expect, it } from 'vitest'
import type { ReconciliationRun } from '../../services/reconciliationApi'
import {
  booksAnswered,
  bucketRows,
  changePercent,
  differencePercent,
  differenceTone,
  formatPercent,
  headlineRun,
  insights,
  previousCompletedRun,
  trendPoints,
} from './reconciliationModel'

/**
 * The arithmetic behind the headline figures.
 *
 * Every case here is one the API can actually produce: a run Books never
 * answered, a company whose stock values to zero, a date reconciled four times
 * in one afternoon, a numeric column that arrived as a string. The screen is
 * only as honest as these.
 */
function run(over: Partial<ReconciliationRun> = {}): ReconciliationRun {
  return {
    run_id: 1,
    run_uuid: null,
    cmp_id: 1,
    fy_id: 3,
    bo_id: 0,
    as_of_date: '2026-09-16',
    inventory_closing_value: 2456320,
    inventory_closing_qty: 968,
    books_stock_ledger_balance: 2445650,
    difference: 10670,
    status: 'COMPLETED',
    requested_by: 'asha',
    created_at: '2026-09-16 07:30:00',
    ...over,
  }
}

describe('differenceTone', () => {
  it('treats a gap under half a paisa as agreement and ₹1 as material', () => {
    expect(differenceTone(0)).toBe('good')
    expect(differenceTone(0.004)).toBe('good')
    expect(differenceTone(0.5)).toBe('warning')
    expect(differenceTone(-1)).toBe('critical')
    expect(differenceTone(10670)).toBe('critical')
  })

  it('never reads a missing figure as agreement', () => {
    // Books not answering is not the same as Books agreeing.
    expect(differenceTone(null)).toBe('neutral')
    expect(differenceTone(undefined)).toBe('neutral')
  })
})

describe('booksAnswered', () => {
  it('is false for a BOOKS_UNAVAILABLE run and for a null balance', () => {
    expect(booksAnswered(run())).toBe(true)
    expect(booksAnswered(run({ status: 'BOOKS_UNAVAILABLE', books_stock_ledger_balance: null, difference: null }))).toBe(false)
    expect(booksAnswered(run({ books_stock_ledger_balance: null }))).toBe(false)
    expect(booksAnswered(null)).toBe(false)
  })

  it('is true for a real zero balance — ₹0 is a balance', () => {
    expect(booksAnswered(run({ books_stock_ledger_balance: 0, difference: 2456320 }))).toBe(true)
  })
})

describe('differencePercent', () => {
  it('measures the gap against the Inventory side', () => {
    expect(differencePercent(run())).toBeCloseTo(0.4344, 3)
  })

  it('refuses to divide by a zero valuation', () => {
    expect(differencePercent(run({ inventory_closing_value: 0, difference: 500 }))).toBeNull()
  })

  it('has no percentage to report when Books never answered', () => {
    expect(differencePercent(run({ status: 'BOOKS_UNAVAILABLE', books_stock_ledger_balance: null, difference: null }))).toBeNull()
  })

  it('reads a numeric column that arrived as a string', () => {
    const asStrings = run({
      inventory_closing_value: '1000' as unknown as number,
      difference: '-250' as unknown as number,
    })
    expect(differencePercent(asStrings)).toBeCloseTo(25, 6)
  })
})

describe('formatPercent', () => {
  it('never renders a real gap as 0.00%', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.0004)).toBe('< 0.01%')
    expect(formatPercent(0.4344)).toBe('0.43%')
    expect(formatPercent(null)).toBe('—')
  })
})

describe('changePercent', () => {
  it('returns null rather than dividing by a zero or missing previous figure', () => {
    expect(changePercent(110, 100)).toBeCloseTo(10, 6)
    expect(changePercent(110, 0)).toBeNull()
    expect(changePercent(110, null)).toBeNull()
    expect(changePercent(null, 100)).toBeNull()
  })
})

describe('headlineRun / previousCompletedRun', () => {
  const rows = [
    run({ run_id: 84, as_of_date: '2026-09-13' }),
    run({ run_id: 87, as_of_date: '2026-09-16' }),
    run({ run_id: 86, as_of_date: '2026-09-15' }),
  ]

  it('picks the newest completed run whatever order the list arrived in', () => {
    expect(headlineRun(rows)?.run_id).toBe(87)
    expect(previousCompletedRun(rows, headlineRun(rows))?.run_id).toBe(86)
  })

  it('skips a failed run at the top rather than reporting its empty figures', () => {
    const withFailure = [run({ run_id: 90, as_of_date: '2026-09-17', status: 'FAILED', difference: null }), ...rows]
    expect(headlineRun(withFailure)?.run_id).toBe(87)
  })

  it('falls back to the only run there is, so a red run is never hidden', () => {
    const onlyFailed = [run({ run_id: 90, status: 'FAILED', difference: null })]
    expect(headlineRun(onlyFailed)?.run_id).toBe(90)
    expect(headlineRun([])).toBeNull()
  })
})

describe('trendPoints', () => {
  it('plots one point per date, oldest first, newest kept', () => {
    const points = trendPoints([
      run({ run_id: 1, as_of_date: '2026-09-14', inventory_closing_value: 100, books_stock_ledger_balance: 90 }),
      run({ run_id: 2, as_of_date: '2026-09-15', inventory_closing_value: 200, books_stock_ledger_balance: 190 }),
      run({ run_id: 3, as_of_date: '2026-09-15', inventory_closing_value: 210, books_stock_ledger_balance: 195 }),
    ])
    expect(points.map((p) => p.runId)).toEqual([1, 3])
    expect(points.map((p) => p.date)).toEqual(['2026-09-14', '2026-09-15'])
  })

  it('leaves out a run Books never answered instead of plotting it at zero', () => {
    const points = trendPoints([
      run({ run_id: 1, as_of_date: '2026-09-14' }),
      run({ run_id: 2, as_of_date: '2026-09-15', status: 'BOOKS_UNAVAILABLE', books_stock_ledger_balance: null, difference: null }),
    ])
    expect(points).toHaveLength(1)
    expect(points[0].runId).toBe(1)
  })

  it('keeps only the most recent runs asked for', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      run({ run_id: i + 1, as_of_date: `2026-09-${String(i + 1).padStart(2, '0')}` }),
    )
    const points = trendPoints(many, 7)
    expect(points).toHaveLength(7)
    expect(points[0].date).toBe('2026-09-06')
    expect(points[6].date).toBe('2026-09-12')
  })
})

describe('insights', () => {
  it('counts what the runs say and nothing more', () => {
    const stats = insights([
      run({ run_id: 3, as_of_date: '2026-09-16', difference: 10 }),
      run({ run_id: 2, as_of_date: '2026-09-15', difference: 40 }),
      run({ run_id: 1, as_of_date: '2026-09-14', difference: 0 }),
      run({ run_id: 4, as_of_date: '2026-09-13', status: 'FAILED', difference: null }),
      run({ run_id: 5, as_of_date: '2026-09-12', status: 'BOOKS_UNAVAILABLE', books_stock_ledger_balance: null, difference: null }),
    ])
    expect(stats.completed).toBe(3)
    expect(stats.failed).toBe(1)
    expect(stats.booksUnavailable).toBe(1)
    expect(stats.withMaterialDifference).toBe(2)
    expect(stats.agreed).toBe(1)
    expect(stats.averageAbsoluteDifference).toBeCloseTo(16.6667, 3)
    expect(stats.largestDifference?.run_id).toBe(2)
    expect(stats.latestDifference).toBe(10)
    // The gap narrowed from ₹40 to ₹10.
    expect(stats.movement).toBe(-30)
  })
})

describe('bucketRows', () => {
  const breakdown = {
    as_of: '2026-09-16',
    sign_convention: 'amount = contribution to (inventory - books)',
    explained_total: 10670,
    residual: 0,
    books: { available: true, status: 200, error: null },
    buckets: {
      pending_posting: { amount: 2000, count: 3, documents: [{ document_id: 1, document_no: 'DN-1', document_date: '2026-09-10' }] },
      failed_posting: { amount: -8670, count: 1 },
      revaluation: { amount: 0, count: 0 },
      unexplained: { amount: 0, count: 0 },
    },
  }

  it('orders by absolute contribution and drops the buckets that did nothing', () => {
    const rows = bucketRows(breakdown)
    expect(rows.map((r) => r.key)).toEqual(['failed_posting', 'pending_posting'])
    expect(rows[0].share).toBeCloseTo(81.26, 1)
    expect(rows[1].documents).toBe(1)
    expect(rows[1].help).toContain('still queued for posting')
  })

  it('keeps every bucket when asked, and reports nothing at all without a breakdown', () => {
    expect(bucketRows(breakdown, { includeEmpty: true })).toHaveLength(4)
    expect(bucketRows(null)).toEqual([])
    expect(bucketRows(undefined)).toEqual([])
  })
})
