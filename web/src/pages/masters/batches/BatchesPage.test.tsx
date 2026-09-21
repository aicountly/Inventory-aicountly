import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '../../../ui/ToastContext'
import type { BatchSummary } from '../../../services/batchesApi'
import type { Batch } from '../../../services/masters'

/**
 * The Batches workspace, tested at the seam that matters: what it asks the API
 * for, and what it does with the answer.
 *
 * The recurring theme is that the screen must not invent anything. The figures
 * above the table are the server's count for the filters, never a sum of the
 * page; the expiry badge is derived by the same rule the API filters by; the
 * rows, the paging and the sort all travel to the server. So most of these
 * tests assert on the query that went out, not only on the pixels that came
 * back.
 */

// ---------------------------------------------------------------------------
// Context doubles — mutable so a test can switch company or revoke a permission
// ---------------------------------------------------------------------------

const ctx = {
  scope: { cmp_id: 1, fy_id: 3, bo_id: 0 } as { cmp_id: number; fy_id: number; bo_id: number } | null,
  companyName: 'Acme Ltd',
}

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: ctx.scope,
    companyName: ctx.companyName,
    addressLines: ['12 Industrial Estate'],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
    fy: { fyId: 3, start: '2026-04-01', end: '2027-03-31', label: 'FY 2026-27', defaultValuationMethod: null },
    branch: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

const permissions = { read: true, write: true, delete: true }

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string) =>
      key === 'masters.batches.read'
        ? permissions.read
        : key === 'masters.batches.write'
          ? permissions.write
          : key === 'masters.batches.delete'
            ? permissions.delete
            : true,
    loading: false,
  }),
}))

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 5, grp_name: 'Pharma', grp_alias: null, is_primary: 1, parent_grp_id: null }],
      stock_categories: [{ stock_cat_id: 2, cat_name: 'Medicine', cat_alias: null }],
      brands: [{ brand_id: 8, brand_name: 'Cipla' }],
      units: [],
      warehouses: [
        { warehouse_id: 3, warehouse_name: 'Main Warehouse', warehouse_code: 'MW', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
        { warehouse_id: 4, warehouse_name: 'Delhi Warehouse', warehouse_code: 'DW', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
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

// Printing and file writing are side effects, not assertions about a batch.
const printHtmlDocument = vi.fn((_html: string) => true)
vi.mock('../../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: vi.fn(() => true),
  printHtmlDocument: (html: string) => printHtmlDocument(html),
}))

const downloadCsv = vi.fn()
vi.mock('../../../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/csv')>()
  return { ...actual, downloadCsv: (f: string, c: string) => downloadCsv(f, c) }
})

// ---------------------------------------------------------------------------
// API doubles
// ---------------------------------------------------------------------------

const list = vi.fn()
const summary = vi.fn()
const getBatch = vi.fn()
const bulkStatus = vi.fn()

vi.mock('../../../services/batchesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/batchesApi')>()
  return {
    ...actual,
    batchWorkspaceApi: {
      list: (...args: unknown[]) => list(...args),
      summary: (...args: unknown[]) => summary(...args),
      get: (...args: unknown[]) => getBatch(...args),
      bulkStatus: (...args: unknown[]) => bulkStatus(...args),
    },
  }
})

const movements = vi.fn()
vi.mock('../../../services/stockViewsApi', () => ({
  stockMovementsApi: { list: (...args: unknown[]) => movements(...args) },
}))

vi.mock('../../../services/lookupApi', () => ({
  lookupApi: { itemsByIds: vi.fn(async () => []), searchItems: vi.fn(async () => []) },
}))

const { BatchesPage } = await import('./BatchesPage')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Today, as the component reads it (`todayIso()` is the local clock). Every
 * expiry fixture is expressed relative to it so the suite does not start
 * failing on a particular calendar day.
 */
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const shift = (days: number) =>
  new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)

