import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Batch, BatchSummary } from '../../../services/masters'
import type { ListResponse } from '../../../services/api'

/**
 * The Batches screen, end to end through the real components.
 *
 * What these tests are actually guarding is the screen's central promise: the
 * figures above the table, the ring beside it and the badges in it all describe
 * the SAME filtered set, and that set comes from the server. So the API is the
 * only thing stubbed — the hero, the cards, the filter bar, the table, the
 * pagination and the drawer are the real components, and the assertions are on
 * what a reader would see.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(['masters.batches.read', 'masters.batches.write', 'masters.batches.delete']),
  accessLoading: false,
  scope: { cmp_id: 1, fy_id: 3, bo_id: 0 } as { cmp_id: number; fy_id: number; bo_id: number },
}))

const listSpy = vi.fn()
const summarySpy = vi.fn()
const movementsSpy = vi.fn()

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: h.scope,
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd · FY 2026-27' }))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      (typeof key === 'string' ? [key] : key).some((k) => h.permissions.has(k)),
    loading: h.accessLoading,
  }),
  useCan: () => true,
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 7, grp_name: 'Medicine' }],
      stock_categories: [{ stock_cat_id: 3, cat_name: 'Pharma' }],
      brands: [{ brand_id: 5, brand_name: 'Cipla' }],
      units: [],
      warehouses: [
        { warehouse_id: 2, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
        { warehouse_id: 4, warehouse_name: 'Delhi Warehouse', warehouse_code: 'DEL', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
      ],
      valuation_methods: ['FIFO'],
      default_valuation_method: 'FIFO',
      negative_stock_policies: ['allow'],
      itc_eligibility_options: [],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: vi.fn(),
}))

// The heavy export libraries are loaded on demand by the real module; nothing
// here clicks through to a file, so the three entry points are enough.
vi.mock('../../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: vi.fn(() => true),
  printHtmlDocument: vi.fn(() => true),
}))

vi.mock('../../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/masters')>()
  return {
    ...actual,
    batchesApi: {
      list: (...args: unknown[]) => listSpy(...args),
      summary: (...args: unknown[]) => summarySpy(...args),
      get: async (id: number) => ({ ...batchById(id), balances: [], stock: { on_hand: 1250, available: 1200, reserved: 50 } }),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      remove: vi.fn(async () => {}),
    },
    warehouseGroupsApi: { ...actual.warehouseGroupsApi, list: async () => ({ data: [], meta: { total: 0, limit: 500, offset: 0 } }) },
  }
})

vi.mock('../../../services/stockViewsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stockViewsApi')>()
  return { ...actual, stockMovementsApi: { list: (...args: unknown[]) => movementsSpy(...args) } }
})

const { BatchesPage } = await import('./BatchesPage')

/* ------------------------------------------------------------------ fixtures */

const MS_DAY = 86_400_000
const todayMs = (() => {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
})()
const iso = (offsetDays: number) => new Date(todayMs + offsetDays * MS_DAY).toISOString().slice(0, 10)

