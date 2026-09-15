import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_VIEWS,
  dashboardPath,
  isDashboardViewId,
  permittedViews,
  resolveView,
} from './views'

const ALL = new Set([
  'dashboard.read',
  'reconciliation.read',
  'reports.stock_summary.read',
  'reports.stock_ageing.read',
  'reports.replenishment.read',
])

function canFrom(granted: Set<string>) {
  return (key: string | readonly string[]) =>
    typeof key === 'string' ? granted.has(key) : key.some((k) => granted.has(k))
}

/*
 * `preferred` is passed explicitly in every case below rather than left to its
 * default, which reads localStorage. These run in the node project, where there
 * is no window — and a test whose outcome depends on browser storage it cannot
 * clear is a test that passes in isolation and fails in a suite.
 */
describe('resolveView', () => {
  it('honours the view named in the URL', () => {
    expect(resolveView('valuation', canFrom(ALL), false, null)).toBe('valuation')
  })

  it('falls back to an authorised dashboard for an unknown value', () => {
    // A typo, an old link or a value from a future version must land somewhere
    // useful rather than on a dead end.
    expect(resolveView('nonsense', canFrom(ALL), false, null)).toBe('overview')
    expect(resolveView('', canFrom(ALL), false, null)).toBe('overview')
    expect(resolveView(null, canFrom(ALL), false, null)).toBe('overview')
  })

  it('refuses a dashboard the user may not open, even when the URL names it', () => {
    // The paste-from-a-colleague case: their link, your permissions.
    const limited = new Set(['dashboard.read'])
    expect(resolveView('replenishment', canFrom(limited), false, null)).not.toBe('replenishment')
  })

  it('uses the remembered dashboard when the URL names none', () => {
    expect(resolveView(null, canFrom(ALL), false, 'controls')).toBe('controls')
  })

  it('ignores a remembered dashboard the user has since lost access to', () => {
    // A profile change must not keep landing someone on a screen they can no
    // longer read just because the browser remembers they once could.
    const limited = new Set(['dashboard.read'])
    expect(resolveView(null, canFrom(limited), false, 'replenishment')).not.toBe('replenishment')
  })

  it('returns null when the user may open none of the five', () => {
    expect(resolveView('overview', canFrom(new Set()), false, null)).toBeNull()
  })

  it('shows every tab while permissions are still loading, rather than flashing a short bar', () => {
    expect(permittedViews(canFrom(new Set()), true)).toHaveLength(DASHBOARD_VIEWS.length)
  })
})

describe('isDashboardViewId', () => {
  it('is an allowlist, not a shape test', () => {
    expect(isDashboardViewId('overview')).toBe(true)
    expect(isDashboardViewId('Overview')).toBe(false)
    expect(isDashboardViewId('__proto__')).toBe(false)
    expect(isDashboardViewId(null)).toBe(false)
  })
})

describe('dashboardPath', () => {
  it('carries the filters that survive a tab change', () => {
    // Switching tabs must not silently re-scope the figures to today and to
    // every warehouse.
    const path = dashboardPath('valuation', { as_of: '2026-06-30', warehouse_id: 4 })
    expect(path).toContain('view=valuation')
    expect(path).toContain('as_of=2026-06-30')
    expect(path).toContain('warehouse_id=4')
  })

  it('drops empty filters rather than writing blanks into the URL', () => {
    expect(dashboardPath('overview', { as_of: undefined, warehouse_id: '' })).toBe('/dashboard?view=overview')
  })
})

describe('the five dashboards', () => {
  it('each declare a permission, a sequence and a description', () => {
    for (const view of DASHBOARD_VIEWS) {
      expect(view.permissions.length, `${view.id} has no permission gate`).toBeGreaterThan(0)
      expect(view.sequence).toHaveLength(2)
      expect(view.description.length, `${view.id} has no subtitle`).toBeGreaterThan(10)
    }
  })

  it('have unique ids and unique sequences', () => {
    expect(new Set(DASHBOARD_VIEWS.map((v) => v.id)).size).toBe(DASHBOARD_VIEWS.length)
    expect(new Set(DASHBOARD_VIEWS.map((v) => v.sequence.join(' '))).size).toBe(DASHBOARD_VIEWS.length)
  })
})
