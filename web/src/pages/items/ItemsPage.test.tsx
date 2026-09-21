import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ItemListRow, ItemsSummary } from '../../services/items'

/**
 * The Items screen, over its real components and a stubbed API.
 *
 * The properties held here are the ones that would be silently wrong rather
 * than visibly broken: that the figures on screen came from the server and not
 * from the page of rows, that a filter survives being put in the URL, that the
 * selection cannot outlive the rows it was made on, and that nothing offers to
 * write for a reader who is only allowed to read.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  list: vi.fn(),
  summary: vi.fn(),
  bulkUpdate: vi.fn(),
  byBarcode: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Acme Ltd' }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      (typeof key === 'string' ? [key] : key).some((k) => h.permissions.has(k)),
    loading: false,
    member: { uuid: 'u-1' },
  }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({ useToast: () => h.toast }))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 1, grp_name: 'General', grp_alias: null, is_primary: 1, parent_grp_id: null }],
      stock_categories: [{ stock_cat_id: 3, cat_name: 'Raw Material', cat_alias: null }],
      brands: [],
      units: [{ unit_id: 5, unit_name: 'Dozen', unit_symbol: 'DOZ', print_name: null, uqc_gst: null }],
      warehouses: [],
      valuation_methods: ['FIFO', 'LIFO', 'WAC'],
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

// The export machinery pulls in jsPDF and xlsx; neither is what these tests are
// about, and both are slow to import.
vi.mock('../../components/ListSheetActions', () => ({
  ListSheetActions: () => <button type="button">Export</button>,
}))

vi.mock('../../services/items', async () => {
  const actual = await vi.importActual<typeof import('../../services/items')>('../../services/items')
  return {
    ...actual,
    itemsApi: {
      ...actual.itemsApi,
      list: h.list,
      summary: h.summary,
      bulkUpdate: h.bulkUpdate,
      byBarcode: h.byBarcode,
    },
  }
})

const { ItemsPage } = await import('./ItemsPage')

function item(over: Partial<ItemListRow> = {}): ItemListRow {
  return {
    item_id: 1,
    item_name: 'Ballpoint Pens',
    item_alias: 'Pen',
    print_name: null,
    item_type: 'stock',
    item_sku: null,
    item_upc: null,
    hsn_sac: '960810',
    mrp: null,
    unit_id: 5,
    stock_cat_id: 3,
    item_grp_id: 1,
    brand_id: null,
    valuation_method: 'FIFO',
    track_batch: 0,
    track_serial: 0,
    track_expiry: 0,
    is_active: 1,
    updated_at: '2026-07-07T15:08:00',
    created_at: '2026-07-07T15:08:00',
    unit_symbol: 'DOZ',
    unit_name: 'Dozen',
    grp_name: 'General',
    cat_name: 'Raw Material',
    brand_name: null,
    stock: { on_hand: -1, available: -1, reserved: 0 },
    ...over,
  }
}

function summary(over: Partial<ItemsSummary> = {}): ItemsSummary {
  return {
    total: 1248,
    active: 1192,
    inactive: 56,
    stock_tracked: 1200,
    in_stock: 1170,
    low_stock: 24,
    out_of_stock: 3,
    negative_stock: 1,
    needs_attention: 28,
    missing_hsn: 0,
    missing_barcode: 0,
    missing_sku: 0,
    inactive_with_stock: 0,
    ...over,
  }
}

function ShowLocation() {
  const loc = useLocation()
  return <output data-testid="url">{`${loc.pathname}${loc.search}`}</output>
}

/**
 * The viewport, chosen explicitly.
 *
 * The page mounts EITHER the table or the cards, never both, so a test that
 * left the viewport to happy-dom would be asserting against whichever layout
 * the fallback happened to pick. Desktop is the default here because that is
 * where the table lives.
 */
function setViewport(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width: 768px') ? wide : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

function renderPage(url = '/items') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/items"
          element={
            <>
              <ItemsPage />
              <ShowLocation />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setViewport(true)
  h.permissions = new Set(['masters.items.read', 'masters.items.write', 'masters.items.delete'])
  h.list.mockReset().mockResolvedValue({ data: [item()], meta: { total: 1, limit: 50, offset: 0 } })
  h.summary.mockReset().mockResolvedValue(summary())
  h.bulkUpdate.mockReset().mockResolvedValue({ updated: 1, rows: [] })
  h.byBarcode.mockReset()
  h.toast.success.mockReset()
  h.toast.error.mockReset()
  try {
    window.localStorage.clear()
  } catch {
    /* not every environment has storage */
  }
})

