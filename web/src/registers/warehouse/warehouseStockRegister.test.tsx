import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { warehouseStockConfig } from './warehouseStockRegister'
import type { WarehouseStockRow, WarehouseStockSummary } from '../../services/reportsApi'
import type { ReportResponse } from '../../services/reportsApi'

/*
 * The warehouse-stock register, end to end through the engine.
 *
 * Everything that talks to the network or to a provider is stubbed; the register's own
 * behaviour — its columns, its KPI cards, its saved views, its rail and what it does and
 * does not claim on a back-dated read — is the subject.
 */

const can = vi.fn((_key?: string | readonly string[]) => true)

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main store' },
      { warehouse_id: 4, warehouse_name: 'North store' },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main store',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: () => {} }),
}))

const fetchReport = vi.fn()
vi.mock('../../services/reportsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reportsApi')>()
  return { ...actual, fetchReport: (...args: unknown[]) => fetchReport(...args) }
})

/* ------------------------------------------------------------------ fixtures */

function row(patch: Partial<WarehouseStockRow> = {}): WarehouseStockRow {
  return {
    item_id: 12,
    item_name: 'Paracetamol 500mg Tablet',
    item_alias: null,
    item_sku: 'MED-001',
    unit_id: 1,
    unit_symbol: 'Strip',
    item_grp_id: 5,
    grp_name: 'Medicine',
    stock_cat_id: null,
    cat_name: null,
    valuation_method: 'FIFO',
    valuation_method_applied: 'FIFO',
    is_active: 1,
    opening_qty: 1000,
    in_qty: 500,
    out_qty: 250,
    closing_qty: 1250,
    unit_cost: 12.5,
    closing_value: 15_625,
    warehouse_id: 3,
    warehouse_name: 'Main store',
    warehouse_code: 'MAIN',
    reserved_qty: 100,
    available_qty: 1150,
    min_stock_qty: null,
    max_stock_qty: null,
    reorder_point_qty: null,
    safety_stock_qty: null,
    stock_health: 'healthy',
    ...patch,
  }
}

const NEGATIVE = row({
  item_id: 30,
  item_name: 'Vitamin D3 1000 IU',
  item_sku: 'SUP-001',
  grp_name: 'Supplement',
  warehouse_id: 4,
  warehouse_name: 'North store',
  closing_qty: -15,
  reserved_qty: 0,
  available_qty: -15,
  unit_cost: 120,
  closing_value: -1800,
  stock_health: 'negative',
})

function summary(patch: Partial<WarehouseStockSummary> = {}): WarehouseStockSummary {
  return {
    rows: 248,
    items: 240,
    warehouses: 2,
    active_warehouses: 4,
    closing_qty: 12_436,
    closing_value: 2_842_690,
    reserved_qty: 387,
    available_qty: 12_049,
    by_warehouse: [
      { warehouse_id: 3, warehouse_name: 'Main store', closing_qty: 9000, closing_value: 2_000_000, items: 160 },
      { warehouse_id: 4, warehouse_name: 'North store', closing_qty: 3436, closing_value: 842_690, items: 80 },
    ],
    health: { negative: 4, out: 0, reorder: 5, low: 3, overstocked: 0, healthy: 236 },
    health_items: { negative: 4, out: 0, reorder: 5, low: 3, overstocked: 0, healthy: 228 },
    health_filter: null,
    method: 'AS_PER_MASTER',
    live_buckets: true,
    currency: 'INR',
    to: '2026-09-19',
    ...patch,
  }
}

function page(
  rows: WarehouseStockRow[] = [row(), NEGATIVE],
  s: WarehouseStockSummary = summary(),
): ReportResponse<WarehouseStockRow, WarehouseStockSummary> {
  return { data: rows, meta: { total: s.rows, limit: 100, offset: 0 }, summary: s, report: 'warehouse_stock' }
}

