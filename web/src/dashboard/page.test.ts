import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Composition test for the whole overview page.
 *
 * `renderToStaticMarkup` runs every hook body but no effects, so this exercises
 * the page exactly as it looks on first paint — before any request resolves.
 * That is the state worth pinning down: it is what a user sees every single
 * time they open the dashboard, and it is the state a composition mistake (a
 * hook called conditionally, a widget reading `.data` without a null check)
 * blows up in.
 *
 * It also pins the permission contract, which is otherwise only visible by
 * reading three files: a report the user cannot read must not appear at all.
 */

const permissions = { value: new Set<string>() }
const company = {
  value: {
    companyName: 'Acme Traders',
    fy: { label: '2026-27' },
    branch: null as { name: string } | null,
    status: 'ready' as const,
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
  },
}

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => company.value,
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      typeof key === 'string' ? permissions.value.has(key) : key.some((k) => permissions.value.has(k)),
    loading: false,
    member: { display_name: 'Priya Sharma' },
  }),
}))

const ALL = [
  'dashboard.read',
  'documents.read',
  'integration.read',
  'reconciliation.read',
  'reports.stock_summary.read',
  'reports.warehouse_stock.read',
  'reports.stock_ageing.read',
  'reports.movement_analysis.read',
  'reports.near_expiry.read',
  'reports.replenishment.read',
  'reports.stock_ledger.read',
  'masters.items.read',
]

/**
 * The scope the shell would hand the section.
 *
 * Overview no longer owns its as-at date or its warehouse filter — those live
 * in the URL and are shared by all five dashboards (useDashboardScope), so the
 * test supplies them the way DashboardPage does. Nothing here is fetched: at
 * first paint every query is still in flight, which is the state being pinned.
 */
function scopeStub(overrides: Record<string, unknown> = {}) {
  return {
    view: 'overview',
    setView: () => {},
    scopeKey: '1:3:0',
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    ready: true,
    asOf: '2026-09-15',
    setAsOf: () => {},
    period: { from: '2026-04-01', to: '2026-09-15' },
    warehouses: [],
    warehousesLoading: false,
    selectedWarehouseId: null,
    effectiveWarehouseId: null,
    setWarehouseId: () => {},
    warehouseDropped: false,
    itemId: null,
    setItemId: () => {},
    preserved: {},
    ...overrides,
  }
}

async function render(): Promise<string> {
  const { OverviewDashboard } = await import('./OverviewDashboard')
  const { viewById } = await import('./views')
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(OverviewDashboard, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
        scope: scopeStub() as any,
        view: viewById('overview'),
      }),
    ),
  )
}

beforeEach(() => {
  permissions.value = new Set(ALL)
  company.value = { ...company.value, status: 'ready' as const }
})

describe('OverviewDashboard, first paint', () => {
  it('renders every widget for a user who can read everything', async () => {
    const html = await render()
    for (const title of [
      'Stock value by warehouse',
      'Stock ageing',
      'Movement mix',
      'To reorder',
      'Expiring and expired',
      'Where the value sits',
      'Latest movements',
      'Documents this year',
      'Books integration',
      'Reconciliation with Books',
    ]) {
      expect(html, `missing widget: ${title}`).toContain(title)
    }
  })

  it('states the scope every figure is counted in', async () => {
    // The scope line is the contract between a card and the register behind it:
    // company, financial year, branch, warehouse and the as-at date all have to
    // be on screen, or a figure cannot be reconciled against anything.
    const html = await render()
    expect(html).toContain('Acme Traders')
    expect(html).toContain('2026-27')
    expect(html).toContain('All branches')
    expect(html).toContain('All warehouses')
  })

  it('shows skeletons rather than zeros before anything has loaded', async () => {
    const html = await render()
    expect(html).toContain('skeleton')
    // Placeholders must not be read out as content.
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThan(5)
  })

  it('offers the expiry window, a date and a refresh without waiting for data', async () => {
    const html = await render()
    expect(html).toContain('Expiry window')
    for (const d of ['15d', '30d', '60d', '90d']) expect(html).toContain(d)
    expect(html).toContain('aria-pressed="true"')
    // The as-at picker and the warehouse filter are usable before any request
    // has resolved — a filter bar that waits for data is a filter bar nobody
    // can use to narrow the request they are waiting on.
    expect(html).toContain('type="date"')
    expect(html).toContain('aria-label="Warehouse"')
  })

  it('keeps chrome out of print but not the cards', async () => {
    const html = await render()
    expect(html).toContain('print:hidden')
  })
})

describe('OverviewDashboard, permission gating', () => {
  it('drops the widgets whose report the user cannot read', async () => {
    permissions.value = new Set(['dashboard.read', 'documents.read'])
    const html = await render()
    expect(html).toContain('Documents this year')
    expect(html).not.toContain('Stock value by warehouse')
    expect(html).not.toContain('Stock ageing')
    expect(html).not.toContain('To reorder')
    expect(html).not.toContain('Expiring and expired')
  })

  it('drops the KPI tiles whose source is blocked, instead of leaving them loading for ever', async () => {
    permissions.value = new Set(['dashboard.read'])
    const html = await render()
    // dashboard.read feeds exactly two of the eight tiles (negative stock and
    // awaiting approval). The other six have no readable source, so they are
    // not on the page at all — they are not left as permanent skeletons.
    // At first paint all surviving tiles ARE skeletons, so count the tiles by
    // the KPI shell, which a tile carries loaded or loading.
    expect((html.match(/min-w-\[160px\]/g) ?? []).length).toBe(2)
    expect(html).not.toContain('Stock value')
    expect(html).not.toContain('To reorder')
  })

  it('renders all eight tiles when every source is readable', async () => {
    const html = await render()
    expect((html.match(/min-w-\[160px\]/g) ?? []).length).toBe(8)
  })

  it('shows a dashboard.read user everything that payload carries', async () => {
    // The server authorises GET /v1/dashboard on dashboard.read alone and sends
    // the integration and reconciliation blocks to anyone who passes. Gating the
    // widgets on integration.read / reconciliation.read as well hid data the
    // user had already been given, and left them with one card.
    permissions.value = new Set(['dashboard.read'])
    const html = await render()
    expect(html).toContain('Documents this year')
    expect(html).toContain('Books integration')
    expect(html).toContain('Reconciliation with Books')
  })

  it('explains itself to a user with no inventory access at all', async () => {
    permissions.value = new Set<string>()
    const html = await render()
    expect(html).toContain('You do not have access to the Inventory dashboard')
    expect(html).not.toContain('Documents this year')
  })

  it('stands aside for the shell when no company is selected', async () => {
    company.value = { ...company.value, status: 'empty' as unknown as 'ready' }
    expect(await render()).toBe('')
  })
})