function batch(over: Partial<Batch> & { batch_id: number }): Batch {
  return {
    item_id: 7,
    batch_no: `BCH-${over.batch_id}`,
    lot_no: 'LOT-4587',
    mfg_date: '2026-04-01',
    expiry_date: shift(400),
    warranty_months: 24,
    status: 'active',
    attributes: null,
    item_name: 'Paracetamol 500mg',
    item_sku: 'SKU-1',
    stock_category_name: 'Medicine',
    unit_id: 1,
    unit_symbol: 'pcs',
    stock: { on_hand: 1250, available: 1250, reserved: 0 },
    warehouse_count: 2,
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main Warehouse', warehouse_code: 'MW', on_hand: 900 },
      { warehouse_id: 4, warehouse_name: 'Delhi Warehouse', warehouse_code: 'DW', on_hand: 350 },
    ],
    created_at: '2026-04-01 09:00:00',
    created_by: 'priya',
    ...over,
  }
}

/** 30 batches — more than the 25 a page shows, so paging is real. */
const ALL: Batch[] = [
  batch({ batch_id: 1, batch_no: 'BCH-2026-001' }),
  batch({ batch_id: 2, batch_no: 'BCH-2026-002', expiry_date: shift(12), item_name: 'Dettol Handwash' }),
  batch({ batch_id: 3, batch_no: 'BCH-2025-098', expiry_date: shift(-40), item_name: 'Vitamin C Tablets', stock: { on_hand: 0, available: 0, reserved: 0 } }),
  batch({ batch_id: 4, batch_no: 'BCH-2026-004', status: 'quarantine' }),
  ...Array.from({ length: 26 }, (_, i) => batch({ batch_id: 5 + i, batch_no: `BCH-2026-1${String(i).padStart(2, '0')}` })),
]

const SUMMARY: BatchSummary = {
  total: 248,
  active: 186,
  expiring_soon: 12,
  expired: 5,
  inactive: 45,
  total_on_hand: 12450,
  with_stock: 203,
  zero_stock: 45,
  previous_total: 221,
  comparison_days: 30,
  near_expiry_days: 30,
  by_status: { active: 198, quarantine: 20, recalled: 5, expired: 5, closed: 20 },
  expiry_buckets: {
    expired: 5,
    within_30: 12,
    days_31_90: 28,
    days_91_180: 46,
    beyond_180: 162,
    no_expiry: 0,
  },
}

type Query = Record<string, unknown>

function lastCall(fn: typeof list): Query {
  return (fn.mock.calls[fn.mock.calls.length - 1]?.[0] ?? {}) as Query
}

let location = ''

function LocationSpy() {
  location = `${useLocation().pathname}${useLocation().search}`
  return null
}

/** The shell every routed screen is mounted inside, minus the chrome. */
function Harness({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        {children}
        <LocationSpy />
      </ToastProvider>
    </MemoryRouter>
  )
}

/** Scope a query to the grid, so a name in the rail cannot answer for a row. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

/** Scope a query to the KPI strip, so the ring's copy of a figure cannot. */
function kpis(): HTMLElement {
  return screen.getByRole('region', { name: 'Batch summary' })
}

function renderPage(url = '/masters/batches?limit=25') {
  render(
    <Harness url={url}>
      <BatchesPage />
    </Harness>,
  )
}