/** Movement analysis answers the rail's fast-moving card. */
const MOVEMENT_PAGE = {
  data: [
    { item_id: 12, item_name: 'Paracetamol 500mg', unit_symbol: 'Strip', period_out_qty: 1420 },
    { item_id: 44, item_name: 'Hand Sanitizer 500ml', unit_symbol: 'Bottle', period_out_qty: 980 },
    { item_id: 51, item_name: 'Never issued', unit_symbol: 'Box', period_out_qty: 0 },
  ],
  meta: { total: 3, limit: 5, offset: 0 },
  summary: {},
  report: 'movement_analysis',
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderRegister(initial = '/registers/warehouse-stock') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/registers/warehouse-stock"
          element={<ReportPage config={warehouseStockConfig} />}
        />
        <Route path="/registers/stock-ledger" element={<p>Stock ledger</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  fetchReport.mockReset()
  fetchReport.mockImplementation((path: string) =>
    Promise.resolve(path === 'movement-analysis' ? MOVEMENT_PAGE : page()),
  )
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

/* --------------------------------------------------------------------- tests */

describe('warehouse stock — the table', () => {
  it('shows the item with its group and SKU, and the warehouse it sits in', async () => {
    renderRegister()
    expect(await screen.findByText('Paracetamol 500mg Tablet')).toBeTruthy()
    expect(screen.getByText('Medicine')).toBeTruthy()
    expect(screen.getByText('MED-001')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Main store' }).length).toBeGreaterThan(0)
  })

  it('marks a negative row in red and badges it, so colour is never the only signal', async () => {
    const { container } = renderRegister()
    await screen.findByText('Vitamin D3 1000 IU')
    const body = container.querySelector('tbody') as HTMLElement
    // The word, not only the colour — a status nobody can see is not a status.
    expect(within(body).getByText('Negative')).toBeTruthy()
    expect(body.querySelectorAll('.text-red-600').length).toBeGreaterThan(0)
  })

  it('pins totals from the SERVER summary, not from the two rows on the page', async () => {
    const { container } = renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    const tfoot = container.querySelector('tfoot') as HTMLElement
    expect(within(tfoot).getByText('Total (248 rows)')).toBeTruthy()
    expect(within(tfoot).getByText('12,436')).toBeTruthy()
    expect(within(tfoot).getByText('387')).toBeTruthy()
    expect(within(tfoot).getByText('28,42,690.00')).toBeTruthy()
  })
})

describe('warehouse stock — dated figures versus live ones', () => {
  it('sends the As-at date, the valuation method and the zero-row toggle to the API', async () => {
    renderRegister('/registers/warehouse-stock?to=2026-09-19&method=FIFO')
    await waitFor(() => expect(fetchReport).toHaveBeenCalled())
    const call = fetchReport.mock.calls.find((c) => c[0] === 'warehouse-stock')!
    expect(call[1].to).toBe('2026-09-19')
    expect(call[1].method).toBe('FIFO')
    expect(call[1].nonzero).toBe('1')
  })

  it('never invents reserved or available on a back-dated read', async () => {
    // inv_stock_balances has no date dimension, so the server sends null and the
    // register has to say "not shown", not "zero".
    fetchReport.mockImplementation((path: string) =>
      Promise.resolve(
        path === 'movement-analysis'
          ? MOVEMENT_PAGE
          : page(
              [row({ reserved_qty: null, available_qty: null })],
              summary({ live_buckets: false, reserved_qty: null, available_qty: null }),
            ),
      ),
    )
    const { container } = renderRegister('/registers/warehouse-stock?to=2026-03-31')
    await screen.findByText('Paracetamol 500mg Tablet')
    const tfoot = container.querySelector('tfoot') as HTMLElement
    // The dated columns still total; the live ones are dashed rather than zeroed.
    expect(within(tfoot).getByText('12,436')).toBeTruthy()
    expect(within(tfoot).queryByText('0')).toBeNull()
    expect(within(tfoot).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})

describe('warehouse stock — the KPI strip', () => {
  it('reports the server figures, with the company currency on the value', async () => {
    renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    expect(screen.getByText('Total SKUs')).toBeTruthy()
    expect(screen.getByText('240')).toBeTruthy()
    expect(screen.getByText('Active warehouses')).toBeTruthy()
    expect(screen.getByText('₹ 28,42,690.00')).toBeTruthy()
  })

  it('offers one click to everything worth acting on, keeping the other filters', async () => {
    renderRegister('/registers/warehouse-stock?warehouse_id=4')
    await screen.findByText('Paracetamol 500mg Tablet')
    // 4 negative + 5 reorder + 3 low = 12
    const card = screen.getByRole('link', { name: /Open Needs attention/i })
    const href = card.getAttribute('href')!
    expect(href).toContain('health=attention')
    expect(href).toContain('warehouse_id=4')
  })

  it('carries a deterministic observation, and says where it came from', async () => {
    renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    expect(screen.getByText('4 lines show stock below zero.')).toBeTruthy()
    expect(screen.getByText('From your stock on this date — no estimates')).toBeTruthy()
  })
})

describe('warehouse stock — the intelligence rail', () => {
  it('shows distribution by share of value and says why it is not utilisation', async () => {
    renderRegister()
    await screen.findByText('Stock distribution')
    const rail = screen.getByRole('complementary', { name: 'Stock intelligence' })
    expect(within(rail).getByText('70%')).toBeTruthy()
    expect(within(rail).getByText('30%')).toBeTruthy()
    expect(within(rail).getByText(/Inventory records\s+no warehouse capacity/)).toBeTruthy()
  })

  it('ranks fast movers from movement analysis and drops the ones that never moved', async () => {
    renderRegister()
    await screen.findByText('Fast moving items')
    const rail = screen.getByRole('complementary', { name: 'Stock intelligence' })
    expect(await within(rail).findByText('Paracetamol 500mg')).toBeTruthy()
    expect(within(rail).getByText('Hand Sanitizer 500ml')).toBeTruthy()
    expect(within(rail).queryByText('Never issued')).toBeNull()
  })

  it('asks movement analysis for the thirty days that END at the As-at date', async () => {
    renderRegister('/registers/warehouse-stock?to=2026-09-19&warehouse_id=4')
    await waitFor(() =>
      expect(fetchReport.mock.calls.some((c) => c[0] === 'movement-analysis')).toBe(true),
    )
    const call = fetchReport.mock.calls.find((c) => c[0] === 'movement-analysis')!
    expect(call[1].to).toBe('2026-09-19')
    expect(call[1].from).toBe('2026-08-21')
    expect(call[1].warehouse_id).toBe('4')
  })

  it('hides the fast-moving card from a reader who may not open movement analysis', async () => {
    can.mockImplementation((key) => key !== 'reports.movement_analysis.read')
    renderRegister()
    await screen.findByText('Stock distribution')
    expect(screen.queryByText('Fast moving items')).toBeNull()
  })

  it('states current stock alerts, with no invented timestamps', async () => {
    renderRegister()
    await screen.findByText('Stock alerts')
    const rail = screen.getByRole('complementary', { name: 'Stock intelligence' })
    expect(within(rail).getByText('4 lines below zero')).toBeTruthy()
    expect(within(rail).getByText('5 items at the reorder point')).toBeTruthy()
    expect(within(rail).queryByText(/hours ago|days ago/)).toBeNull()
  })
})

describe('warehouse stock — saved views', () => {
  it('starts on Default and swaps the columns when another view is picked', async () => {
    renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    const select = screen.getByLabelText('View preset') as HTMLSelectElement
    expect(select.value).toBe('default')
    expect(screen.getByRole('columnheader', { name: /Unit cost/ })).toBeTruthy()

    fireEvent.change(select, { target: { value: 'availability' } })
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: /Unit cost/ })).toBeNull(),
    )
    expect(screen.getByRole('columnheader', { name: /Available/ })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toContain('view=availability')
  })

  it('restores a linked view on arrival', async () => {
    renderRegister('/registers/warehouse-stock?view=valuation')
    await screen.findByText('Paracetamol 500mg Tablet')
    await waitFor(() =>
      expect((screen.getByLabelText('View preset') as HTMLSelectElement).value).toBe('valuation'),
    )
    expect(screen.queryByRole('columnheader', { name: /Reserved/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /Method applied/ })).toBeTruthy()
  })
})

describe('warehouse stock — nothing to show', () => {
  const EMPTY = summary({
    rows: 0,
    items: 0,
    warehouses: 0,
    closing_qty: 0,
    closing_value: 0,
    reserved_qty: 0,
    available_qty: 0,
    by_warehouse: [],
    health: { negative: 0, out: 0, reorder: 0, low: 0, overstocked: 0, healthy: 0 },
    health_items: { negative: 0, out: 0, reorder: 0, low: 0, overstocked: 0, healthy: 0 },
  })

  beforeEach(() => {
    fetchReport.mockImplementation((path: string) =>
      Promise.resolve(path === 'movement-analysis' ? { ...MOVEMENT_PAGE, data: [] } : page([], EMPTY)),
    )
  })

  it('offers a way in when the company has simply never recorded stock', async () => {
    renderRegister()
    expect(await screen.findByText('No stock recorded yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an item' })).toBeTruthy()
  })

  it('offers no action a reader is not allowed to take', async () => {
    can.mockImplementation((key) => key !== 'masters.items.write')
    renderRegister()
    expect(await screen.findByText('No stock recorded yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an item' })).toBeNull()
  })

  it('says the register ran and found nothing, and offers to clear the filter', async () => {
    renderRegister('/registers/warehouse-stock?warehouse_id=4')
    expect(await screen.findByText('No warehouse stock found')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })
})

describe('warehouse stock — stock health', () => {
  it('sends the chosen health state to the API', async () => {
    renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    fireEvent.change(screen.getByLabelText('Stock health'), { target: { value: 'reorder' } })
    await waitFor(() => {
      const last = [...fetchReport.mock.calls].reverse().find((c) => c[0] === 'warehouse-stock')!
      expect(last[1].health).toBe('reorder')
    })
  })

  it('offers every state the server knows about, plus the set that matters', async () => {
    renderRegister()
    await screen.findByText('Paracetamol 500mg Tablet')
    const options = [...(screen.getByLabelText('Stock health') as HTMLSelectElement).options].map(
      (o) => o.value,
    )
    expect(options).toEqual([
      '',
      'attention',
      'negative',
      'out',
      'reorder',
      'low',
      'overstocked',
      'healthy',
    ])
  })
})