describe('the item list', () => {
  it('renders the item with the stock the API returned', async () => {
    renderPage()
    expect(await screen.findByText('Ballpoint Pens')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })

  it('asks the API for stock with the list, never one request per row', async () => {
    // The on-hand figure and every reorder threshold behind an amber badge ride
    // along in the list response. A page of 100 items must cost one request.
    renderPage()
    await screen.findByText('Ballpoint Pens')
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.list.mock.calls[0][0]).toMatchObject({ with_stock: true })
  })

  it('names the stock state in text, not only in colour', async () => {
    renderPage()
    await screen.findByText('Ballpoint Pens')
    // A red figure is the same figure to a reader who cannot see the red, and
    // to a monochrome printer. The words sit beside the quantity in the row,
    // for a screen reader — not only in the filter dropdown's option list.
    const table = screen.getByRole('table')
    expect(within(table).getByText(/Negative stock/i)).toBeTruthy()
  })
})

describe('the KPI counters', () => {
  it('shows the server total, not the number of rows on the page', async () => {
    // One row is on screen and the catalogue holds 1,248. A card that counted
    // the page would read "1".
    renderPage()
    expect(await screen.findByText('1,248')).toBeTruthy()
  })

  it('counts over the whole catalogue regardless of which card is active', async () => {
    // `status` and `stock_status` are what the cards themselves switch on, so
    // they are excluded — otherwise "Low stock 24" would re-count to 24 of 24.
    renderPage('/items?stock_status=low&item_grp_id=1')
    await screen.findByText('Ballpoint Pens')
    const params = h.summary.mock.calls[0][0]
    expect(params.stock_status).toBeUndefined()
    expect(params.status).toBeUndefined()
    expect(params.item_grp_id).toBe('1')
  })

  it('keeps the list when the summary endpoint fails', async () => {
    // A broken counter costs the reader the strip, never the rows.
    h.summary.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Ballpoint Pens')).toBeTruthy()
  })
})

describe('inventory intelligence', () => {
  it('reports the negative-stock finding with a link that proves it', async () => {
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Inventory intelligence' })
    expect(within(strip).getByText(/1 item needs stock correction/i)).toBeTruthy()
    // Every claim is checkable: the link lands on exactly the rows it counted.
    const review = within(strip).getByRole('link', { name: /Review/i })
    expect(review.getAttribute('href')).toContain('stock_status=negative')
  })

  it('says so plainly when there is nothing to report', async () => {
    // Never a manufactured line so the strip has something to say.
    h.summary.mockResolvedValue(summary({ negative_stock: 0, low_stock: 0, out_of_stock: 0 }))
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Inventory intelligence' })
    expect(within(strip).getByText(/Inventory health looks good/i)).toBeTruthy()
  })
})

describe('filters', () => {
  it('sends the URL filter to the API', async () => {
    renderPage('/items?stock_status=negative&status=active')
    await screen.findByText('Ballpoint Pens')
    expect(h.list.mock.calls[0][0]).toMatchObject({ stock_status: 'negative', status: 'active' })
  })

  it('puts a chosen filter in the URL, so a refresh and a shared link restore it', async () => {
    renderPage()
    await screen.findByText('Ballpoint Pens')
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: 'low' } })
    await waitFor(() => expect(screen.getByTestId('url').textContent).toContain('stock_status=low'))
  })

  it('offers a removable chip for each applied filter', async () => {
    renderPage('/items?stock_status=negative')
    await screen.findByText('Ballpoint Pens')
    const chip = await screen.findByRole('button', { name: /Remove filter Stock: Negative stock/i })
    fireEvent.click(chip)
    await waitFor(() => expect(screen.getByTestId('url').textContent).not.toContain('stock_status'))
  })

  it('explains an empty result caused by filters differently from an empty catalogue', async () => {
    h.list.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } })
    renderPage('/items?stock_status=negative')
    expect(await screen.findAllByText(/No items match these filters/i)).toBeTruthy()
  })

  it('invites the first item when the catalogue is genuinely empty', async () => {
    h.list.mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } })
    renderPage()
    expect(await screen.findAllByText(/No items yet/i)).toBeTruthy()
  })
})

