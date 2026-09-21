import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ItemSearchRow } from '../../services/lookupApi'
import { specForCode } from '../registry'

/*
 * The screen a user lands on at /documents/new/material_issue.
 *
 * Typecheck cannot see that a hook order is wrong, that a picker was handed a
 * prop it does not take, or that posting skips the reason code — so the page is
 * mounted here against mocked services and actually driven.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const searchItems = vi.fn<(q: string) => Promise<ItemSearchRow[]>>()
const create = vi.fn()
const post = vi.fn()
const documentsList = vi.fn()
const availabilityCheck = vi.fn()

function itemRow(partial: Partial<ItemSearchRow> = {}): ItemSearchRow {
  return {
    item_id: 5,
    item_name: 'Gear Shaft',
    item_alias: null,
    print_name: null,
    item_sku: 'GS-001',
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: 3,
    units: [{ unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
    stock: { on_hand: 24, available: 24, reserved: 0 },
    ...partial,
  }
}

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    warning: null,
  }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main', warehouse_code: 'MN', is_default: 1, bo_id: 0 },
      { warehouse_id: 4, warehouse_name: 'Spares', warehouse_code: 'SP', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: (id: number | null) => (id === 3 ? 'Main' : id === 4 ? 'Spares' : ''),
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: (q: string) => searchItems(q),
    itemsByIds: async () => [],
    batches: async () => ({ data: [], meta: {} }),
    serials: async () => ({ data: [], meta: {} }),
  },
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: (query: Record<string, unknown>) => documentsList(query),
    create: (payload: unknown) => create(payload),
    post: (id: number, options: unknown) => post(id, options),
  },
  newIdempotencyKey: () => 'test-key',
}))

vi.mock('../../services/stockApi', () => ({
  availabilityApi: { check: (lines: unknown[]) => availabilityCheck(lines) },
  shortBy: (r: { short_by?: number }) => Number(r.short_by ?? 0),
}))

vi.mock('../../services/reportsApi', () => ({
  fetchReport: async () => ({ data: [], meta: {}, summary: { closing_qty: 12420, closing_value: 0, rows: 1, by_warehouse: [], to: '2026-09-18' }, report: 'warehouse_stock' }),
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: async () => ({ base_currency_code: 'INR', negative_stock_policy: 'block' }) },
}))

const { MaterialIssuePage } = await import('./MaterialIssuePage')

const SPEC = specForCode('MATERIAL_ISSUE')!

function renderPage() {
  return render(
    <MemoryRouter>
      <MaterialIssuePage spec={SPEC} onSaved={() => {}} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  can.mockReturnValue(true)
  searchItems.mockResolvedValue([itemRow()])
  documentsList.mockResolvedValue({ data: [], meta: {}, summary: { documents: 4, line_count: 320, valuation_total: 248320, warehouses_impacted: 1 } })
  availabilityCheck.mockResolvedValue({ ok: true, lines: [{ index: 0, item_id: 5, requested: 2, available: 24, on_hand: 24, ok: true }] })
  create.mockResolvedValue({ document_id: 91, document_no: 'MI-0001', status: 'DRAFT', lines: [] })
  post.mockResolvedValue({ document_id: 91, document_no: 'MI-0001', status: 'POSTED', lines: [], warnings: [] })
})

describe('MaterialIssuePage', () => {
  it('renders the document, the lines grid and the rail', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Material issue' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Standard Issue' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('columnheader', { name: 'Item / SKU' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Available' })).toBeTruthy()
    expect(screen.getByText('Aicountly AI assistant')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
    // The stock figure is the report's, not a number typed into the component.
    await waitFor(() => expect(screen.getByText('12,420')).toBeTruthy())
  })

  it('defaults the warehouse from reference data', async () => {
    renderPage()
    const select = screen.getByLabelText(/Default warehouse/i) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('3'))
  })

  it('switches the issue mode and asks for a production reference', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Against Production' }))
    expect(screen.getByRole('tab', { name: 'Against Production' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Production document')).toBeTruthy()
    // Standard mode asks for a plain reference number instead.
    fireEvent.click(screen.getByRole('tab', { name: 'Standard Issue' }))
    expect(screen.getByText('Reference no.')).toBeTruthy()
  })

  it('counts the narration against its limit', () => {
    renderPage()
    const narration = screen.getByLabelText(/Narration/i)
    fireEvent.change(narration, { target: { value: 'Issued to the press shop' } })
    expect(screen.getByText('24/500')).toBeTruthy()
  })

  it('refuses to post without a reason code and marks the field itself', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(screen.getAllByText('A reason code is required to post an issue.').length).toBeGreaterThan(0))
    // On the field, not only in the summary notice: `busy` is already null by
    // the time this renders, so deriving the message from it silently dropped it.
    const reason = screen.getByLabelText(/Reason code/i)
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'DAMAGE' } })
    await waitFor(() => expect(screen.queryByText('A reason code is required to post an issue.')).toBeNull())
    expect(reason.getAttribute('aria-invalid')).toBeNull()
  })

  it('does not ask for a reason code when only saving a draft', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(screen.queryByText(/reason code is required/i)).toBeNull())
    // It still stops on the lines, which a draft does need.
    expect(screen.getAllByText('Add at least one item to issue.').length).toBeGreaterThan(0)
  })

  it('saves a draft with the issue mode and reference in metadata', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/Reason code/i), { target: { value: 'production' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Sample Issue' }))

    // Not getAllByRole('combobox')[0]: a plain <select> carries that role too,
    // so the first match is the warehouse dropdown, not the item search.
    const search = screen.getAllByPlaceholderText(/Search item by name/i)[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'gear' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Gear Shaft/ }))

    const qty = await screen.findByLabelText('Quantity for line 1')
    fireEvent.change(qty, { target: { value: '2' } })

    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalled())

    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('MATERIAL_ISSUE')
    expect(payload.reason_code).toBe('PRODUCTION')
    expect(payload.metadata.issue_mode).toBe('sample')
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 5, qty: 2, warehouse_id: 3 })
    expect(post).not.toHaveBeenCalled()
  })

  it('hides posting from a user who may not post', () => {
    can.mockImplementation((key) => {
      const keys = Array.isArray(key) ? key : [key]
      return !keys.some((k) => String(k).includes('.post'))
    })
    renderPage()
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })

  it('fills the empty first row from the footer search instead of appending past it', async () => {
    renderPage()
    const footer = screen.getAllByPlaceholderText(/Search item by name/i).slice(-1)[0]
    fireEvent.focus(footer)
    fireEvent.change(footer, { target: { value: 'gear' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Gear Shaft/ }))

    const grid = within(screen.getAllByRole('table')[0])
    // Header plus exactly one line: no stray blank row left above it.
    await waitFor(() => expect(grid.getAllByRole('row')).toHaveLength(2))
    expect(grid.getByText('GS-001')).toBeTruthy()
  })

  it('adds five rows on demand', () => {
    renderPage()
    expect(screen.getAllByRole('row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 rows' }))
    // One header row plus the original line plus five.
    expect(screen.getAllByRole('row')).toHaveLength(7)
  })

  it('shows availability against the line once it is checked', async () => {
    renderPage()
    const search = screen.getAllByPlaceholderText(/Search item by name/i)[0]
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'gear' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Gear Shaft/ }))
    fireEvent.change(await screen.findByLabelText('Quantity for line 1'), { target: { value: '2' } })

    await waitFor(() => expect(availabilityCheck).toHaveBeenCalled())
    const grid = within(screen.getAllByRole('table')[0])
    await waitFor(() => expect(grid.getByText('24')).toBeTruthy())
    expect(grid.getByText('22 after')).toBeTruthy()
  })
})