beforeEach(() => {
  ctx.scope = { cmp_id: 1, fy_id: 3, bo_id: 0 }
  permissions.read = true
  permissions.write = true
  permissions.delete = true
  printHtmlDocument.mockClear()
  downloadCsv.mockClear()
  bulkStatus.mockReset()
  bulkStatus.mockImplementation(async () => ({ updated: 1, unchanged: 0, status: 'closed', batch_ids: [1] }))
  getBatch.mockReset()
  getBatch.mockImplementation(async () => ({
    ...ALL[0],
    balances: [
      {
        warehouse_id: 3,
        warehouse_name: 'Main Warehouse',
        warehouse_code: 'MW',
        on_hand: 900,
        reserved: 0,
        committed: 0,
        packed: 0,
        in_transit: 0,
        job_worker: 0,
        quality_hold: 0,
        damaged: 0,
        blocked: 0,
        expected: 0,
        available: 900,
        last_movement_at: null,
      },
    ],
    stock: { on_hand: 1250, available: 1250, reserved: 0 },
  }))
  movements.mockReset()
  movements.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 8, offset: 0 } }))
  summary.mockReset()
  summary.mockImplementation(async () => SUMMARY)
  list.mockReset()
  list.mockImplementation(async (query: Query = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

describe('the screen', () => {
  it('renders inside the Masters shell, with the hero and the batch rows', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    expect(screen.getByRole('heading', { level: 1, name: 'Batches' })).toBeTruthy()
    expect(screen.getByText(/Manage batch-wise tracking/i)).toBeTruthy()
    expect(screen.getByText('Track Better. Stay Compliant.')).toBeTruthy()
    // The breadcrumb keeps the reader inside Masters.
    expect(screen.getByRole('link', { name: 'Masters' })).toBeTruthy()
    expect(within(table()).getAllByText('Paracetamol 500mg').length).toBeGreaterThan(0)
    expect(within(table()).getAllByText('Main Warehouse').length).toBeGreaterThan(0)
  })

  it('names the tab so a reader with twelve tabs open can find it', async () => {
    renderPage()
    await waitFor(() => expect(document.title).toBe('Batches | Aicountly Inventory'))
  })

  it('asks the API for one page with the stock figures attached', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())
    const query = lastCall(list)
    expect(query.limit).toBe(25)
    expect(query.with_stock).toBe(1)
    // Never "fetch everything and slice it in the browser".
    expect(Number(query.limit)).toBeLessThan(ALL.length + 1)
  })

  it('holds the layout with skeletons rather than an empty screen', () => {
    // Both requests are left in flight, which is the first paint of every load.
    const pending: { settle?: (value: unknown) => void } = {}
    list.mockImplementationOnce(
      () =>
        new Promise((resolveList) => {
          pending.settle = resolveList
        }),
    )
    summary.mockImplementationOnce(() => new Promise(() => {}))
    renderPage()
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    pending.settle?.({ data: [], meta: { total: 0, limit: 25, offset: 0 } })
  })
})

describe('the figures above the table', () => {
  /**
   * The page holds 10 rows of 12. A card reading "10" or "12" would be
   * answering a question nobody asked.
   */
  it('shows the server count for the filtered set, not a sum of the page', async () => {
    renderPage()
    await waitFor(() => expect(within(kpis()).getByText('248')).toBeTruthy())
    expect(within(kpis()).getByText('186')).toBeTruthy()
    expect(within(kpis()).getByText('12,450')).toBeTruthy()
    expect(within(kpis()).getByText('within 30 days')).toBeTruthy()
  })

  it('does not re-count the set when the reader turns the page', async () => {
    renderPage()
    await waitFor(() => expect(within(kpis()).getByText('248')).toBeTruthy())
    const before = summary.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastCall(list).page).toBe(2))
    expect(summary.mock.calls.length).toBe(before)
  })

  it('re-counts as soon as a filter changes', async () => {
    renderPage()
    await waitFor(() => expect(within(kpis()).getByText('248')).toBeTruthy())
    const before = summary.mock.calls.length

    fireEvent.change(screen.getByLabelText('Filter by batch status'), { target: { value: 'quarantine' } })
    await waitFor(() => expect(summary.mock.calls.length).toBeGreaterThan(before))
    expect(lastCall(summary).status).toBe('quarantine')
    // Paging keys never reach the summary — it speaks for the whole set.
    expect(lastCall(summary).page).toBeUndefined()
  })

  it('keeps the table when only the figures fail', async () => {
    summary.mockImplementation(async () => {
      throw new Error('aggregate timed out')
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Batch totals unavailable/i)).toBeTruthy())
    expect(within(table()).getByText('BCH-2026-001')).toBeTruthy()
  })
})

