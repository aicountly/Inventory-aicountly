import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DocumentFormPage } from './DocumentFormPage'

/*
 * A render-level check that the revamped Opening Stock screen actually mounts
 * end to end — header chrome, AI/help cards, summary strip, the items table
 * with its toolbar, quick actions and the sticky action bar — plus two of the
 * new bulk-add paths, without a live backend. Unit tests already cover the
 * pure logic (openingStockHelpers.test.ts, csv.test.ts); this is the part
 * only a mounted component tree can catch (wrong prop, hook mis-order, a
 * component that throws on first paint).
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const searchItems = vi.fn()

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can,
    loading: false,
    member: { uuid: 'user-a' },
    profile: { profile_name: 'Owner', template_key: 'owner' },
  }),
  useCan: () => true,
}))

vi.mock('./useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main', warehouse_code: null, warehouse_type: 'general', is_default: 1, bo_id: 0 }],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../services/lookupApi', () => ({
  lookupApi: {
    searchItems: (...args: unknown[]) => searchItems(...args),
    itemsByIds: vi.fn(async () => []),
    batches: vi.fn(async () => ({ data: [], meta: {} })),
    serials: vi.fn(async () => ({ data: [], meta: {} })),
  },
}))

vi.mock('../services/documentsApi', () => ({
  documentsApi: {
    list: vi.fn(async () => ({ data: [], meta: { total: 0 } })),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../services/stockViewsApi', () => ({
  stockBalancesApi: { list: vi.fn(async () => ({ data: [], meta: { total: 0 } })) },
}))

function renderOpeningStock() {
  return render(
    <MemoryRouter initialEntries={['/documents/new/opening_stock']}>
      <Routes>
        <Route path="/documents/new/:slug" element={<DocumentFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset().mockReturnValue(true)
  searchItems.mockReset()
})

describe('Opening Stock — revamped create screen', () => {
  it('renders the full 2026 workspace chrome around the existing form', () => {
    renderOpeningStock()

    expect(screen.getByRole('heading', { name: /new opening stock/i })).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Aicountly AI Assistant')).toBeTruthy()
    expect(screen.getByText('Items in this document')).toBeTruthy()
    expect(screen.getByText('Total quantity')).toBeTruthy()
    expect(screen.getByText('Total value (INR)')).toBeTruthy()
    expect(screen.getByText('Quick actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: /scan barcode/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /add multiple items/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /import csv/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /download template/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /save draft/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /save & post/i })).toBeTruthy()
  })

  it('adds and removes item lines the same way the original form did', () => {
    renderOpeningStock()
    const table = screen.getByRole('table')
    const initialRows = within(table).getAllByRole('row').length

    fireEvent.click(screen.getByRole('button', { name: /^add line/i }))
    expect(within(table).getAllByRole('row').length).toBe(initialRows + 1)

    const removeButtons = within(table).getAllByRole('button', { name: /remove line/i })
    fireEvent.click(removeButtons[removeButtons.length - 1])
    expect(within(table).getAllByRole('row').length).toBe(initialRows)
  })

  it('Validate stock opens a drawer with the real validation errors for an empty draft', () => {
    renderOpeningStock()
    fireEvent.click(screen.getByRole('button', { name: /validate stock/i }))
    expect(screen.getByRole('heading', { name: /validate stock/i })).toBeTruthy()
    expect(screen.getByText(/at least one item line is required/i)).toBeTruthy()
  })

  it('the AI assistant and auto-fill rates say the service is not connected yet, never a fabricated result', () => {
    renderOpeningStock()
    fireEvent.click(screen.getByRole('button', { name: /use ai/i }))
    expect(screen.getAllByText(/will be connected through the aicountly ai service/i).length).toBeGreaterThan(0)
  })

  it('Add multiple items searches live and appends the picked items as new lines', async () => {
    searchItems.mockResolvedValue([
      { item_id: 501, item_name: 'Steel Rod 12mm', item_alias: null, print_name: null, item_sku: 'ROD-12', item_upc: null, hsn_sac: null, mrp: null, unit_id: 1, unit_symbol: 'PCS', track_batch: 0, track_serial: 0, valuation_method: 'FIFO', default_warehouse_id: null, units: [] },
    ])

    renderOpeningStock()
    fireEvent.click(screen.getByRole('button', { name: /add multiple items/i }))

    const search = await screen.findByRole('textbox', { name: /search items/i })
    fireEvent.change(search, { target: { value: 'rod' } })

    await waitFor(() => expect(searchItems).toHaveBeenCalled())
    const option = await screen.findByText('Steel Rod 12mm')
    fireEvent.click(option.closest('label')!.querySelector('input[type="checkbox"]')!)

    fireEvent.click(screen.getByRole('button', { name: /add 1 item/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Steel Rod 12mm', { selector: 'table *' })).toBeTruthy()
  })
})
