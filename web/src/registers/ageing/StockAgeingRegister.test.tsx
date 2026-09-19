import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { stockAgeingConfig } from '../../reports/configs/stockAgeing'
import type { ListQuery } from '../../services/api'
import type { StockAgeingRow, StockAgeingSummary } from '../../services/reportsApi'

/*
 * The revamped stock ageing register, end to end: the real config through the real
 * engine, with only the network and the providers stubbed.
 *
 * What these tests are actually protecting is the promise the screen makes — that every
 * figure on it, from the health score to the donut to the footer, came out of ONE
 * `/v1/reports/stock-ageing` response fetched under the filters in the URL. So the fetch
 * spy records what it was asked, and the tests assert on the questions as much as on the
 * answers: a chart that quietly re-queried, or a card that made a number up, would pass a
 * screenshot review and fail here.
 */

const can = vi.fn((_key: string) => true)

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Demo Company',
    fy: { label: 'FY 2026-27' },
    branch: null,
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Demo Company · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const WAREHOUSES = [
  { warehouse_id: 3, warehouse_name: 'Main WH', warehouse_code: 'MS', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 4, warehouse_name: 'Yard', warehouse_code: 'YD', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
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
      warehouses: WAREHOUSES,
      units: [],
      item_groups: [{ item_grp_id: 3, grp_name: 'Electrical' }],
      stock_categories: [],
      brands: [],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const fetchReport = vi.fn()

vi.mock('../../services/reportsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reportsApi')>()
  return { ...actual, fetchReport: (...args: unknown[]) => fetchReport(...args) }
})

/* ------------------------------------------------------------------ fixture */

function bucketsOf(pairs: Partial<Record<string, [number, number]>>): StockAgeingRow['buckets'] {
  const out = {} as StockAgeingRow['buckets']
  for (const key of ['0_30', '31_60', '61_90', '91_180', '180_plus'] as const) {
    const [qty, value] = pairs[key] ?? [0, 0]
    out[key] = { qty, value }
  }
  return out
}

const ROWS: StockAgeingRow[] = [
  {
    item_id: 1,
    item_name: 'LED Panel Light 12W',
    item_alias: null,
    item_sku: 'ITM-001',
    hsn_sac: '940540',
    unit_id: 1,
    unit_symbol: 'Nos',
    item_grp_id: 3,
    grp_name: 'Electrical',
    stock_cat_id: null,
    warehouse_id: 3,
    warehouse_name: 'Main WH',
    buckets: bucketsOf({ '0_30': [120, 36000], '91_180': [20, 6000] }),
    total_qty: 140,
    total_value: 42000,
    oldest_days: 120,
    newest_days: 4,
    weighted_age_days: 26,
    layers: 4,
    aged_from: null,
    health_status: 'slow',
  },
  {
    item_id: 2,
    item_name: 'PVC Pipe 1 inch',
    item_alias: null,
    item_sku: 'ITM-002',
    hsn_sac: '391723',
    unit_id: 2,
    unit_symbol: 'Mtr',
    item_grp_id: 3,
    grp_name: 'Electrical',
    stock_cat_id: null,
    warehouse_id: 4,
    warehouse_name: 'Yard',
    buckets: bucketsOf({ '180_plus': [100, 5000] }),
    total_qty: 100,
    total_value: 5000,
    oldest_days: 400,
    newest_days: 200,
    weighted_age_days: 260,
    layers: 1,
    aged_from: null,
    health_status: 'obsolete',
  },
]

