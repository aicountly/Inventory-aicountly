import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * First-paint composition for the four new dashboards.
 *
 * `renderToStaticMarkup` runs every hook body but no effects, so this is the
 * page exactly as it looks before a single request resolves — the state every
 * user sees every time they open it, and the state a composition mistake (a
 * hook behind a condition, a widget reading `.data` without a null check) blows
 * up in.
 *
 * It also pins the two claims these screens make about honesty: nothing shows a
 * zero it has not counted, and a figure the product does not model says so.
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
    boId: 0,
  },
}

vi.mock('../company/CompanyContext', () => ({ useCompany: () => company.value }))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      typeof key === 'string' ? permissions.value.has(key) : key.some((k) => permissions.value.has(k)),
    loading: false,
    member: { display_name: 'Priya Sharma' },
  }),
  useAccessOptional: () => null,
}))

const ALL = [
  'dashboard.read',
  'documents.read',
  'documents.create',
  'audit.read',
  'integration.read',
  'reconciliation.read',
  'reconciliation.resolve',
  'reports.stock_summary.read',
  'reports.warehouse_stock.read',
  'reports.stock_ageing.read',
  'reports.movement_analysis.read',
  'reports.near_expiry.read',
  'reports.replenishment.read',
  'reports.stock_ledger.read',
  'reports.valuation.read',
  'valuation.recalculate',
  'masters.items.read',
]

function scopeStub() {
  return {
    view: 'overview',
    setView: () => {},
    scopeKey: '1:3:0',
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    ready: true,
    asOf: '2026-09-15',
    setAsOf: () => {},
    period: { from: '2026-04-01', to: '2026-09-15' },
    warehouses: [{ warehouse_id: 4, warehouse_name: 'Main', warehouse_code: 'WH-MW', warehouse_type: 'standard', is_default: 1, bo_id: 0, is_active: 1 }],
    warehousesLoading: false,
    selectedWarehouseId: null,
    effectiveWarehouseId: null,
    setWarehouseId: () => {},
    warehouseDropped: false,
    itemId: null,
    setItemId: () => {},
    preserved: {},
  }
}

/**
 * Valuation reports the outcome of a recalculation through the shared toast, so
 * it needs a provider the way it has one under AppShell. Mounting the real
 * ToastProvider rather than stubbing `useToast` keeps the test honest about the
 * page's actual dependencies.
 */
async function render(module: string, viewId: string): Promise<string> {
  const mod = await import(module)
  const { viewById } = await import('./views')
  const { ToastProvider } = await import('../ui/ToastContext')
  const Component = mod.default
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        ToastProvider,
        null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
        createElement(Component, { scope: scopeStub() as any, view: viewById(viewId as never) }),
      ),
    ),
  )
}

beforeEach(() => {
  permissions.value = new Set(ALL)
})

describe('every dashboard, first paint', () => {
  const pages = [
    ['./pages/OperationsDashboard', 'operations', 'Warehouse operations'],
    ['./pages/ReplenishmentDashboard', 'replenishment', 'Replenishment planning'],
    ['./pages/ValuationDashboard', 'valuation', 'Valuation and stock health'],
    ['./pages/ControlsDashboard', 'controls', 'Controls and reconciliation'],
  ] as const

  for (const [module, viewId, heading] of pages) {
    it(`${viewId} renders its heading, scope line and filters before any data lands`, async () => {
      const html = await render(module, viewId)
      expect(html).toContain(heading)
      // The scope line is the contract between a card and its register.
      expect(html).toContain('Acme Traders')
      expect(html).toContain('2026-27')
      expect(html).toContain('All branches')
      // Filters are usable before the request they narrow has resolved.
      expect(html).toContain('type="date"')
      expect(html).toContain('aria-label="Warehouse"')
    })

    it(`${viewId} shows skeletons rather than zeros before anything has loaded`, async () => {
      const html = await render(module, viewId)
      expect(html).toContain('skeleton')
    })

    it(`${viewId} keeps its chrome out of print`, async () => {
      expect(await render(module, viewId)).toContain('print:hidden')
    })
  }
})

describe('figures the product does not model', () => {
  it('says transfers in transit are not tracked, and points somewhere real', async () => {
    // This product posts a transfer out and in as one operation, so nothing is
    // ever held in transit. A plausible number here would be invented.
    const html = await render('./pages/OperationsDashboard', 'operations')
    expect(html).toContain('Transfers in transit')
    expect(html).toContain('Not tracked')
    expect(html).toContain('See goods awaited')
  })

  it('says open replenishment requests are not modelled rather than showing zero', async () => {
    const html = await render('./pages/ReplenishmentDashboard', 'replenishment')
    expect(html).toContain('Open requests')
    expect(html).toContain('Not tracked')
  })
})

describe('permission gating', () => {
  it('does not offer to run a reconciliation without the permission for it', async () => {
    permissions.value = new Set(ALL.filter((p) => p !== 'reconciliation.resolve'))
    const html = await render('./pages/ControlsDashboard', 'controls')
    expect(html).not.toContain('Run reconciliation')
  })

  it('offers the run button to a user who may resolve reconciliations', async () => {
    const html = await render('./pages/ControlsDashboard', 'controls')
    expect(html).toContain('Run reconciliation')
  })
})

describe('valuation and stock health', () => {
  it('hides Run valuation from a user who may not recalculate', async () => {
    permissions.value = new Set(ALL.filter((p) => p !== 'valuation.recalculate'))
    const html = await render('./pages/ValuationDashboard', 'valuation')
    expect(html).not.toContain('Run valuation')
  })

  it('offers Run valuation to a user who may', async () => {
    expect(await render('./pages/ValuationDashboard', 'valuation')).toContain('Run valuation')
  })

  it('leaves out the method comparison without the valuation report permission', async () => {
    permissions.value = new Set(ALL.filter((p) => p !== 'reports.valuation.read'))
    const html = await render('./pages/ValuationDashboard', 'valuation')
    expect(html).not.toContain('Valuation method comparison')
  })

  it('never claims an AI insight', async () => {
    // There is no AI service behind this product. pulse.ts sets out the
    // reasoning; this pins it on the screen that would be most tempted.
    // (The hero's own wording is asserted in valuationRender.test.ts, where it
    // has data to render; at first paint it is a skeleton.)
    const html = await render('./pages/ValuationDashboard', 'valuation')
    expect(html).not.toMatch(/\bAI\b/)
  })

  it('shows no health score at all before the figures behind it land', async () => {
    // The hero holds its own geometry as a skeleton, so the score does not pop
    // in over a collapsed panel — and no score is asserted until one exists.
    const html = await render('./pages/ValuationDashboard', 'valuation')
    expect(html).toContain('skeleton')
    expect(html).not.toContain('/100')
  })

  it('never puts an internal identifier on the page', async () => {
    // The screen this replaced rendered "Company context required (cmp_id,
    // fy_id, bo_id)" onto a card.
    const html = await render('./pages/ValuationDashboard', 'valuation')
    for (const internal of ['cmp_id', 'fy_id', 'bo_id', 'SQLSTATE', 'inv_stock']) {
      expect(html, `"${internal}" reached the page`).not.toContain(internal)
    }
  })

  it('carries no realizable-value card, because nothing can compute one', async () => {
    // Inventory records cost. Net realizable value needs an expected selling
    // price net of the cost to sell, which this product does not hold — MRP is
    // a printed ceiling and selling prices belong to Books.
    const html = await render('./pages/ValuationDashboard', 'valuation')
    expect(html.toLowerCase()).not.toContain('realizable value')
  })
})
