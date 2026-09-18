import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { StockCategory } from '../../../services/masters'
import type { StockCategorySummary } from '../../../services/stockCategories'

/**
 * Masters → Stock categories, from the endpoints up.
 *
 * Only the services are faked. The real page, the real summary cards, the real
 * table and the real delete guard all run, because the properties worth
 * protecting live between them:
 *
 *  - the four figures come from `/summary`, so they are the company's and not
 *    a count of the rows that happen to be on screen;
 *  - a figure the API could not supply renders as an em dash, never a
 *    confident zero;
 *  - a category in use cannot be deleted from the UI, and the dialog says why
 *    before any request is made;
 *  - pressing Analyse with no AI service connected produces the words "not
 *    connected", not analysis.
 */

const h = vi.hoisted(() => {
  const state = {
    permissions: null as Set<string> | null,
    rows: [] as StockCategory[],
    total: 0,
    listFails: false,
    summary: null as StockCategorySummary | null,
    summaryFails: false,
    lastListQuery: null as Record<string, unknown> | null,
  }
  return {
    state,
    remove: vi.fn(async () => {}),
    create: vi.fn(async () => state.rows[0]),
    update: vi.fn(async () => state.rows[0]),
    bulkStatus: vi.fn(async () => ({ updated: 2, is_active: 0 })),
    analyse: vi.fn(async () => ({ connected: false as const })),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }
})

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Acme Ltd' }),
}))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.state.permissions === null) return true
      const keys = typeof key === 'string' ? [key] : key
      return keys.some((k) => h.state.permissions?.has(k))
    },
    loading: false,
  }),
  useCan: () => true,
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: h.toastSuccess, error: h.toastError, info: vi.fn(), notify: vi.fn() }),
}))

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

// The export toolbar pulls in the PDF / spreadsheet writers, which have their
// own tests; this one is about the screen around it.
vi.mock('../../../components/ListSheetActions', () => ({
  ListSheetActions: ({ onRefresh }: { onRefresh?: () => void }) => (
    <button type="button" onClick={onRefresh}>
      Refresh
    </button>
  ),
}))

vi.mock('../../../services/masters', () => ({
  stockCategoriesApi: {
    list: async (query: Record<string, unknown> = {}) => {
      h.state.lastListQuery = query
      if (h.state.listFails) throw new Error('stock categories are down')
      return { data: h.state.rows, meta: { total: h.state.total, limit: 50, offset: 0 } }
    },
    get: async () => h.state.rows[0],
    create: h.create,
    update: h.update,
    remove: h.remove,
  },
}))

vi.mock('../../../services/stockCategories', () => ({
  fetchStockCategorySummary: async () => {
    if (h.state.summaryFails) throw new Error('summary is down')
    return h.state.summary
  },
  bulkSetStockCategoryStatus: h.bulkStatus,
}))

vi.mock('../../../services/stockCategoryAi', () => ({
  analyseStockCategories: h.analyse,
  isCategoryAiConnected: () => false,
}))

const { StockCategoriesPage } = await import('./StockCategoriesPage')

function cat(partial: Partial<StockCategory> & { stock_cat_id: number; cat_name: string }): StockCategory {
  return { cat_alias: null, is_active: 1, updated_at: '2026-07-02 11:23:00', ...partial }
}

const RAW = cat({ stock_cat_id: 1, cat_name: 'Raw Material', cat_alias: 'RM', item_count: 124 })
const UNUSED = cat({ stock_cat_id: 2, cat_name: 'Trading Goods', cat_alias: 'TG', item_count: 0 })

