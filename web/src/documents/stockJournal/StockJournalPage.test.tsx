import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { specForCode } from '../registry'
import type { ItemSearchRow } from '../../services/lookupApi'

/*
 * The screen, end to end, against mocked services.
 *
 * What is pinned here is the behaviour a stock journal cannot get wrong: the
 * document context reaches the payload, the default warehouse never overwrites a
 * warehouse the user chose, posting always goes through a confirmation, and a
 * profile that may not post is not offered the button.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, permissions: [], profile: null, member: null, allowedWarehouses: null, isOwner: true, error: null, reload: vi.fn() }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
  }),
}))

const WAREHOUSES = [
  { warehouse_id: 5, warehouse_name: 'Main', warehouse_code: 'WH-MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 6, warehouse_name: 'Store 2', warehouse_code: 'WH2', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
    units: [],
    defaultWarehouseId: 5,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('../useAvailability', () => ({ useAvailability: () => ({ results: {}, checking: false }) }))

const settingsGet = vi.fn(async () => ({ base_currency_code: 'INR', negative_stock_policy: 'warn' }))
const periodLocks = vi.fn(async () => [])
vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    get: (...a: unknown[]) => settingsGet(...(a as [])),
    periodLocks: (...a: unknown[]) => periodLocks(...(a as [])),
  },
}))

function item(id = 11, name = 'Blue Widget'): ItemSearchRow {
  return {
    item_id: id,
    item_name: name,
    item_alias: null,
    print_name: null,
    item_sku: `SKU-${id}`,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 1,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: null,
    units: [{ unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
  }
}

const searchItems = vi.fn(async () => [item()])
vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: (...a: unknown[]) => searchItems(...(a as [])),
    itemsByIds: vi.fn(async () => []),
    batches: vi.fn(async () => ({ data: [] })),
    serials: vi.fn(async () => ({ data: [] })),
    createBatch: vi.fn(),
    bulkCreateSerials: vi.fn(),
  },
}))

const create = vi.fn(async (_payload?: unknown) => ({ document_id: 77, document_no: 'SJ-2026-00128', status: 'DRAFT', lines: [], warnings: [] }))
const update = vi.fn(async (_id?: number, _payload?: unknown) => ({ document_id: 77, document_no: 'SJ-2026-00128', status: 'DRAFT', lines: [], warnings: [] }))
const post = vi.fn(async (_id?: number, _options?: unknown) => ({ document_id: 77, document_no: 'SJ-2026-00128', status: 'POSTED', lines: [], warnings: [] }))
vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (...a: unknown[]) => create(...(a as [])),
    update: (...a: unknown[]) => update(...(a as [])),
    post: (...a: unknown[]) => post(...(a as [])),
    auditTrail: vi.fn(async () => ({ data: [] })),
  },
}))

const notifySuccess = vi.fn()
const notifyError = vi.fn()
vi.mock('../../ui/notify', () => ({
  notify: { success: (m: string) => notifySuccess(m), error: (m: string) => notifyError(m), info: vi.fn(), emit: vi.fn() },
  setNotifier: vi.fn(),
}))

import { StockJournalPage } from './StockJournalPage'

const SPEC = specForCode('STOCK_JOURNAL')!

function renderPage() {
  return render(
    <MemoryRouter>
      <StockJournalPage spec={SPEC} onSaved={vi.fn()} />
    </MemoryRouter>,
  )
}

/**
 * Fill line `lineNumber` (1-based) with an item and a quantity.
 *
 * A picked row collapses its typeahead into a chip, so the first REMAINING
 * search box is always the next empty row — indexing the full list would drift.
 */
async function fillRow(lineNumber: number, qty: string) {
  const search = screen.getAllByRole('combobox', { name: 'Search item' })[0]
  fireEvent.focus(search)
  fireEvent.change(search, { target: { value: 'wid' } })
  const option = await screen.findByRole('option', { name: /Blue Widget/ })
  fireEvent.mouseDown(option)
  fireEvent.change(screen.getByLabelText(`Quantity for line ${lineNumber}`), { target: { value: qty } })
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockClear()
  update.mockClear()
  post.mockClear()
  notifySuccess.mockClear()
  notifyError.mockClear()
  window.localStorage.clear()
})