describe('the rail', () => {
  it('draws the ring and the timeline from the same server summary', async () => {
    renderPage()
    const rail = await screen.findByRole('complementary', { name: 'Batch analytics' })
    await waitFor(() => expect(within(rail).getByText('Batch insights')).toBeTruthy())

    expect(within(rail).getByRole('link', { name: /Active 186/ })).toBeTruthy()
    expect(within(rail).getByText('Expiry timeline')).toBeTruthy()
    expect(within(rail).getByText('Within 30 days')).toBeTruthy()
    expect(within(rail).getByText('162')).toBeTruthy()
  })

  it('disables a quick action it cannot honour, and says why', async () => {
    renderPage()
    const rail = await screen.findByRole('complementary', { name: 'Batch analytics' })
    // aria-disabled, not `disabled`: a disabled button cannot be hovered or
    // focused, so the tooltip that explains why it is off would never appear.
    // `findByRole`, not `getByRole`: the rail renders a skeleton first, so the
    // aside resolves before its quick actions exist. The sibling test above
    // waits for "Batch insights" for the same reason — this one asserted
    // against the placeholder and failed on any runner slow enough to paint
    // before the fetch landed.
    const close = await within(rail).findByRole('button', { name: /Close selected batches/ })
    expect(close.getAttribute('aria-disabled')).toBe('true')
    expect(within(rail).getByText(/Tick one or more batches/)).toBeTruthy()

    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('filters', () => {
  it('debounces the search rather than firing on every keystroke', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())
    const before = list.mock.calls.length

    const box = screen.getByLabelText('Search batches')
    for (const value of ['p', 'pa', 'par', 'para']) {
      fireEvent.change(box, { target: { value } })
    }
    // Four keystrokes must not be four requests.
    expect(list.mock.calls.length).toBe(before)

    await waitFor(() => expect(lastCall(list).q).toBe('para'), { timeout: 2000 })
    expect(list.mock.calls.length).toBeLessThanOrEqual(before + 2)
  })

  it('sends the status filter and puts it in the URL', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Filter by batch status'), { target: { value: 'quarantine' } })
    await waitFor(() => expect(lastCall(list).status).toBe('quarantine'))
    expect(location).toContain('status=quarantine')
  })

  /**
   * A warehouse means both halves of the question: show me the batches that are
   * there, and tell me how much of each is there.
   */
  it('narrows both the rows and the on-hand figures to a warehouse', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Filter by warehouse'), { target: { value: '3' } })
    await waitFor(() => expect(lastCall(list).in_warehouse_id).toBe('3'))
    expect(lastCall(list).warehouse_id).toBe('3')
  })

  it('turns an expiry preset into a real date range', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Filter by expiry date'), { target: { value: 'd30' } })
    await waitFor(() => expect(lastCall(list).expiry_from).toBe(TODAY))
    expect(lastCall(list).expiry_to).toBe(shift(30))
    expect(location).toContain('expiry=d30')
  })

  it('asks for expired batches by date, not by a word the API would have to interpret', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Filter by expiry date'), { target: { value: 'expired' } })
    await waitFor(() => expect(lastCall(list).expiry_to).toBe(shift(-1)))
    expect(lastCall(list).has_expiry).toBe('1')
  })

  it('restores every filter from the URL, so the view is a link', async () => {
    renderPage('/masters/batches?limit=25&status=quarantine&health=expiring&warehouse_id=4&lot_no=LOT-1')
    await waitFor(() => expect(list).toHaveBeenCalled())

    const query = lastCall(list)
    expect(query.status).toBe('quarantine')
    expect(query.health).toBe('expiring')
    expect(query.in_warehouse_id).toBe('4')
    expect(query.lot_no).toBe('LOT-1')
    expect((screen.getByLabelText('Filter by batch status') as HTMLSelectElement).value).toBe('quarantine')
  })

  it('clears everything, including the search box', async () => {
    renderPage('/masters/batches?limit=25&status=quarantine&q=para')
    await waitFor(() => expect(lastCall(list).status).toBe('quarantine'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(lastCall(list).status).toBeUndefined())
    expect(lastCall(list).q).toBeUndefined()
    expect((screen.getByLabelText('Search batches') as HTMLInputElement).value).toBe('')
  })

  it('offers a KPI card as a filter, keeping the filters already in force', async () => {
    renderPage('/masters/batches?limit=25&warehouse_id=3')
    await waitFor(() => expect(within(kpis()).getByText('248')).toBeTruthy())

    const expiring = screen.getByRole('link', { name: /Open Expiring soon/i })
    expect(expiring.getAttribute('href')).toContain('warehouse_id=3')
    expect(expiring.getAttribute('href')).toContain('health=expiring')
  })
})

