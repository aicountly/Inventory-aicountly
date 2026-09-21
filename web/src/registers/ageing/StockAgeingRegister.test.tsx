import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { stockAgeingConfig } from '../../reports/configs/analysisReports'
import type { ReportResponse, StockAgeingRow, StockAgeingSummary } from '../../services/reportsApi'

/*
 * The Stock Ageing register end to end: the real config on the real engine, with only
 * the network and the app's providers stubbed.
 *
 * The point of testing the whole screen rather than its parts is that the parts are
 * declarations — what has to hold is that the engine turns them into a register whose
 * cards, charts, cells and footer all describe the SAME filtered set, and that the
 * things a reader depends on (export, print, column choice, pagination, the empty
 * state) survive the revamp.
 */

const can = vi.fn((_key?: string | readonly string[]) => true)

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Aicountly Interactive Services Pvt Ltd',
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
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main WH' }],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main WH',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 4, grp_name: 'Electrical components' }],
      stock_categories: [],
      brands: [{ brand_id: 7, brand_name: 'Havells' }],
      units: [],
      warehouses: [],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const fetchReport = vi.fn()
vi.mock('../../services/reportsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/reportsApi')>()),
  fetchReport: (...args: unknown[]) => fetchReport(...args),
}))

function row(over: Partial<StockAgeingRow> = {}): StockAgeingRow {
  return {
    item_id: 1,
    item_name: 'LED Panel Light 12W',
    item_alias: null,
    item_sku: 'ITM-001',
    unit_id: 1,
    unit_symbol: 'Nos',
    item_grp_id: 4,
    grp_name: 'Electrical components',
    stock_cat_id: null,
    cat_name: null,
    brand_id: 7,
    brand_name: 'Havells',
    hsn_sac: '940540',
    warehouse_id: 3,
    warehouse_name: 'Main WH',
    buckets: {
      '0_30': { qty: 120, value: 36000 },
      '31_60': { qty: 80, value: 24000 },
      '61_90': { qty: 40, value: 12000 },
      '91_180': { qty: 20, value: 6000 },
      '180_plus': { qty: 10, value: 3000 },
    },
    total_qty: 270,
    total_value: 81000,
    oldest_days: 260,
    newest_days: 3,
    weighted_age_days: 52,
    health_status: 'fresh',
    layers: 9,
    aged_from: null,
    ...over,
  }
}

const SUMMARY: StockAgeingSummary = {
  items: 428,
  total_qty: 12480,
  total_value: 4876920,
  buckets: {
    '0_30': { qty: 5200, value: 1860000, items: 162 },
    '31_60': { qty: 3100, value: 1120000, items: 98 },
    '61_90': { qty: 2035, value: 940000, items: 67 },
    '91_180': { qty: 1145, value: 535370, items: 64 },
    '180_plus': { qty: 1000, value: 421550, items: 37 },
  },
  bucket_labels: {
    '0_30': '0-30 days',
    '31_60': '31-60 days',
    '61_90': '61-90 days',
    '91_180': '91-180 days',
    '180_plus': '180+ days',
  },
  as_of: '2026-09-19',
  weighted_age_days: 67,
  oldest_days: 412,
  value_over_90: 956920,
  value_over_180: 421550,
  qty_over_90: 2145,
  qty_over_180: 1000,
  by_health: { fresh: 200, healthy: 127, watch: 64, slow: 0, obsolete: 37 },
  health_score: 82,
  health_band: 'healthy',
  age_bucket: null,
  health_status: null,
  warehouses: [
    { warehouse_id: 3, warehouse_name: 'Main WH', total_qty: 9000, total_value: 3000000, value_over_90: 580000, value_over_180: 260000, weighted_age_days: 74 },
  ],
  item_groups: [
    { item_grp_id: 4, grp_name: 'Electrical components', total_qty: 2100, total_value: 900000, value_over_90: 310000, value_over_180: 190000, weighted_age_days: 96 },
  ],
}