describe('the stock journal screen', () => {
  it('renders the document zones the operator works through', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'New Stock Journal' })).toBeTruthy()
    expect(screen.getByText('Adjust, transfer or reclassify stock with complete traceability.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Basic Details' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI Assistant' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Stock Journal Lines' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Document Summary' })).toBeTruthy()
    expect(screen.getByText('All changes are tracked with full audit trail')).toBeTruthy()
  })

  it('pre-fills the default warehouse on the starting rows', () => {
    renderPage()
    expect((screen.getByLabelText('Warehouse for line 1') as HTMLSelectElement).value).toBe('5')
  })

  it('keeps a warehouse the user chose when the header default changes', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Warehouse for line 1'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(/Default warehouse/), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(/Default warehouse/), { target: { value: '5' } })
    // Row 1 was set by hand, so it stays; row 2 was never touched, so it follows.
    expect((screen.getByLabelText('Warehouse for line 1') as HTMLSelectElement).value).toBe('6')
    expect((screen.getByLabelText('Warehouse for line 2') as HTMLSelectElement).value).toBe('5')
  })

  it('adds a line with Alt+N', () => {
    renderPage()
    expect(screen.getAllByRole('combobox', { name: 'Search item' })).toHaveLength(2)
    fireEvent.keyDown(window, { key: 'n', altKey: true })
    expect(screen.getAllByRole('combobox', { name: 'Search item' })).toHaveLength(3)
  })

  it('totals in, out and net live as quantities are typed', async () => {
    renderPage()
    await fillRow(1, '10')
    fireEvent.change(screen.getByLabelText('Direction for line 1'), { target: { value: 'out' } })
    await fillRow(2, '4')
    fireEvent.change(screen.getByLabelText('Direction for line 2'), { target: { value: 'in' } })

    await waitFor(() => {
      expect(screen.getByText('Total Outward').parentElement?.textContent).toContain('10')
      expect(screen.getByText('Total Inward').parentElement?.textContent).toContain('4')
      expect(screen.getByText('Net Movement').parentElement?.textContent).toContain('-6')
    })
  })

  it('computes the row amount from quantity and rate', async () => {
    renderPage()
    await fillRow(1, '10')
    fireEvent.change(screen.getByLabelText('Rate for line 1'), { target: { value: '12.5' } })
    await waitFor(() => expect(screen.getByText('125')).toBeTruthy())
  })

  it('sends the header and the line through to the draft payload', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/Reason code/), { target: { value: 'DAMAGE' } })
    await fillRow(1, '10')

    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    const payload = create.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(payload.document_type).toBe('STOCK_JOURNAL')
    expect(payload.reason_code).toBe('DAMAGE')
    const lines = payload.lines as Record<string, unknown>[]
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ item_id: 11, warehouse_id: 5, qty: 10, direction: 'out' })
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('SJ-2026-00128'))
  })

  it('refuses to post without a reason code, and does not call the API', async () => {
    renderPage()
    await fillRow(1, '10')
    fireEvent.click(screen.getByRole('button', { name: /Save & Post/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Post Stock Journal' }))
    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(post).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('never posts straight from the button — the confirmation comes first', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/Reason code/), { target: { value: 'DAMAGE' } })
    await fillRow(1, '10')

    fireEvent.click(screen.getByRole('button', { name: /Save & Post/ }))
    expect(post).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Post Stock Journal?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Post Stock Journal' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe(77)
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('posted successfully'))
  })

  it('hides the post action from a profile that may not post', () => {
    can.mockImplementation((key) => {
      const keys = Array.isArray(key) ? key : [key as string]
      return !keys.some((k) => k.includes('.post'))
    })
    renderPage()
    expect(screen.queryByRole('button', { name: /Save & Post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeTruthy()
  })

  it('asks before deleting a row that holds work, and not before an empty one', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete line 2' }))
    expect(screen.queryByRole('heading', { name: 'Delete this line?' })).toBeNull()

    await fillRow(1, '3')
    fireEvent.click(screen.getByRole('button', { name: 'Delete line 1' }))
    expect(await screen.findByRole('heading', { name: 'Delete this line?' })).toBeTruthy()
  })

  it('shows the empty state once every line is gone', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete line 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete line 1' }))
    expect(screen.getByText('No stock journal lines yet.')).toBeTruthy()
    expect(screen.getByText(/Search an item, scan a barcode, paste from Excel/)).toBeTruthy()
  })

  it('fills the reason from a quick chip without touching the lines', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ Damage / Breakage' }))
    expect((screen.getByLabelText(/Reason code/) as HTMLInputElement).value).toBe('Damage')
    expect((screen.getByLabelText('Movement reason') as HTMLInputElement).value).toBe('Damaged in transit')
    expect(screen.getAllByRole('combobox', { name: 'Search item' })).toHaveLength(2)
  })

  it('lets a column be hidden from the grid', () => {
    renderPage()
    expect(screen.getByLabelText('Rate for line 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Column Settings/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Rate/ }))
    expect(screen.queryByLabelText('Rate for line 1')).toBeNull()
  })
})