describe('sorting and paging', () => {
  it('sorts on the server, not the page on screen', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Expires/ }))
    await waitFor(() => expect(lastCall(list).sort).toBe('expiry_date'))
    expect(lastCall(list).order).toBe('asc')

    fireEvent.click(screen.getByRole('button', { name: /Expires/ }))
    await waitFor(() => expect(lastCall(list).order).toBe('desc'))
    expect(location).toContain('sort=expiry_date')
  })

  it('offers on-hand as a server sort, which needs the balance aggregate', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /On hand/ }))
    await waitFor(() => expect(lastCall(list).sort).toBe('on_hand'))
  })

  it('pages on the server and reports the range from the server meta', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Showing 1–25 of 30')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastCall(list).page).toBe(2))
    expect(location).toContain('page=2')
  })

  it('goes back to the first page when the filters change under it', async () => {
    renderPage('/masters/batches?limit=25&page=2')
    await waitFor(() => expect(lastCall(list).page).toBe(2))

    fireEvent.change(screen.getByLabelText('Filter by batch status'), { target: { value: 'closed' } })
    await waitFor(() => expect(lastCall(list).status).toBe('closed'))
    expect(lastCall(list).page).toBe(1)
  })
})

describe('expiry intelligence', () => {
  it('reads expired from the calendar even while the stored status says active', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2025-098')).toBeTruthy())

    const row = within(table()).getByText('BCH-2025-098').closest('tr') as HTMLElement
    expect(within(row).getByText('Expired')).toBeTruthy()
    expect(within(row).getByText('40 d ago')).toBeTruthy()
    // Never colour alone.
    expect(within(row).getByText(/Expired 40 days ago/)).toBeTruthy()
  })

  it('flags a batch inside the warning window the API declared', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-002')).toBeTruthy())

    const row = within(table()).getByText('BCH-2026-002').closest('tr') as HTMLElement
    expect(within(row).getByText('Expiring soon')).toBeTruthy()
    expect(within(row).getByText('in 12 d')).toBeTruthy()
  })

  it('keeps the API’s own word for a batch it put on hold', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-004')).toBeTruthy())

    const row = within(table()).getByText('BCH-2026-004').closest('tr') as HTMLElement
    expect(within(row).getByText('Quarantine')).toBeTruthy()
  })

  it('keeps a zero-stock batch on the list — it is history, not a deletion', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2025-098')).toBeTruthy())
    const row = within(table()).getByText('BCH-2025-098').closest('tr') as HTMLElement
    expect(within(row).getByText('0')).toBeTruthy()
  })
})

describe('selection and bulk actions', () => {
  it('shows the bulk bar once a row is ticked, and says the selection is this page', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(screen.getByText('on this page')).toBeTruthy()
  })

  it('selects and clears the whole page from the header checkbox', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Select every batch on this page'))
    expect(screen.getByText('25 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Clear selection/ }))
    expect(screen.queryByText('25 selected')).toBeNull()
  })

  it('drops the selection when the rows underneath it change', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))
    expect(screen.getByText('1 selected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  it('confirms a bulk status change, then sends ONE request for the selection', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))

    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mark as closed/ }))

    expect(await screen.findByText(/Mark 1 batch as closed\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply status' }))

    await waitFor(() => expect(bulkStatus).toHaveBeenCalledOnce())
    expect(bulkStatus.mock.calls[0]).toEqual([[1], 'closed'])
  })

  it('exports only the selection, and says so in the file’s own metadata', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))

    fireEvent.click(screen.getByRole('button', { name: /Export selection/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    const [filename, csv] = downloadCsv.mock.calls[0]
    expect(filename).toContain('selection')
    expect(csv.trim().split('\r\n')).toHaveLength(2)
  })

  it('prints a label sheet for the selection without adding a PDF dependency', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Select batch BCH-2026-001'))

    // The bulk bar's button, not the rail's — that one is named for its count.
    fireEvent.click(screen.getByRole('button', { name: 'Print labels' }))
    await waitFor(() => expect(printHtmlDocument).toHaveBeenCalledOnce())
    const html = printHtmlDocument.mock.calls[0][0]
    expect(html).toContain('BCH-2026-001')
    expect(html).toContain('Acme Ltd')
    // A scannable symbol, not a picture of one.
    expect(html).toContain('aria-label="Barcode BCH-2026-001"')
  })
})

describe('the row inspector', () => {
  it('opens beside the list and fetches the per-warehouse balances', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'View batch BCH-2026-001' }))
    const drawer = await screen.findByRole('dialog')
    await waitFor(() => expect(getBatch).toHaveBeenCalledWith(1, expect.anything()))
    expect(within(drawer).getAllByText('Paracetamol 500mg').length).toBeGreaterThan(0)
    expect(within(drawer).getByText('Stock by warehouse')).toBeTruthy()
    await waitFor(() => expect(within(drawer).getByText('Main Warehouse')).toBeTruthy())
  })

  it('says a batch has no movements rather than drawing a decorative timeline', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'View batch BCH-2026-001' }))

    const drawer = await screen.findByRole('dialog')
    await waitFor(() => expect(within(drawer).getByText('No movements this year')).toBeTruthy())
    expect(movements).toHaveBeenCalledWith(expect.objectContaining({ batch_id: 1 }), expect.anything())
  })
})

