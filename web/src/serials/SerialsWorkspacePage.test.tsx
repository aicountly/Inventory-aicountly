import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../ui/ToastContext'
import { SerialsWorkspacePage } from './SerialsWorkspacePage'
import type { Serial, SerialQuery, SerialSummary } from '../services/masters'

/*
 * The workspace against a fake API.
 *
 * Everything below asserts a promise the screen makes to the person using it:
 * the counters describe the rows, a withheld cost is absent rather than hidden,
 * an empty result says which kind of empty it is, and a failure in one half of
 * the page does not take the other half with it.
 */

const can = vi.fn<(key: string) => boolean>(() => true)
vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 9, bo_id: 0, acs_type: null },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '',
    logo: null,
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 3, grp_name: 'Laptops' }],
      stock_categories: [],
      brands: [],
      units: [],
      warehouses: [
        { warehouse_id: 12, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
        { warehouse_id: 13, warehouse_name: 'Delhi Warehouse', warehouse_code: 'DEL', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
      ],
      valuation_methods: [],
      default_valuation_method: 'FIFO',
      negative_stock_policies: [],
      itc_eligibility_options: [],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: vi.fn(),
}))

const listSpy = vi.fn()
const summarySpy = vi.fn()
const historySpy = vi.fn()

vi.mock('../services/masters', async () => {
  const actual = await vi.importActual<typeof import('../services/masters')>('../services/masters')
  return {
    ...actual,
    serialsApi: {
      list: (query: SerialQuery) => listSpy(query),
      summary: (query: SerialQuery) => summarySpy(query),
      history: (id: number) => historySpy(id),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      bulkCreate: vi.fn(),
      bulkUpdate: vi.fn(),
    },
    batchesApi: { ...actual.batchesApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
    locationsApi: { ...actual.locationsApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
  }
})

const ROWS: Serial[] = [
  {
    serial_id: 1,
    item_id: 5,
    serial_no: 'SN-AP-MBP-00125',
    batch_id: 7,
    warehouse_id: 12,
    location_id: 4,
    status: 'in_stock',
    unit_cost: 189900,
    warranty_until: '2029-04-15',
    attributes: null,
    item_name: 'MacBook Pro 14"',
    item_sku: 'MBP14-M3P',
    warehouse_name: 'Main Warehouse',
    warehouse_code: 'MAIN',
    batch_no: 'B-MBP-2026',
    location_code: 'R-01-A1',
    created_at: '2026-04-02 09:00:00',
    updated_at: '2026-09-18 06:00:00',
  },
  {
    serial_id: 2,
    item_id: 6,
    serial_no: 'SN-IP-14-77890',
    batch_id: null,
    warehouse_id: null,
    location_id: null,
    status: 'issued',
    unit_cost: 69900,
    warranty_until: '2026-08-20',
    attributes: null,
    item_name: 'iPhone 14',
    item_sku: 'IP14-128',
    warehouse_name: null,
    warehouse_code: null,
    batch_no: null,
    location_code: null,
    created_at: '2026-04-02 09:00:00',
    updated_at: '2026-09-17 06:00:00',
  },
]

const SUMMARY: SerialSummary = {
  as_on: '2026-09-18',
  currency: 'INR',
  cost_visible: true,
  total: 1248,
  previous_total: 1114,
  previous_as_of: '2026-08-18',
  by_status: { expected: 60, in_stock: 892, reserved: 100, issued: 130, in_transit: 54, damaged: 6, returned: 4, scrapped: 2 },
  groups: { in_stock: 892, allocated: 214, out: 142 },
  warranty: { expired: 9, soon: 14, upcoming: 20, active: 800, none: 405, soon_days: 30, upcoming_days: 90 },
  in_stock_value: 24800000,
  unplaced: 3,
}

function listResponse(rows: Serial[], extra: Record<string, unknown> = {}) {
  return { data: rows, meta: { total: rows.length, limit: 50, offset: 0 }, cost_visible: true, currency: 'INR', ...extra }
}

function renderPage(path = '/masters/serials') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <SerialsWorkspacePage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  listSpy.mockReset()
  summarySpy.mockReset()
  historySpy.mockReset()
  listSpy.mockResolvedValue(listResponse(ROWS))
  summarySpy.mockResolvedValue(SUMMARY)
  historySpy.mockResolvedValue({ serial: ROWS[0], events: [] })
})

