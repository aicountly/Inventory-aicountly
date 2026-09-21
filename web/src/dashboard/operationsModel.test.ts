import { describe, expect, it } from 'vitest'
import { countProgress, hourLabel, hourlySeries, inFlightSummary, progressLabel } from './operationsModel'

describe('hourlySeries', () => {
  it('splits the day into four parallel series', () => {
    const s = hourlySeries([
      { hour: 9, receipt: 2, issue: 1, transfer: 0, adjustment: 0 },
      { hour: 10, receipt: 4, issue: 3, transfer: 1, adjustment: 0 },
    ])
    expect(s.categories).toEqual(['09', '10'])
    expect(s.receipts).toEqual([2, 4])
    expect(s.total).toBe(11)
    expect(s.busiestHour).toBe(10)
  })

  it('does not invent hours the server did not send', () => {
    // The server truncates at the current hour so the chart cannot draw the
    // future; re-expanding the day here would undo that.
    const s = hourlySeries([{ hour: 9, receipt: 1, issue: 0, transfer: 0, adjustment: 0 }])
    expect(s.categories).toHaveLength(1)
  })

  it('has no busiest hour on a day with no work', () => {
    expect(hourlySeries([{ hour: 9, receipt: 0, issue: 0, transfer: 0, adjustment: 0 }]).busiestHour).toBeNull()
    expect(hourlySeries([]).busiestHour).toBeNull()
  })
})

describe('hourLabel', () => {
  it('reads as a time rather than an axis tick', () => {
    expect(hourLabel(0)).toBe('12 AM')
    expect(hourLabel(9)).toBe('9 AM')
    expect(hourLabel(12)).toBe('12 PM')
    expect(hourLabel(17)).toBe('5 PM')
  })
})

describe('count progress', () => {
  it('reports a real fraction, not a made-up score', () => {
    const [row] = countProgress([
      { warehouse_id: 1, warehouse_name: 'Main', counted_lines: 410, total_lines: 500, documents: 2 },
    ])
    expect(row.counted).toBe(410)
    expect(row.total).toBe(500)
    expect(Math.round(row.percent)).toBe(82)
  })

  it('calls a count with no lines empty rather than 0% done', () => {
    // Zero of zero is not "none of the work done", and a bar at zero sends a
    // supervisor to chase someone who has nothing to do.
    const [row] = countProgress([
      { warehouse_id: 1, warehouse_name: 'Main', counted_lines: 0, total_lines: 0, documents: 1 },
    ])
    expect(row.empty).toBe(true)
    expect(progressLabel(0, 0)).toBe('No lines to count')
  })

  it('always shows the numerator and denominator beside the percentage', () => {
    expect(progressLabel(410, 500)).toBe('410 of 500 lines · 82%')
  })

  it('puts the least complete warehouse first, where the attention is needed', () => {
    const rows = countProgress([
      { warehouse_id: 1, warehouse_name: 'Main', counted_lines: 90, total_lines: 100, documents: 1 },
      { warehouse_id: 2, warehouse_name: 'Jaipur', counted_lines: 35, total_lines: 100, documents: 1 },
    ])
    expect(rows[0].label).toBe('Jaipur')
  })
})

describe('inFlightSummary', () => {
  it('reads as a sentence', () => {
    expect(inFlightSummary([{ kind: 'challan', documents: 3 }])).toBe('3 challans outstanding')
    expect(inFlightSummary([{ kind: 'challan', documents: 1 }, { kind: 'job_work', documents: 2 }])).toBe(
      '1 challan and 2 job works outstanding',
    )
  })

  it('says so plainly when nothing is out', () => {
    expect(inFlightSummary([])).toBe('Nothing is outstanding')
    expect(inFlightSummary([{ kind: 'challan', documents: 0 }])).toBe('Nothing is outstanding')
  })
})