function response(
  rows: StockAgeingRow[],
  total = rows.length,
  summary: StockAgeingSummary = SUMMARY,
): ReportResponse<StockAgeingRow, StockAgeingSummary> {
  return { data: rows, meta: { total, limit: 50, offset: 0 }, summary, report: 'stock_ageing' }
}

function Probe() {
  const { search } = useLocation()
  return <output data-testid="url">{search}</output>
}

function renderRegister(initial = '/registers/stock-ageing') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Probe />
      <Routes>
        <Route path="/registers/stock-ageing" element={<ReportPage config={stockAgeingConfig} />} />
        <Route path="/registers/stock-ledger" element={<p>Stock ledger</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  fetchReport.mockReset()
  fetchReport.mockResolvedValue(response([row(), row({ item_id: 2, item_name: 'PVC Pipe 1 inch', item_sku: 'ITM-002', health_status: 'obsolete' })]))
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('the Stock Ageing register', () => {
  it('leads with its own title and the capital-at-risk subtitle', async () => {
    renderRegister()
    expect(await screen.findByText('LED Panel Light 12W')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Stock ageing', level: 1 })).toBeTruthy()
    expect(
      screen.getByText(/analyse how long your inventory has been in stock and identify capital at risk/i),
    ).toBeTruthy()
  })

  it('keeps the breadcrumb back to Registers', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Registers' })).toBeTruthy()
    expect(within(trail).getByText('Stock ageing')).toBeTruthy()
  })

  it('states the five KPIs from the server summary, not from the page of rows', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    // 428 items and ₹48.76 L of value, over a page that holds two rows worth ₹1.62 L.
    // 428 appears on the KPI card and again in the donut's centre, which is the point.
    expect(screen.getAllByText('428').length).toBeGreaterThan(0)
    // Once on the card, once in the pinned footer — both speak for all 428 items.
    expect(screen.getAllByText('48,76,920.00').length).toBeGreaterThan(1)
    expect(screen.getByText('64 items')).toBeTruthy()
    expect(screen.getByText('37 items')).toBeTruthy()
  })

  it('links the slow and obsolete cards at the band they count', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.includes('age_bucket=91_180'))).toBe(true)
    expect(hrefs.some((h) => h.includes('age_bucket=180_plus'))).toBe(true)
  })

  it('drills a card down ON TOP of the filters already set, never instead of them', async () => {
    renderRegister('/registers/stock-ageing?as_of=2026-03-31&warehouse_id=3')
    await screen.findByText('LED Panel Light 12W')
    const card = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .find((h) => h.includes('age_bucket=180_plus')) as string
    const params = new URLSearchParams(card.split('?')[1])
    expect(params.get('as_of')).toBe('2026-03-31')
    expect(params.get('warehouse_id')).toBe('3')
    expect(params.get('age_bucket')).toBe('180_plus')
  })

  it('pairs each band’s quantity and value in one cell and badges the row’s health', async () => {
    renderRegister()
    // Scoped to the row itself: the chart ships its own sr-only table of the same
    // figures, and a query over the whole document would find either.
    const first = (await screen.findByText('LED Panel Light 12W')).closest('tr') as HTMLElement
    const cells = within(first).getAllByRole('cell')
    const bucket = cells.find((c) => c.textContent === '12036,000.00')
    expect(bucket, '0-30 days should carry 120 units and ₹36,000 in one cell').toBeTruthy()
    expect(within(first).getByText('940540')).toBeTruthy()
    expect(within(first).getByText('Fresh')).toBeTruthy()
    expect(within(first).getByText('52 d')).toBeTruthy()
    const second = screen.getByText('PVC Pipe 1 inch').closest('tr') as HTMLElement
    expect(within(second).getByText('Obsolete')).toBeTruthy()
  })

  it('pins a footer that totals the whole filtered set', async () => {
    const { container } = renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const tfoot = container.querySelector('tfoot') as HTMLElement
    expect(within(tfoot).getByText('Total (428 items)')).toBeTruthy()
    expect(within(tfoot).getByText('4,21,550.00')).toBeTruthy()
    expect(within(tfoot).getByText('67 d')).toBeTruthy()
  })

  it('states only deterministic observations in the at-a-glance strip', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const strip = screen.getByRole('region', { name: /at a glance/i })
    expect(within(strip).getByText(/older than 90 days/)).toBeTruthy()
    expect(within(strip).getByText('67 days weighted average age')).toBeTruthy()
    expect(within(strip).getByText(/Main WH holds the most ageing stock/)).toBeTruthy()
    expect(within(strip).getByText(/Electrical components carries the largest 180\+ exposure/)).toBeTruthy()
    expect(within(strip).getByText('37 items are classed obsolete')).toBeTruthy()
  })

  it('withholds the warehouse and group observations while a drill-down narrows the rows', async () => {
    fetchReport.mockResolvedValue(
      response([row()], 37, { ...SUMMARY, age_bucket: '180_plus', warehouses: [], item_groups: [] }),
    )
    renderRegister('/registers/stock-ageing?age_bucket=180_plus')
    await screen.findByText('LED Panel Light 12W')
    const strip = screen.getByRole('region', { name: /at a glance/i })
    expect(within(strip).queryByText(/holds the most ageing stock/)).toBeNull()
    expect(within(strip).queryByText(/largest 180\+ exposure/)).toBeNull()
  })

  it('keeps export, print, refresh and column choice on the header', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    expect(screen.getAllByRole('button', { name: /customize columns/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^print/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy()
  })

  it('offers the ageing band and health filters the drill-downs write', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }))
    expect(screen.getByLabelText('Ageing band')).toBeTruthy()
    expect(screen.getByLabelText('Health')).toBeTruthy()
  })

  it('asks the endpoint for the band a drill-down selected', async () => {
    renderRegister('/registers/stock-ageing?age_bucket=180_plus')
    await screen.findByText('LED Panel Light 12W')
    await waitFor(() => {
      const query = fetchReport.mock.calls.at(-1)?.[1] as Record<string, string>
      expect(query.age_bucket).toBe('180_plus')
    })
  })

  it('offers a way out when the filters match nothing', async () => {
    fetchReport.mockResolvedValue(
      response([], 0, { ...SUMMARY, items: 0, total_value: 0, total_qty: 0 }),
    )
    renderRegister('/registers/stock-ageing?age_bucket=180_plus')
    expect(await screen.findByText('No rows match these filters')).toBeTruthy()
    expect(screen.getByText(/try widening the ageing band/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeTruthy()
  })

  it('tells a company with no stock that nothing has been received, not that it over-filtered', async () => {
    fetchReport.mockResolvedValue(
      response([], 0, { ...SUMMARY, items: 0, total_value: 0, total_qty: 0 }),
    )
    renderRegister()
    expect(await screen.findByText('No stock on hand at this date')).toBeTruthy()
  })

  it('keeps the reader’s filters and offers a retry when the fetch fails', async () => {
    fetchReport.mockRejectedValue(new Error('boom'))
    renderRegister('/registers/stock-ageing?warehouse_id=3')
    expect(await screen.findByText(/unable to load items/i)).toBeTruthy()
    expect(screen.getByText(/your filters have been preserved/i)).toBeTruthy()
    // Never the internals: "boom" is a TypeError's text, not a message for a reader.
    expect(screen.queryByText(/boom/)).toBeNull()
  })

  it('groups the rows on screen and says the subtotal is a page figure', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'health_status' } })
    expect(await screen.findByText(/Fresh · Total \(1 item\) on this page/)).toBeTruthy()
    expect(screen.getByText(/Obsolete · Total \(1 item\) on this page/)).toBeTruthy()
  })
})