describe('empty and failed states', () => {
  it('invites the first batch when the company has none', async () => {
    list.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    renderPage()
    await waitFor(() => expect(screen.getByText('No batches yet')).toBeTruthy())
    expect(screen.getByText(/Create batches to track lot-wise stock/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import batches/ })).toBeTruthy()
  })

  /** A search mismatch is not an invitation to create a record. */
  it('offers to clear the filters when they matched nothing', async () => {
    list.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    renderPage('/masters/batches?limit=25&status=recalled')
    await waitFor(() => expect(screen.getByText('No batches match these filters')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
    expect(screen.queryByText('No batches yet')).toBeNull()
  })

  it('offers a retry, and no stack trace, when the list fails', async () => {
    list.mockImplementation(async () => {
      throw new Error('ECONNREFUSED 10.0.0.5:5432')
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Couldn’t load batches.')).toBeTruthy())
    expect(screen.getByText(/Check your connection or try again/)).toBeTruthy()
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull()

    list.mockImplementation(async () => ({ data: ALL.slice(0, 10), meta: { total: ALL.length, limit: 25, offset: 0 } }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
  })
})

describe('permissions', () => {
  it('hides create and import from a reader who cannot write', async () => {
    permissions.write = false
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    expect(screen.queryByRole('button', { name: /New batch/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Import$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit batch BCH-2026-001/ })).toBeNull()
    // Reading is unaffected.
    expect(screen.getByRole('button', { name: 'View batch BCH-2026-001' })).toBeTruthy()
  })

  it('offers create, import and edit to a reader who can write', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    expect(screen.getByRole('button', { name: /New batch/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Import$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit batch BCH-2026-001' })).toBeTruthy()
  })

  it('asks for nothing at all when the profile cannot read batches', async () => {
    permissions.read = false
    renderPage()
    await waitFor(() => expect(screen.getByText(/do not have permission/i)).toBeTruthy())
    expect(list).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
  })

  it('opens the create form from ?new=1 and strips the flag so a reload does not', async () => {
    renderPage('/masters/batches?limit=25&new=1')
    expect(await screen.findByRole('heading', { name: 'New batch' })).toBeTruthy()
    await waitFor(() => expect(location).not.toContain('new=1'))
  })
})

describe('company, branch and financial year', () => {
  /**
   * Holding the previous company's rows under the new company's name is not a
   * slightly stale number; it is another tenant's data on screen.
   */
  it('refetches and drops the old rows when the context changes', async () => {
    const { rerender } = render(
      <Harness url="/masters/batches?limit=25">
        <BatchesPage />
      </Harness>,
    )
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())
    const before = list.mock.calls.length

    ctx.scope = { cmp_id: 2, fy_id: 9, bo_id: 5 }
    list.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    rerender(
      <Harness url="/masters/batches?limit=25">
        <BatchesPage />
      </Harness>,
    )

    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText('BCH-2026-001')).toBeNull())
  })

  it('asks for nothing until a company is selected', async () => {
    ctx.scope = null
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Batches' })).toBeTruthy())
    expect(list).not.toHaveBeenCalled()
  })
})

describe('export', () => {
  it('exports the whole filtered result, not the page on screen', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('BCH-2026-001')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const [filename, csv] = downloadCsv.mock.calls[0]
    expect(filename).toContain('batches-acme-ltd')
    const lines = csv.trim().split('\r\n')
    // Header + all thirty, although only twenty-five are on screen.
    expect(lines).toHaveLength(31)
    expect(lines[0]).toContain('Warehouse')
    expect(lines[0]).toContain('Status')
  })

  it('carries the filters into the export so the file matches the screen', async () => {
    renderPage('/masters/batches?limit=25&status=quarantine')
    await waitFor(() => expect(lastCall(list).status).toBe('quarantine'))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    expect(lastCall(list).status).toBe('quarantine')
  })
})
