import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { valuationRegister } from '../configs/opsRegisters'
import type { SnapshotQuery, ValuationSnapshotResponse } from '../../services/valuationApi'

/*
 * The upgraded valuation register, end to end: the real config through the real
 * engine, with only the network and the providers stubbed.
 *
 * The point of the file is the contract the analytics band is built on — that
 * every figure on the screen came out of `/v1/valuation` under the filters the
 * register was read with. So the snapshot spy records what it was asked, and
 * the tests assert on the questions as much as on the answers.
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
  { warehouse_id: 3, warehouse_name: 'Main store', warehouse_code: 'MS', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 4, warehouse_name: 'Overflow', warehouse_code: 'OF', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
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
  useFormOptions: () => ({
    options: { warehouses: WAREHOUSES, units: [], item_groups: [], stock_categories: [], brands: [] },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../registers/useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({ options: [], loading: false }),
}))

const snapshot = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return { ...actual, valuationApi: { ...actual.valuationApi, snapshot: (...args: unknown[]) => snapshot(...args) } }
})

const ROWS = [
  {
    item_id: 7,
    item_name: 'Test Item',
    item_alias: null,
    item_sku: 'TEST-001',
    unit_symbol: 'NOS',
    valuation_method: null,
    closing_qty: 523,
    unit_cost: 0.13,
    stock_value: 65.58,
    valuation_method_applied: 'FIFO',
  },
  {
    item_id: 9,
    item_name: 'Dimmy',
    item_alias: null,
    item_sku: 'DIM-001',
    unit_symbol: null,
    valuation_method: null,
    closing_qty: 442,
    unit_cost: 0.02,
    stock_value: 10.43,
    valuation_method_applied: 'FIFO',
  },
]

const SUMMARY = {
  as_of: '2026-09-16',
  method: 'AS_PER_MASTER',
  total_qty: 965,
  total_value: 76.02,
  item_count: 2,
}

function answer(query: SnapshotQuery): ValuationSnapshotResponse {
  // The per-warehouse replays answer with that warehouse's share, so the test
  // can tell a real breakdown from the company total drawn twice.
  const warehouseId = Number(query.warehouse_id ?? 0)
  const share = warehouseId === 3 ? 0.75 : warehouseId === 4 ? 0.25 : 1
  return {
    data: (query.limit ?? 50) <= 1 ? [] : ROWS,
    meta: { total: 2, limit: Number(query.limit ?? 50), offset: 0, page: 1, pages: 1 },
    summary: {
      ...SUMMARY,
      as_of: String(query.as_of ?? SUMMARY.as_of),
      method: String(query.method ?? SUMMARY.method),
      total_qty: SUMMARY.total_qty * share,
      total_value: Number((SUMMARY.total_value * share).toFixed(2)),
      item_count: warehouseId ? 1 : SUMMARY.item_count,
    },
  } as ValuationSnapshotResponse
}

function renderRegister(url = '/registers/valuation?as_of=2026-09-16') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/registers/valuation" element={<ReportPage config={valuationRegister} />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Every query the snapshot endpoint was asked, in call order. */
function queries(): SnapshotQuery[] {
  return snapshot.mock.calls.map((call) => call[0] as SnapshotQuery)
}

beforeEach(() => {
  can.mockReturnValue(true)
  snapshot.mockReset()
  snapshot.mockImplementation((query: SnapshotQuery) => Promise.resolve(answer(query)))
})