describe('the inspector drawer', () => {
  it('opens from the row and puts the item in the URL', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ballpoint Pens' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toContain('item=1'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows the row it was given straight away, without waiting for the full record', async () => {
    // Opening with a spinner over data the browser already holds would feel
    // slower than the list it came from.
    renderPage('/items?item=1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Ballpoint Pens')).toBeTruthy()
    expect(within(dialog).getByText('960810')).toBeTruthy()
  })

  it('sends a below-zero item to a stock journal rather than offering to edit the quantity', async () => {
    // A quantity changed without a movement behind it is stock that exists in
    // the master and nowhere in the ledger.
    // Raising the correction needs create on the document type, not merely
    // read on documents — the same key DocumentFormPage is gated by.
    h.permissions.add('documents.stock_journal.create')
    renderPage('/items?item=1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Stock is below zero/i)).toBeTruthy()
    const adjust = within(dialog).getByRole('link', { name: /Adjust stock/i })
    expect(adjust.getAttribute('href')).toContain('/documents/new/stock_journal')
  })

  it('offers no correction link to a reader who cannot raise the document', async () => {
    renderPage('/items?item=1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Stock is below zero/i)).toBeTruthy()
    expect(within(dialog).queryByRole('link', { name: /Adjust stock/i })).toBeNull()
  })
})

describe('selection and bulk actions', () => {
  it('deactivates the ticked items through the bulk-update endpoint', async () => {
    renderPage()
    fireEvent.click(await screen.findByLabelText('Select Ballpoint Pens'))
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(h.bulkUpdate).toHaveBeenCalledWith([{ item_id: 1, is_active: 0 }]))
  })

  it('drops the selection when the filters change', async () => {
    // Acting on rows that are no longer on screen is how the wrong forty items
    // get deactivated.
    renderPage()
    fireEvent.click(await screen.findByLabelText('Select Ballpoint Pens'))
    expect(await screen.findByRole('region', { name: /1 items selected/i })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: 'low' } })
    await waitFor(() => expect(screen.queryByRole('region', { name: /selected/i })).toBeNull())
  })
})

describe('permissions', () => {
  it('offers no create, delete or selection to a read-only member', async () => {
    h.permissions = new Set(['masters.items.read'])
    renderPage()
    await screen.findByText('Ballpoint Pens')
    expect(screen.queryByRole('button', { name: /New item/i })).toBeNull()
    expect(screen.queryByLabelText('Select Ballpoint Pens')).toBeNull()
  })

  it('refuses the page outright without the read permission', async () => {
    h.permissions = new Set()
    renderPage()
    expect(await screen.findByText(/do not have permission to view items/i)).toBeTruthy()
    expect(h.list).not.toHaveBeenCalled()
  })
})

describe('the narrow-screen layout', () => {
  it('mounts the cards instead of the table below md, not as well as it', async () => {
    // Both layouts rendering would double the DOM on a hundred-row page and
    // make a screen reader read the whole catalogue twice.
    setViewport(false)
    renderPage()
    await screen.findByText('Ballpoint Pens')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByText('Ballpoint Pens')).toHaveLength(1)
  })

  it('renders one table and no card duplicate on a wide screen', async () => {
    renderPage()
    await screen.findByText('Ballpoint Pens')
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getAllByText('Ballpoint Pens')).toHaveLength(1)
  })

  it('hides the view switcher where only one view is available', async () => {
    setViewport(false)
    renderPage()
    await screen.findByText('Ballpoint Pens')
    expect(screen.queryByRole('tab', { name: /Table/i })).toBeNull()
  })
})

describe('barcode entry', () => {
  it('opens the item a scanner typed into the box', async () => {
    // A handheld scanner types the code and presses Enter. That is all the
    // support it needs.
    h.byBarcode.mockResolvedValue(item({ item_id: 1 }))
    renderPage()
    const box = await screen.findByLabelText('Search inventory items')
    fireEvent.change(box, { target: { value: '8901234567890' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(h.byBarcode).toHaveBeenCalledWith('8901234567890'))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toContain('item=1'))
  })

  it('falls back to an ordinary search when the code matches nothing', async () => {
    h.byBarcode.mockRejectedValue(new Error('not found'))
    renderPage()
    const box = await screen.findByLabelText('Search inventory items')
    fireEvent.change(box, { target: { value: 'pens' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('url').textContent).toContain('q=pens'))
  })
})

afterEach(() => vi.unstubAllGlobals())
