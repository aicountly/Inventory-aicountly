import { describe, expect, it } from 'vitest'
import { REPORT_CONFIGS, reportByPath } from './index'

describe('report configs', () => {
  it('are unique by path and permission slug', () => {
    const paths = REPORT_CONFIGS.map((c) => c.path)
    expect(new Set(paths).size).toBe(paths.length)
    const slugs = REPORT_CONFIGS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('have unique column keys and filter keys per report', () => {
    for (const c of REPORT_CONFIGS) {
      const keys = c.columns.map((col) => col.key)
      expect(new Set(keys).size, `${c.path} columns`).toBe(keys.length)
      const filters = c.filters.map((f) => f.key)
      expect(new Set(filters).size, `${c.path} filters`).toBe(filters.length)
      expect(c.defaultSort).toBeTruthy()
    }
  })

  it('resolve by URL segment', () => {
    expect(reportByPath('stock-summary')?.slug).toBe('stock_summary')
    expect(reportByPath('nope')).toBeUndefined()
  })

  it('derive period defaults from the financial year and today', () => {
    const ctx = { fyFrom: '2026-04-01', fyTo: '2027-03-31', today: '2026-09-12' }
    const summary = reportByPath('stock-summary')!
    const from = summary.filters.find((f) => f.key === 'from')!
    const to = summary.filters.find((f) => f.key === 'to')!
    expect(from.defaultValue!(ctx)).toBe('2026-04-01')
    expect(to.defaultValue!(ctx)).toBe('2026-09-12')
    expect(to.defaultValue!({ ...ctx, today: '2027-06-01' })).toBe('2027-03-31')
  })
})