const SUMMARY: StockAgeingSummary = {
  items: 2,
  total_qty: 240,
  total_value: 47000,
  buckets: {
    '0_30': { qty: 120, value: 36000, items: 1 },
    '31_60': { qty: 0, value: 0, items: 0 },
    '61_90': { qty: 0, value: 0, items: 0 },
    '91_180': { qty: 20, value: 6000, items: 0 },
    '180_plus': { qty: 100, value: 5000, items: 1 },
  },
  bucket_labels: {
    '0_30': '0-30 days',
    '31_60': '31-60 days',
    '61_90': '61-90 days',
    '91_180': '91-180 days',
    '180_plus': '180+ days',
  },
  as_of: '2026-09-19',
  weighted_age_days: 123,
  oldest_days: 400,
  by_health: {
    fresh: { items: 0, value: 0 },
    healthy: { items: 0, value: 0 },
    watch: { items: 0, value: 0 },
    slow: { items: 1, value: 42000 },
    obsolete: { items: 1, value: 5000 },
  },
  by_warehouse: [
    { warehouse_id: 3, warehouse_name: 'Main WH', items: 1, qty: 140, value: 42000, value_over_90: 6000, value_over_180: 0 },
    { warehouse_id: 4, warehouse_name: 'Yard', items: 1, qty: 100, value: 5000, value_over_90: 5000, value_over_180: 5000 },
  ],
  by_item_group: [
    { item_grp_id: 3, grp_name: 'Electrical', items: 2, qty: 240, value: 47000, value_over_90: 11000, value_over_180: 5000 },
  ],
  age_bucket: null,
  health: null,
}

function answer(query: ListQuery) {
  // The band filter narrows the rows AND the figures, exactly as the service does, so a
  // test can tell a real filter from a chart that only dimmed some bars.
  const band = query.age_bucket as string | undefined
  const rows = band ? ROWS.filter((r) => (r.buckets[band as '0_30']?.qty ?? 0) > 0) : ROWS
  return Promise.resolve({
    data: rows,
    meta: { total: rows.length, limit: Number(query.limit ?? 50), offset: 0, page: 1, pages: 1 },
    summary: {
      ...SUMMARY,
      items: rows.length,
      age_bucket: (band ?? null) as StockAgeingSummary['age_bucket'],
    },
    report: 'stock_ageing',
  })
}