function makeBatch(over: Partial<Batch> & Pick<Batch, 'batch_id' | 'batch_no'>): Batch {
  return {
    item_id: 1,
    lot_no: 'LOT-4587',
    mfg_date: iso(-400),
    expiry_date: iso(500),
    warranty_months: null,
    status: 'active',
    attributes: null,
    item_name: 'Paracetamol 500mg',
    item_sku: 'MED-PARA-500',
    stock_cat_name: 'Medicine',
    unit_id: 1,
    unit_symbol: 'pcs',
    stock: { on_hand: 1250, available: 1200, reserved: 50 },
    warehouses: [{ warehouse_id: 2, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', on_hand: 1250 }],
    created_at: '2026-04-01 10:00:00',
    updated_at: '2026-04-01 10:00:00',
    ...over,
  }
}

const HEALTHY = makeBatch({ batch_id: 1, batch_no: 'BCH-2026-001' })
const SOON = makeBatch({
  batch_id: 2,
  batch_no: 'BCH-2026-003',
  item_name: 'Nestle Milk Powder',
  item_sku: 'FB-NMP-1',
  stock_cat_name: 'Food & Beverages',
  lot_no: 'LOT-9910',
  expiry_date: iso(9),
  stock: { on_hand: 320, available: 320, reserved: 0 },
  warehouses: [
    { warehouse_id: 4, warehouse_name: 'Delhi Warehouse', warehouse_code: 'DEL', on_hand: 200 },
    { warehouse_id: 2, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', on_hand: 120 },
  ],
})
// Stored status is still `active`; only the date makes it expired.
const PAST_DATE = makeBatch({
  batch_id: 3,
  batch_no: 'BCH-2025-098',
  item_name: 'Vitamin C Tablets',
  lot_no: null,
  mfg_date: null,
  expiry_date: iso(-12),
  stock: { on_hand: 0, available: 0, reserved: 0 },
  warehouses: [],
})
const QUARANTINED = makeBatch({ batch_id: 4, batch_no: 'BCH-2025-077', status: 'quarantine', expiry_date: null })

const ROWS = [HEALTHY, SOON, PAST_DATE, QUARANTINED]

function batchById(id: number): Batch {
  return ROWS.find((r) => r.batch_id === id) ?? HEALTHY
}

const SUMMARY: BatchSummary = {
  total: 248,
  items: 42,
  with_stock: 186,
  total_on_hand: 12450,
  expiry_window_days: 30,
  as_of: iso(0),
  states: { active: 186, expiring_soon: 12, expired: 5, inactive: 45 },
  status_counts: { active: 198, quarantine: 30, recalled: 5, expired: 5, closed: 10 },
  expiry_buckets: { expired: 5, within_30: 12, days_31_90: 28, days_91_180: 46, beyond_180: 162, no_expiry: 0 },
  created_recent: 28,
  created_previous: 25,
}

function listResponse(rows: Batch[], over: Partial<ListResponse<Batch>['meta']> = {}): ListResponse<Batch> {
  return { data: rows, meta: { total: 248, limit: 50, offset: 0, ...over } }
}

/* ------------------------------------------------------------------- harness */

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="url">{location.search}</output>
}

function renderPage(url = '/masters/batches') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <BatchesPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('url').textContent ?? ''
const lastListQuery = () => (listSpy.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
const lastSummaryQuery = () => (summarySpy.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
const rowFor = (batchNo: string) => screen.getByRole('button', { name: batchNo }).closest('tr') as HTMLElement

beforeEach(() => {
  h.permissions = new Set(['masters.batches.read', 'masters.batches.write', 'masters.batches.delete'])
  h.accessLoading = false
  h.scope = { cmp_id: 1, fy_id: 3, bo_id: 0 }
  listSpy.mockReset().mockResolvedValue(listResponse(ROWS))
  summarySpy.mockReset().mockResolvedValue(SUMMARY)
  movementsSpy.mockReset().mockResolvedValue({ data: [], meta: { total: 0, limit: 8, offset: 0 } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* --------------------------------------------------------------------- tests */

describe('the page', () => {
  it('renders the hero, the breadcrumb and the batches', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Batches' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Masters')
    expect(screen.getByText('Track Better. Stay Compliant.')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    expect(screen.getByText('Nestle Milk Powder')).toBeTruthy()
  })

  it('asks the API for the page with stock, not for every batch', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    const query = lastListQuery()
    expect(query.with_stock).toBe(1)
    expect(query.limit).toBe(50)
    expect(query.page).toBe(1)
  })

  it('holds the table’s shape while it loads instead of blanking it', async () => {
    listSpy.mockReturnValue(new Promise(() => {}))
    summarySpy.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    // The KPI strip stands in at full height, and the table says it is busy.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true')
  })
})

describe('the figures above the table', () => {
  it('shows what the server counted, not what is on this page', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Total batches')).toBeTruthy())
    // Read each card's own figure: four rows are on screen and none of these
    // numbers could have come from them.
    const strip = within(screen.getByRole('group', { name: 'Batch summary' }))
    const figure = (label: string) =>
      strip.getByText(label).parentElement?.nextElementSibling?.textContent
    expect(figure('Total batches')).toBe('248')
    expect(figure('Active batches')).toBe('186')
    expect(figure('Expiring soon')).toBe('12')
    expect(figure('Expired')).toBe('5')
    expect(figure('Total on hand')).toBe('12,450')
    expect(strip.getByText('75% of total')).toBeTruthy()
  })

  it('counts the same filtered set the table does — without the page or the sort', async () => {
    renderPage('/masters/batches?state=expired&page=3&sort=batch_no')
    await waitFor(() => expect(summarySpy).toHaveBeenCalled())
    expect(lastSummaryQuery()).toMatchObject({ state: 'expired' })
    expect(lastSummaryQuery().page).toBeUndefined()
    expect(lastSummaryQuery().sort).toBeUndefined()
    expect(lastListQuery()).toMatchObject({ state: 'expired', page: 3, sort: 'batch_no' })
  })

  it('links a card to the rows it counted', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Expiring soon')).toBeTruthy())
    const card = screen.getByRole('link', { name: /Open Expiring soon/i })
    expect(card.getAttribute('href')).toContain('state=expiring_soon')
  })

  it('keeps the table usable when only the figures fail', async () => {
    summarySpy.mockRejectedValue(new Error('nope'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Batch totals unavailable.')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy()
  })
})

describe('the expiry grading', () => {
  it('badges a batch past its date as expired even while it is stored active', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2025-098' })).toBeTruthy())
    expect(within(rowFor('BCH-2025-098')).getByText('Expired')).toBeTruthy()
    expect(within(rowFor('BCH-2025-098')).getByText('Expired 12 days ago')).toBeTruthy()
  })

  it('badges a batch inside the window as expiring soon, and says how long is left', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-003' })).toBeTruthy())
    expect(within(rowFor('BCH-2026-003')).getByText('Expiring soon')).toBeTruthy()
    expect(within(rowFor('BCH-2026-003')).getByText('In 9 days')).toBeTruthy()
  })

  it('lets a stored status win over the date', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2025-077' })).toBeTruthy())
    expect(within(rowFor('BCH-2025-077')).getByText('Inactive')).toBeTruthy()
    expect(within(rowFor('BCH-2026-001')).getByText('Active')).toBeTruthy()
  })

  it('never says only "expired" in colour', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2025-098' })).toBeTruthy())
    // The word is in the badge and the elapsed time is in the cell: both text.
    expect(within(rowFor('BCH-2025-098')).getByText('Expired')).toBeTruthy()
  })
})

describe('filtering', () => {
  it('debounces the search, resets to page 1 and puts it in the URL', async () => {
    renderPage('/masters/batches?page=4')
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    const before = listSpy.mock.calls.length

    const box = screen.getByRole('searchbox', { name: 'Search batches' })
    fireEvent.change(box, { target: { value: 'B' } })
    fireEvent.change(box, { target: { value: 'BC' } })
    fireEvent.change(box, { target: { value: 'BCH' } })
    // Nothing yet: three keystrokes must not be three requests.
    expect(listSpy.mock.calls.length).toBe(before)

    await waitFor(() => expect(url()).toContain('q=BCH'), { timeout: 2000 })
    await waitFor(() => expect(lastListQuery().q).toBe('BCH'))
    expect(lastListQuery().page).toBe(1)
    expect(url()).not.toContain('page=4')
  })

  it('sends the screen’s state vocabulary to the server', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'expiring_soon' } })
    await waitFor(() => expect(lastListQuery().state).toBe('expiring_soon'))
    expect(url()).toContain('state=expiring_soon')
  })

  it('filters by warehouse', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: '4' } })
    await waitFor(() => expect(lastListQuery().warehouse_id).toBe('4'))
    expect(url()).toContain('warehouse_id=4')
  })

  it('turns an expiry preset into the dates the API takes', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: 'expired' } })
    await waitFor(() => expect(lastListQuery().expiry_to).toBe(iso(-1)))
    // The preset itself is a toolbar control, not an API parameter.
    expect(lastListQuery().expiry).toBeUndefined()
    expect(url()).toContain('expiry=expired')
  })

  it('counts the advanced filters a collapsed panel is hiding', async () => {
    renderPage('/masters/batches?brand_id=5&lot_no=LOT-1')
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    const more = screen.getByRole('button', { name: /More filters/ })
    expect(more.textContent).toContain('2')
  })

  it('restores every filter from a shared link', async () => {
    renderPage('/masters/batches?state=expired&warehouse_id=2&brand_id=5&q=BCH')
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    expect(lastListQuery()).toMatchObject({ state: 'expired', warehouse_id: '2', brand_id: '5', q: 'BCH' })
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('expired')
    expect((screen.getByLabelText('Warehouse') as HTMLSelectElement).value).toBe('2')
    expect((screen.getByRole('searchbox', { name: 'Search batches' }) as HTMLInputElement).value).toBe('BCH')
  })

  it('clears everything at once', async () => {
    renderPage('/masters/batches?state=expired&warehouse_id=2&q=BCH')
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(url()).toBe(''))
    await waitFor(() => expect(lastListQuery().state).toBeUndefined())
    expect((screen.getByRole('searchbox', { name: 'Search batches' }) as HTMLInputElement).value).toBe('')
  })
})