describe('valuation register', () => {
  it('names itself with a masthead, not just a breadcrumb', async () => {
    renderRegister()
    expect(await screen.findByRole('heading', { level: 1, name: 'Valuation register' })).toBeTruthy()
    // The panel header carries `shortDescription`, not the long one.
    expect(screen.getByText(/Item-wise stock valuation as at a date/)).toBeTruthy()
  })

  it('offers exactly the four methods the API accepts', async () => {
    renderRegister()
    const select = (await screen.findByLabelText('Method')) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual([
      'AS_PER_MASTER',
      'FIFO',
      'LIFO',
      'WAC',
    ])
  })

  it('puts the server summary in the KPI cards', async () => {
    renderRegister()
    const items = await screen.findByText('Total items')
    const card = (label: HTMLElement) => label.closest('.aic') as HTMLElement

    expect(within(card(items)).getByText('2')).toBeTruthy()
    expect(within(card(screen.getByText('Total quantity'))).getByText('965')).toBeTruthy()
    expect(within(card(screen.getByText('Total stock value'))).getByText('76.02')).toBeTruthy()
    // Two warehouses are in scope and no warehouse filter narrows it.
    const warehouses = card(screen.getByText('Warehouses'))
    expect(within(warehouses).getByText('2')).toBeTruthy()
    expect(within(warehouses).getByText('Whole company')).toBeTruthy()
  })

  /**
   * The register's OWN table.
   *
   * The analytics panel's trend chart renders its accessible data equivalent as
   * an `sr-only` table, which lands asynchronously — so a bare
   * `getByRole('table')` passes or throws "found multiple elements" depending on
   * whether the analytics request has resolved yet. Picking the table that is
   * not inside an `sr-only` wrapper makes these assertions describe the register
   * whatever the analytics are doing.
   */
  const registerTable = (): HTMLElement =>
    screen.getAllByRole('table').find((t) => !t.closest('.sr-only')) as HTMLElement

  it('renders the item code and the row figures', async () => {
    renderRegister()
    expect(await screen.findByText('TEST-001')).toBeTruthy()
    // Scoped to the table: an item name also appears in the donut's legend, so
    // an unscoped lookup matches twice as soon as the analytics have loaded.
    const table = within(registerTable())
    expect(table.getByText('DIM-001')).toBeTruthy()
    expect(table.getByText('Test Item')).toBeTruthy()
    expect(table.getByText('523')).toBeTruthy()
    expect(table.getByText('65.58')).toBeTruthy()
  })

  it('totals from the server summary, not from the rows on screen', async () => {
    renderRegister()
    // Wait on a row rather than on the table itself: the analytics panel also
    // renders an sr-only data table, so `findByRole('table')` is a race.
    await screen.findByText('TEST-001')
    const table = registerTable()
    const foot = table.querySelector('tfoot')
    expect(foot).toBeTruthy()
    expect(within(foot as HTMLElement).getByText('Total (2 items)')).toBeTruthy()
    expect(within(foot as HTMLElement).getByText('965')).toBeTruthy()
    expect(within(foot as HTMLElement).getByText('76.02')).toBeTruthy()
  })

  it('draws the three analytics cards', async () => {
    renderRegister()
    expect(await screen.findByText('Stock value trend')).toBeTruthy()
    expect(screen.getByText('Valuation by item')).toBeTruthy()
    expect(screen.getByText('Valuation by warehouse')).toBeTruthy()
  })

  it('asks the valuation endpoint for every figure it charts', async () => {
    renderRegister()
    await screen.findByText('Stock value trend')
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(4))

    // The trend asks about a series of dates, each one a real request.
    const dates = new Set(queries().map((q) => String(q.as_of)))
    expect(dates.size).toBeGreaterThan(1)
    expect(dates.has('2026-09-16')).toBe(true)

    // The warehouse split replays per warehouse rather than borrowing another
    // report's breakdown, so it honours the method the reader chose.
    const replayed = queries().filter((q) => q.warehouse_id !== undefined)
    expect(replayed.map((q) => q.warehouse_id).sort()).toEqual([3, 4])

    // Nothing is asked under a method other than the one on screen.
    expect(queries().every((q) => q.method === 'AS_PER_MASTER')).toBe(true)
  })

  it('carries the chosen method into every analytics request', async () => {
    renderRegister('/registers/valuation?as_of=2026-09-16&method=FIFO')
    await screen.findByText('Stock value trend')
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(4))
    expect(queries().every((q) => q.method === 'FIFO')).toBe(true)
  })

  it('keeps every trend date inside the financial year', async () => {
    renderRegister()
    await screen.findByText('Stock value trend')
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(4))
    expect(queries().every((q) => String(q.as_of) >= '2026-04-01')).toBe(true)
    expect(queries().every((q) => String(q.as_of) <= '2026-09-16')).toBe(true)
  })

  it('reads the summary with one row rather than pulling a page it will not show', async () => {
    renderRegister()
    await screen.findByText('Valuation by warehouse')
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(4))
    const replayed = queries().filter((q) => q.warehouse_id !== undefined)
    expect(replayed.every((q) => q.limit === 1)).toBe(true)
  })

  it('takes the top items from the server, sorted, not from the page on screen', async () => {
    renderRegister()
    await screen.findByText('Valuation by item')
    await waitFor(() => {
      const sorted = queries().filter((q) => q.sort === 'stock_value')
      expect(sorted.length).toBeGreaterThan(0)
      expect(sorted[0].order).toBe('desc')
    })
  })

  it('offers the quick guide, and the method settings only with settings.read', async () => {
    renderRegister()
    expect(await screen.findByRole('button', { name: /quick guide/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /method settings/i })).toBeTruthy()

    can.mockImplementation((key: string) => key !== 'settings.read')
    renderRegister()
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /method settings/i })).toHaveLength(1)
    })
  })

  it('offers Add item only to a member who may maintain items', async () => {
    renderRegister()
    expect(await screen.findByRole('link', { name: /add item/i })).toBeTruthy()

    can.mockImplementation((key: string) => key !== 'masters.items.write')
    renderRegister()
    await waitFor(() => {
      // One from the first render, none from the second.
      expect(screen.queryAllByRole('link', { name: /add item/i })).toHaveLength(1)
    })
  })

  it('subtotals the rows a reader ticks, against the server total', async () => {
    renderRegister()
    await screen.findByText('Test Item')

    // Both rows: 523 + 442 units, 65.58 + 10.43 of a 76.02 total.
    for (const box of screen.getAllByRole('checkbox', { name: /^Select item \d+$/ })) {
      fireEvent.click(box)
    }

    expect(await screen.findByText('2 selected')).toBeTruthy()
    const bar = screen.getByText('2 selected').parentElement as HTMLElement
    expect(within(bar).getByText(/965/)).toBeTruthy()
    expect(within(bar).getByText('76.01')).toBeTruthy()
    expect(within(bar).getByText(/100\.0% of stock value/)).toBeTruthy()
    // The selection gets the shared export menu, so it offers the same formats
    // the register does rather than a thinner path of its own.
    expect(within(bar).getByRole('button', { name: /^export$/i })).toBeTruthy()
  })

  it('states the share of the whole filtered set, not of the page', async () => {
    renderRegister()
    await screen.findByText('Test Item')
    // Dimmy is item 9; the header's "select every row" box is not a row.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select item 9' }))

    // Dimmy alone is 10.43 of the 76.02 the server reported for every matching
    // row — not half, which is what a share of the page would have said.
    const bar = (await screen.findByText('1 selected')).parentElement as HTMLElement
    expect(within(bar).getByText(/13\.7% of stock value/)).toBeTruthy()
  })

  it('keeps the checkbox out of the columns the exports write', () => {
    const keys = valuationRegister.columns.map((c) => c.key)
    expect(keys).not.toContain('__select')
    expect(keys).not.toContain('__actions')
  })

  it('says so plainly when the date and filters have nothing to value', async () => {
    snapshot.mockImplementation((query: SnapshotQuery) =>
      Promise.resolve({
        ...answer(query),
        data: [],
        meta: { total: 0, limit: 50, offset: 0, page: 1, pages: 0 },
        summary: { ...SUMMARY, total_qty: 0, total_value: 0, item_count: 0 },
      } as ValuationSnapshotResponse),
    )
    renderRegister()
    expect(
      await screen.findByText(/No stock valuation is available for the selected date and filters/),
    ).toBeTruthy()
  })

  it('leaves the register readable when an analytics request fails', async () => {
    // The band's own calls are the ones asking for a single row; the register's
    // page request is not, so only the charts are made to fail here.
    snapshot.mockImplementation((query: SnapshotQuery) =>
      query.limit === 1
        ? Promise.reject(new Error('valuation service unavailable'))
        : Promise.resolve(answer(query)),
    )
    renderRegister()
    expect(await screen.findByText('Test Item')).toBeTruthy()
    expect(screen.getByText('Total items')).toBeTruthy()
  })
})