describe('SerialsWorkspacePage', () => {
  it('places itself under Masters and says what the screen is for', async () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Masters' }).getAttribute('href')).toBe('/masters')
    expect(screen.getByRole('heading', { name: /Serial numbers/ })).toBeTruthy()
    expect(screen.getByText(/Track and manage item-wise serial numbers/)).toBeTruthy()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
  })

  it('shows the counters the API computed, not a count of the rows on screen', async () => {
    renderPage()
    // 1,248 total with 2 rows loaded: the cards describe the whole filtered set.
    await waitFor(() => expect(screen.getByText('1,248')).toBeTruthy())
    expect(screen.getByText('892')).toBeTruthy()
    expect(screen.getByText('214')).toBeTruthy()
    expect(screen.getByText('142')).toBeTruthy()
  })

  it('draws a delta only where the schema can honestly produce one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('1,248')).toBeTruthy())
    // Total has a month-on-month comparison; the status buckets have no history
    // to compare against and carry a caption instead.
    expect(screen.getByText('+12.0%')).toBeTruthy()
    expect(screen.getByText('Expected, reserved or in transit')).toBeTruthy()
    expect(screen.getByText('Issued, returned or written off')).toBeTruthy()
  })

  it('asks the counters the same question as the table', async () => {
    renderPage('/masters/serials?status=in_stock&warehouse_id=12&page=2')
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())
    const summaryQuery = summarySpy.mock.calls[0][0]
    expect(summaryQuery.status).toBe('in_stock')
    expect(summaryQuery.warehouse_id).toBe('12')
    // …minus the paging, which cannot change a count.
    expect(summaryQuery.page).toBeUndefined()
    expect(summaryQuery.limit).toBeUndefined()
  })

  it('lists the serials with their item, status and what the warranty means', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'SN-AP-MBP-00125' })).toBeTruthy())
    expect(screen.getByText('MacBook Pro 14"')).toBeTruthy()
    expect(screen.getByText('MBP14-M3P')).toBeTruthy()
    expect(screen.getAllByText('In stock').length).toBeGreaterThan(0)
    expect(screen.getByText('2.6 years left')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
  })

  it('marks a serial with no warehouse rather than leaving the cell blank', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Not placed')).toBeTruthy())
  })

  it('does not put unit cost in the page at all when the API withholds it', async () => {
    listSpy.mockResolvedValue(listResponse(ROWS.map((r) => ({ ...r, unit_cost: undefined } as unknown as Serial)), { cost_visible: false }))
    summarySpy.mockResolvedValue({ ...SUMMARY, cost_visible: false, in_stock_value: null })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'SN-AP-MBP-00125' })).toBeTruthy())
    expect(screen.queryByText(/Unit cost/)).toBeNull()
    expect(document.body.textContent).not.toContain('1,89,900')
  })

  it('sends the status the toolbar picked', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'allocated' } })
    await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0].status).toBe('allocated'))
  })

  it('shows an active filter as a chip that removes the parameter it set', async () => {
    renderPage('/masters/serials?warehouse_id=12')
    await waitFor(() => expect(screen.getByText('Main Warehouse', { selector: '.font-medium' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Remove the warehouse filter/i }))
    await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0].warehouse_id).toBeUndefined())
  })

  it('sorts server-side when a header is chosen', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('columnheader', { name: /Serial number/i }).querySelector('button') as HTMLButtonElement)
    await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0].sort).toBe('serial_no'))
  })

  it('opens a serial beside the list and only then fetches its history', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'SN-AP-MBP-00125' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'SN-AP-MBP-00125' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getAllByText(/MBP14-M3P/).length).toBeGreaterThan(0)
    // Forty joins nobody asked for, until a tab needs them.
    expect(historySpy).not.toHaveBeenCalled()
    fireEvent.click(within(drawer).getByRole('tab', { name: 'Lifecycle' }))
    await waitFor(() => expect(historySpy).toHaveBeenCalledWith(1))
  })

  it('offers the first-run screen when the company has no serials', async () => {
    listSpy.mockResolvedValue(listResponse([]))
    summarySpy.mockResolvedValue({ ...SUMMARY, total: 0, groups: { in_stock: 0, allocated: 0, out: 0 } })
    renderPage()
    expect(await screen.findByText('No serial numbers yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add a serial number/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bulk import/ })).toBeTruthy()
  })

  it('says the filters are narrow rather than that the data is gone', async () => {
    listSpy.mockResolvedValue(listResponse([]))
    renderPage('/masters/serials?status=scrapped')
    expect(await screen.findByText('No serial numbers match these filters')).toBeTruthy()
    expect(screen.queryByText('No serial numbers yet')).toBeNull()
  })

  it('keeps the table alive when only the counters fail', async () => {
    summarySpy.mockRejectedValue(new Error('counters exploded'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'SN-AP-MBP-00125' })).toBeTruthy())
    expect(screen.getByText(/counters could not be loaded/i)).toBeTruthy()
  })

  it('offers a retry, with the filters intact, when the list itself fails', async () => {
    listSpy.mockRejectedValue(new Error('list exploded'))
    renderPage('/masters/serials?status=in_stock')
    expect(await screen.findByText(/We couldn’t load serial numbers/)).toBeTruthy()
    listSpy.mockResolvedValue(listResponse(ROWS))
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0].status).toBe('in_stock'))
  })

  it('counts a selection and offers what can be done with it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'SN-AP-MBP-00125' })).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select SN-AP-MBP-00125'))
    expect(await screen.findByText('1 serial number selected')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select SN-IP-14-77890'))
    expect(await screen.findByText('2 serial numbers selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print labels' })).toBeTruthy()
  })

  it('reports findings from the figures, and says they are rules rather than a model', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Serial insights')).toBeTruthy())
    expect(screen.getByText('Rule-based')).toBeTruthy()
    expect(await screen.findByText(/9 serial numbers are past warranty expiry/)).toBeTruthy()
    expect(screen.getByText(/not connected to Inventory yet/)).toBeTruthy()
  })

  it('hides every writing action from a reader who may not write', async () => {
    can.mockImplementation((key: string) => key === 'masters.serials.read')
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /New serial number/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('refuses the page outright to a profile without read access', async () => {
    can.mockReturnValue(false)
    renderPage()
    expect(screen.getByText(/do not have permission to view serial numbers/i)).toBeTruthy()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('pages server-side, reporting the API total rather than the rows it holds', async () => {
    listSpy.mockResolvedValue({ ...listResponse(ROWS), meta: { total: 1248, limit: 50, offset: 0 } })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Showing 1–50 of 1,248/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0].page).toBe(2))
  })
})