describe('sorting and paging', () => {
  it('sorts server-side, and flips the order on a second click', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    const header = screen.getByRole('button', { name: /On hand/ })
    fireEvent.click(header)
    await waitFor(() => expect(lastListQuery().sort).toBe('on_hand'))
    expect(lastListQuery().order).toBe('asc')
    fireEvent.click(screen.getByRole('button', { name: /On hand/ }))
    await waitFor(() => expect(lastListQuery().order).toBe('desc'))
  })

  it('pages server-side and reports the server’s total', async () => {
    renderPage()
    // One counter, the shared one: from–to of the server's own total.
    await waitFor(() => expect(screen.getByText('Showing 1–50 of 248')).toBeTruthy())
    listSpy.mockResolvedValue(listResponse(ROWS, { offset: 50 }))
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastListQuery().page).toBe(2))
    expect(url()).toContain('page=2')
  })

  it('changes the page size', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } })
    await waitFor(() => expect(lastListQuery().limit).toBe(100))
  })
})

describe('empty and error states', () => {
  it('invites a first batch when there are none at all', async () => {
    listSpy.mockResolvedValue(listResponse([], { total: 0 }))
    renderPage()
    await waitFor(() => expect(screen.getByText('No batches yet')).toBeTruthy())
    expect(screen.getByText(/Create batches to track lot-wise stock/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /New batch/ }).length).toBeGreaterThan(0)
  })

  it('offers to clear the filters — not to create a batch — when a search matches nothing', async () => {
    listSpy.mockResolvedValue(listResponse([], { total: 0 }))
    renderPage('/masters/batches?q=zzz')
    await waitFor(() => expect(screen.getByText('No batches match these filters')).toBeTruthy())
    const empty = screen.getByText('No batches match these filters').closest('div') as HTMLElement
    expect(within(empty).getByRole('button', { name: /Clear filters/ })).toBeTruthy()
    expect(within(empty).queryByRole('button', { name: /New batch/ })).toBeNull()
  })

  it('offers a retry when the list fails, and shows no stack trace', async () => {
    listSpy.mockRejectedValue(new Error('ECONNRESET at line 42 of /var/www/api/index.php'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Couldn’t load batches.')).toBeTruthy())
    expect(screen.getByText(/Check your connection or try again/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('/var/www/api')

    listSpy.mockResolvedValue(listResponse(ROWS))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
  })
})

describe('selection and bulk actions', () => {
  it('opens a bulk bar once a row is selected', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change status/ })).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Select every batch on this page'))
    expect(screen.getByText('4 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText('4 selected')).toBeNull()
  })

  it('drops the selection when the filters change the rows under it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    expect(screen.getByText('1 selected')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'expired' } })
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('will not offer a bulk edit without the write permission', async () => {
    h.permissions = new Set(['masters.batches.read'])
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    const bar = screen.getByText('1 selected').closest('div') as HTMLElement
    expect(within(bar).queryByRole('button', { name: /Change status/ })).toBeNull()
    expect(within(bar).getByRole('button', { name: /Print labels/ })).toBeTruthy()
  })
})

describe('permissions', () => {
  it('hides create and import from a reader', async () => {
    h.permissions = new Set(['masters.batches.read'])
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /New batch/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    // Export stays: reading a list and taking it away are the same permission.
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })

  it('offers create and import to a writer', async () => {
    renderPage()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /New batch/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy()
  })

  it('says so, and asks the API for nothing, without the read permission', async () => {
    h.permissions = new Set()
    renderPage()
    expect(screen.getByText(/do not have permission to view batches/)).toBeTruthy()
    expect(listSpy).not.toHaveBeenCalled()
    expect(summarySpy).not.toHaveBeenCalled()
  })
})

describe('opening a batch', () => {
  it('opens the drawer on the batch number, with its live detail', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'BCH-2026-001' }))

    const drawer = await screen.findByRole('dialog', { name: /BCH-2026-001/ })
    expect(within(drawer).getByText('Current stock')).toBeTruthy()
    expect(within(drawer).getByText('Stock by warehouse')).toBeTruthy()
    await waitFor(() => expect(movementsSpy).toHaveBeenCalled())
    expect(movementsSpy.mock.calls.at(-1)?.[0]).toMatchObject({ batch_id: 1 })
  })

  it('says a batch has no movements rather than inventing any', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'BCH-2026-001' }))
    const drawer = await screen.findByRole('dialog', { name: /BCH-2026-001/ })
    await waitFor(() => expect(within(drawer).getByText('No movements yet')).toBeTruthy())
  })

  it('opens the form on Edit', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit batch BCH-2026-001' }))
    expect(await screen.findByRole('dialog', { name: 'Edit batch' })).toBeTruthy()
  })

  it('opens the create form from ?new=1 and consumes the flag', async () => {
    renderPage('/masters/batches?new=1')
    expect(await screen.findByRole('dialog', { name: 'New batch' })).toBeTruthy()
    expect(url()).not.toContain('new=1')
  })
})