function renderRegister(url = '/registers/stock-ageing?as_of=2026-09-19') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/registers/stock-ageing" element={<ReportPage config={stockAgeingConfig} />} />
        <Route path="/registers/stock-ledger" element={<p>Stock ledger</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Every query the report endpoint was asked, in call order. */
function queries(): ListQuery[] {
  return fetchReport.mock.calls.map((call) => call[1] as ListQuery)
}

beforeEach(() => {
  can.mockReturnValue(true)
  fetchReport.mockReset()
  fetchReport.mockImplementation((_path: string, query: ListQuery) => answer(query))
})

/* -------------------------------------------------------------------- tests */

describe('stock ageing register', () => {
  it('names itself with a masthead and the capital-at-risk subtitle', async () => {
    renderRegister()
    expect(await screen.findByRole('heading', { level: 1, name: 'Stock ageing' })).toBeTruthy()
    expect(screen.getByText(/identify capital at risk/i)).toBeTruthy()
  })

  it('asks the endpoint once, with the filters from the URL', async () => {
    renderRegister('/registers/stock-ageing?as_of=2026-09-19&warehouse_id=3')
    await screen.findByText('LED Panel Light 12W')
    expect(fetchReport).toHaveBeenCalledTimes(1)
    expect(queries()[0]).toMatchObject({ as_of: '2026-09-19', warehouse_id: '3', page: 1 })
  })

  it('puts the five KPI cards over the table, at-risk ones as counts', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    expect(screen.getByText('Total items')).toBeTruthy()
    expect(screen.getByText('Total quantity')).toBeTruthy()
    expect(screen.getByText('Total stock value')).toBeTruthy()
    expect(screen.getByText(/Slow moving · 91–180 days/)).toBeTruthy()
    expect(screen.getByText(/Obsolete · 180\+ days/)).toBeTruthy()
    // 5,000 of 47,000 is 10.6% — the card states the share, never a guess. The metric
    // card beside it quotes the same figure, so both are matched.
    expect(screen.getAllByText(/10\.6% of stock value/).length).toBeGreaterThan(0)
  })

  it('scores the stock health from the same buckets, and shows the arithmetic on request', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    // 12.77% at 91-180 (x25 = 3.19) + 10.64% past 180 (x60 = 6.38) = 90 after rounding.
    expect(screen.getByText('90')).toBeTruthy()
    expect(screen.getByText('Excellent')).toBeTruthy()

    const explain = screen.getByRole('button', { name: /How is this calculated/i })
    expect(explain.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(explain)
    expect(explain.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/less a fixed penalty for the share of stock/i)).toBeTruthy()
    expect(screen.getByText('×60')).toBeTruthy()
    // Nothing on this screen may claim the score is anything but a stated rule.
    expect(document.body.textContent).not.toMatch(/\bAI\b|machine learning|predict/i)
  })

  it('draws both charts from the response it already has — never a second request', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    expect(screen.getByRole('region', { name: 'Stock ageing analytics' })).toBeTruthy()
    expect(screen.getByText('Stock value ageing distribution')).toBeTruthy()
    // The card heading, plus the caption on the hidden table that carries its figures.
    expect(screen.getAllByText('Items by ageing band').length).toBe(2)
    expect(fetchReport).toHaveBeenCalledTimes(1)
  })

  it('ships every chart with the table that IS its data, for a screen reader', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const captions = screen.getAllByText('Stock value by ageing band')
    expect(captions.length).toBeGreaterThan(0)
    const table = captions[0].closest('table')!
    expect(within(table).getByRole('rowheader', { name: '180+ days' })).toBeTruthy()
    // Colour is never the only signal: the band is named in the figures themselves.
    expect(within(table).getByRole('rowheader', { name: '0–30 days' })).toBeTruthy()
  })

  it('switches the distribution between value, quantity and items', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    fireEvent.click(screen.getByRole('tab', { name: 'Quantity' }))
    await waitFor(() => expect(screen.getAllByText('Quantity by ageing band').length).toBeGreaterThan(0))
    // A view of the same answer, not a new question.
    expect(fetchReport).toHaveBeenCalledTimes(1)
  })

  it('filters the register from a band, and offers the way back out', async () => {
    renderRegister()
    await screen.findByText('PVC Pipe 1 inch')

    const band = screen.getAllByRole('button', { name: /180\+ days.*Select to filter/i })[0]
    fireEvent.click(band)

    await waitFor(() => expect(screen.queryByText('LED Panel Light 12W')).toBeNull())
    expect(screen.getByText('PVC Pipe 1 inch')).toBeTruthy()
    expect(queries().at(-1)).toMatchObject({ age_bucket: '180_plus' })
    // The band already applied says how to clear it, rather than silently re-applying.
    expect(screen.getAllByRole('button', { name: /180\+ days.*select to clear/i }).length).toBeGreaterThan(0)
  })

  it('carries the as-at date through a band click, and drops the page', async () => {
    renderRegister('/registers/stock-ageing?as_of=2026-09-19&warehouse_id=3&page=3')
    await screen.findByText('PVC Pipe 1 inch')
    fireEvent.click(screen.getAllByRole('button', { name: /180\+ days.*Select to filter/i })[0])
    await waitFor(() => expect(queries().at(-1)).toMatchObject({ age_bucket: '180_plus' }))
    expect(queries().at(-1)).toMatchObject({ as_of: '2026-09-19', warehouse_id: '3', page: 1 })
  })

  it('pairs each band into one cell — quantity over value', async () => {
    renderRegister()
    const name = await screen.findByText('LED Panel Light 12W')
    const row = name.closest('tr')!
    expect(within(row).getByText('120')).toBeTruthy()
    expect(within(row).getByText('36,000.00')).toBeTruthy()
    expect(within(row).getByText('940540')).toBeTruthy()
    expect(within(row).getByText('Nos')).toBeTruthy()
  })

  it('states the health word beside its colour, never instead of it', async () => {
    renderRegister()
    const row = (await screen.findByText('PVC Pipe 1 inch')).closest('tr')!
    expect(within(row).getByText('Obsolete')).toBeTruthy()
    const other = (await screen.findByText('LED Panel Light 12W')).closest('tr')!
    expect(within(other).getByText('Slow moving')).toBeTruthy()
  })

  it('offers only the ageing bands and health words the endpoint accepts', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    fireEvent.click(screen.getByRole('button', { name: /More filters/i }))
    const band = (await screen.findByLabelText('Ageing band')) as HTMLSelectElement
    expect([...band.options].map((o) => o.value)).toEqual([
      '',
      '0_30',
      '31_60',
      '61_90',
      '91_180',
      '180_plus',
    ])
    const health = screen.getByLabelText('Stock health') as HTMLSelectElement
    expect([...health.options].map((o) => o.value)).toEqual([
      '',
      'fresh',
      'healthy',
      'watch',
      'slow',
      'obsolete',
    ])
  })

  it('totals the whole filtered set in the footer, not the page on screen', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const footer = document.querySelector('tfoot')!
    expect(footer.textContent).toContain('47,000.00')
    expect(footer.textContent).toContain('123 d')
    expect(footer.textContent).toContain('2 items')
  })

  it('says what the register is showing, in words, from the same summary', async () => {
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    const strip = screen.getByRole('region', { name: 'At a glance' })
    expect(within(strip).getByText(/11,000\.00 older than 90 days/)).toBeTruthy()
    expect(within(strip).getByText(/123 days average age/)).toBeTruthy()
    // Ranked by the aged value, not by the size of the holding: Main WH carries 6,000
    // past 90 days against the Yard's 5,000.
    expect(within(strip).getByText(/Main WH holds the oldest stock/)).toBeTruthy()
    // Never a comparison the endpoint did not compute.
    expect(strip.textContent).not.toMatch(/vs |previous|last month/i)
  })

  it('tells an empty register to widen the filters, with a way to clear them', async () => {
    fetchReport.mockImplementation(() =>
      Promise.resolve({
        data: [],
        meta: { total: 0, limit: 50, offset: 0, page: 1, pages: 0 },
        summary: { ...SUMMARY, items: 0, total_qty: 0, total_value: 0 },
        report: 'stock_ageing',
      }),
    )
    renderRegister('/registers/stock-ageing?as_of=2026-09-19&health=fresh')
    expect(await screen.findByText('No rows match these filters')).toBeTruthy()
    expect(screen.getByText(/Try widening the ageing band/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('asks a reader with no stock at all to move the date, not to clear a filter', async () => {
    fetchReport.mockImplementation(() =>
      Promise.resolve({
        data: [],
        meta: { total: 0, limit: 50, offset: 0, page: 1, pages: 0 },
        summary: { ...SUMMARY, items: 0, total_qty: 0, total_value: 0 },
        report: 'stock_ageing',
      }),
    )
    renderRegister('/registers/stock-ageing')
    expect(await screen.findByText('No stock on hand at this date')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('offers a retry on a failed load, and says the filters were kept', async () => {
    fetchReport.mockImplementation(() => Promise.reject(new TypeError('network down')))
    renderRegister()
    expect(await screen.findByText(/Unable to load items/i)).toBeTruthy()
    expect(screen.getByText(/filters have been preserved/i)).toBeTruthy()
    // Never the stack, the SQL or the internals.
    expect(document.body.textContent).not.toContain('network down')
  })

  it('drills a row through to that item’s ledger', async () => {
    renderRegister()
    const row = (await screen.findByText('LED Panel Light 12W')).closest('tr')!
    fireEvent.doubleClick(row)
    expect(await screen.findByText('Stock ledger')).toBeTruthy()
  })

  it('hides the row menu’s entries behind the permissions they need', async () => {
    can.mockImplementation((key: string) => key !== 'reports.valuation.read')
    renderRegister()
    await screen.findByText('LED Panel Light 12W')
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0])
    expect(await screen.findByRole('menuitem', { name: /View stock ledger/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /View item valuation/ })).toBeNull()
  })
})