const SUMMARY: StockCategorySummary = {
  total: 10,
  active: 8,
  inactive: 2,
  created_this_month: 1,
  most_used: { stock_cat_id: 1, cat_name: 'Raw Material', item_count: 124 },
  uncategorised_items: 3,
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderPage(url = '/masters/stock-categories') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <StockCategoriesPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('search').textContent ?? ''
const summaryCards = () => screen.getByRole('region', { name: 'Stock category summary' })
/* Scoped to the table: "Raw Material" is also the Most-used KPI card. */
const rowFor = (name: string) => within(screen.getByRole('table')).getByRole('row', { name: new RegExp(name) })
const rowsReady = () => waitFor(() => expect(within(screen.getByRole('table')).getByText('Raw Material')).toBeTruthy())

beforeEach(() => {
  h.state.permissions = null
  h.state.rows = [RAW, UNUSED]
  h.state.total = 2
  h.state.listFails = false
  h.state.summary = SUMMARY
  h.state.summaryFails = false
  h.state.lastListQuery = null
  h.remove.mockClear()
  h.create.mockClear()
  h.update.mockClear()
  h.bulkStatus.mockClear()
  h.analyse.mockClear()
  h.toastSuccess.mockClear()
})

describe('StockCategoriesPage', () => {
  it('lists what the API returned, with its alias, status and usage count', async () => {
    renderPage()
    await rowsReady()
    const row = rowFor('Raw Material')
    expect(within(row).getByText('RM')).toBeTruthy()
    expect(within(row).getByText('Active')).toBeTruthy()
    expect(within(row).getByRole('link', { name: /124 items in Raw Material/ })).toBeTruthy()
  })

  it('links a usage count to the Items screen filtered to that category', async () => {
    renderPage()
    await rowsReady()
    const link = within(rowFor('Raw Material')).getByRole('link', { name: /124/ })
    expect(link.getAttribute('href')).toBe('/items?stock_cat_id=1')
  })

  it('takes the four figures from the summary endpoint, not from the rows on screen', async () => {
    renderPage()
    await rowsReady()
    const cards = summaryCards()
    // Two rows are loaded; the cards must still say what the company holds.
    expect(within(cards).getByText('10')).toBeTruthy()
    expect(within(cards).getByText('8')).toBeTruthy()
    expect(within(cards).getByText('2')).toBeTruthy()
    expect(within(cards).getByText('80% of total')).toBeTruthy()
  })

  it('shows an em dash and says so when the summary cannot be read', async () => {
    h.state.summaryFails = true
    renderPage()
    await rowsReady()
    await waitFor(() => expect(screen.getByText(/summary figures could not be read/)).toBeTruthy())
    expect(within(summaryCards()).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('says no category is used yet rather than naming one, when nothing is categorised', async () => {
    h.state.summary = { ...SUMMARY, most_used: null }
    renderPage()
    await waitFor(() => expect(screen.getByText('No items categorised yet')).toBeTruthy())
  })

  it('never divides by zero on an empty company', async () => {
    h.state.rows = []
    h.state.total = 0
    h.state.summary = { total: 0, active: 0, inactive: 0, created_this_month: 0, most_used: null, uncategorised_items: 0 }
    renderPage()
    await waitFor(() => expect(screen.getByText('No stock categories yet')).toBeTruthy())
    expect(within(summaryCards()).getAllByText('0% of total').length).toBe(2)
  })

  it('offers Clear filters — not the first-run empty state — when a search matches nothing', async () => {
    h.state.rows = []
    h.state.total = 0
    renderPage('/masters/stock-categories?q=zzz')
    await waitFor(() => expect(screen.getByText('No stock categories match your filters.')).toBeTruthy())
    expect(screen.queryByText('No stock categories yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('keeps the page and offers a retry when the list fails', async () => {
    h.state.listFails = true
    renderPage()
    await waitFor(() => expect(screen.getByText('Unable to load stock categories.')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Stock categories' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy()
  })

  it('sends the status filter to the API and puts it in the URL', async () => {
    renderPage()
    await rowsReady()
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'inactive' } })
    await waitFor(() => expect(url()).toContain('status=inactive'))
    await waitFor(() => expect(h.state.lastListQuery?.status).toBe('inactive'))
  })

  it('asks the server to rank by usage when "Most items" is chosen', async () => {
    renderPage()
    await rowsReady()
    fireEvent.change(screen.getByLabelText('Sort categories'), { target: { value: 'items_desc' } })
    await waitFor(() => expect(h.state.lastListQuery?.sort).toBe('item_count'))
    expect(h.state.lastListQuery?.order).toBe('desc')
  })

  it('refuses to delete a category that items still use, without calling the API', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(within(rowFor('Raw Material')).getByRole('button', { name: /More actions/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete stock category?' })
    expect(within(dialog).getByText(/currently assigned to 124 items/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(h.remove).not.toHaveBeenCalled()
  })

  it('deletes a category nothing uses', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(within(rowFor('Trading Goods')).getByRole('button', { name: /More actions/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete stock category?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(2))
  })

  it('deactivates the selection in one call', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(screen.getByLabelText('Select all categories on this page'))
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(h.bulkStatus).toHaveBeenCalledWith([1, 2], false))
  })

  it('creates a category through the drawer', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(screen.getByRole('button', { name: 'New stock category' }))

    const drawer = await screen.findByRole('dialog', { name: 'New stock category' })
    fireEvent.change(within(drawer).getByLabelText(/Category name/), { target: { value: '  Spare Parts  ' } })
    fireEvent.change(within(drawer).getByLabelText('Alias'), { target: { value: 'SP' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create category' }))

    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({ cat_name: 'Spare Parts', cat_alias: 'SP', is_active: 1 }),
    )
  })

  it('will not submit an empty name, and does not call the API to find out', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(screen.getByRole('button', { name: 'New stock category' }))
    const drawer = await screen.findByRole('dialog', { name: 'New stock category' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create category' }))
    await waitFor(() => expect(within(drawer).getByText('Category name is required.')).toBeTruthy())
    expect(h.create).not.toHaveBeenCalled()
  })

  it('opens the duplicate drawer with a name of its own', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(within(rowFor('Raw Material')).getByRole('button', { name: /Duplicate Raw Material/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Duplicate stock category' })
    expect((within(drawer).getByLabelText(/Category name/) as HTMLInputElement).value).toBe('Raw Material (copy)')
  })

  it('says the AI service is not connected instead of showing analysis', async () => {
    renderPage()
    await rowsReady()
    fireEvent.click(screen.getAllByRole('button', { name: /Analyse categories/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText(/not connected yet/)).toBeTruthy())
    expect(h.analyse).toHaveBeenCalled()
  })

  it('hides every write action from a read-only profile', async () => {
    h.state.permissions = new Set(['masters.stock_categories.read'])
    renderPage()
    await rowsReady()
    expect(screen.queryByRole('button', { name: 'New stock category' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    fireEvent.click(within(rowFor('Raw Material')).getByRole('button', { name: /More actions/ }))
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).toBeNull()
  })

  it('tells a profile with no read permission why the page is empty', async () => {
    h.state.permissions = new Set<string>()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/do not have permission to view stock categories/)).toBeTruthy(),
    )
  })
})