describe('the company, branch and financial year context', () => {
  it('refetches when the scope changes, and never shows the old company’s rows', async () => {
    const { rerender } = renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BCH-2026-001' })).toBeTruthy())

    h.scope = { cmp_id: 2, fy_id: 3, bo_id: 0 }
    listSpy.mockReturnValue(new Promise(() => {}))
    summarySpy.mockReturnValue(new Promise(() => {}))
    rerender(
      <MemoryRouter initialEntries={['/masters/batches']}>
        <BatchesPage />
        <LocationProbe />
      </MemoryRouter>,
    )

    // Dropped in render, not after a paint: the previous tenant's batch must
    // never be on screen under the new tenant's name.
    expect(screen.queryByRole('button', { name: 'BCH-2026-001' })).toBeNull()
  })
})

describe('the analytics rail', () => {
  it('draws the ring and the timeline from the server summary', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Batch insights')).toBeTruthy())
    expect(screen.getByRole('img', { name: '248 batches by state' })).toBeTruthy()
    expect(screen.getByText('Expiry timeline')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Within 30 days: 12 batches' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Over 180 days: 162 batches' })).toBeTruthy()
  })

  it('disables a quick action it cannot honour, and says why', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Quick actions')).toBeTruthy())
    const bulk = screen.getByRole('button', { name: /Bulk update status/ }) as HTMLButtonElement
    expect(bulk.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    expect((screen.getByRole('button', { name: /Bulk update status/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens the scanner, which looks a batch up rather than creating one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Quick actions')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Scan batch/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Scan batch' })
    expect(within(dialog).getByText(/Nothing is created/)).toBeTruthy()
  })
})
