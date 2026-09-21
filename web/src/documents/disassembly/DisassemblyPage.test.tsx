import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CreateDocumentPayload } from '../types'
import type { ItemSearchRow } from '../../services/lookupApi'

/*
 * The disassembly screen, end to end in the browser.
 *
 * What these hold is the thing the old screen got wrong: the direction of each line is decided by
 * which side of the workspace it sits on, not by a dropdown the user has to understand, and the
 * summary under the lines counts the rows that are actually on screen.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const create = vi.fn<(p: CreateDocumentPayload) => Promise<unknown>>()
const post = vi.fn()
const searchItems = vi.fn<(q: string) => Promise<ItemSearchRow[]>>()
const unitCosts = vi.fn()
const availabilityCheck = vi.fn()

function item(partial: Partial<ItemSearchRow> & { item_id: number; item_name: string }): ItemSearchRow {
  return {
    item_alias: null,
    print_name: null,
    item_sku: null,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 9,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: 3,
    units: [{ unit_id: 9, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
    ...partial,
  }
}

const LAPTOP = item({ item_id: 1, item_name: 'Laptop - Pro Model', item_sku: 'LP-PRO-001' })
const BOARD = item({ item_id: 2, item_name: 'Motherboard', item_sku: 'MB-001' })

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
  }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null, isOwner: true }),
  useCan: () => true,
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main', warehouse_code: null, is_default: 1, bo_id: 0 }],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (p: CreateDocumentPayload) => create(p),
    update: vi.fn(),
    post: (id: number) => post(id),
    list: vi.fn(async () => ({ data: [], meta: {} })),
    get: vi.fn(),
  },
  newIdempotencyKey: () => 'test-key',
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: (q: string) => searchItems(q),
    itemsByIds: vi.fn(async () => []),
    boms: vi.fn(async () => ({ data: [], meta: {} })),
    bom: vi.fn(),
    batches: vi.fn(async () => ({ data: [], meta: {} })),
    serials: vi.fn(async () => ({ data: [], meta: {} })),
    byBarcode: vi.fn(),
    itemByBarcode: vi.fn(),
  },
}))

vi.mock('../../services/stockApi', () => ({
  availabilityApi: { check: (lines: unknown[]) => availabilityCheck(lines) },
  shortBy: (r: { short_by?: number }) => Number(r.short_by ?? 0),
}))

vi.mock('../../services/valuationApi', () => ({
  valuationApi: { unitCosts: (ids: number[]) => unitCosts(ids) },
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    get: vi.fn(async () => ({ base_currency_code: 'INR', default_valuation_method: 'FIFO', negative_stock_policy: 'block' })),
    periodLocks: vi.fn(async () => []),
  },
  NEGATIVE_STOCK_POLICIES: ['allow', 'warn', 'block'],
  VALUATION_METHODS: ['FIFO', 'LIFO', 'WAC'],
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), notify: vi.fn() }),
}))

const { DisassemblyPage } = await import('./DisassemblyPage')
const { specForCode } = await import('../registry')
const spec = specForCode('DISASSEMBLY')!

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/documents/new/disassembly']}>
      <DisassemblyPage spec={spec} />
    </MemoryRouter>,
  )
}

/** Drive the item typeahead of one side the way a user does. */
async function pickItem(role: 'finished' | 'component', row: ItemSearchRow) {
  const region = screen.getByRole('region', { name: role === 'finished' ? 'Finished product' : 'Components' })
  const input = within(region).getByPlaceholderText('Search item by name, SKU or barcode…')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: row.item_name } })
  // The suggestion list is rendered in a body portal (so the scrolling line table cannot clip
  // it), which puts it outside the section the input lives in — hence `screen`, not `within`.
  const option = await screen.findByRole('option', { name: new RegExp(row.item_name, 'i') })
  fireEvent.mouseDown(option)
}

beforeEach(() => {
  can.mockReturnValue(true)
  searchItems.mockImplementation(async (q: string) => [LAPTOP, BOARD].filter((i) => i.item_name.toLowerCase().includes(q.toLowerCase())))
  unitCosts.mockResolvedValue([
    { item_id: 1, unit_cost: 16000, valuation_method_applied: 'FIFO' },
    { item_id: 2, unit_cost: 8500, valuation_method_applied: 'FIFO' },
  ])
  availabilityCheck.mockResolvedValue({ ok: true, lines: [{ index: 0, item_id: 1, requested: 1, available: 12, on_hand: 12, ok: true }] })
  create.mockResolvedValue({ document_id: 88, document_no: 'DIS-000124', status: 'DRAFT', lines: [] })
  post.mockResolvedValue({ document_id: 88, document_no: 'DIS-000124', status: 'POSTED', lines: [], warnings: [] })
})

describe('DisassemblyPage', () => {
  it('shows the two sides of the operation instead of a direction column', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /finished product/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^components$/i })).toBeTruthy()
    // The old screen's per-row "Dir." dropdown is what this replaces.
    expect(screen.queryByLabelText('Direction')).toBeNull()
    expect(screen.queryByText('DIR.')).toBeNull()
    expect(screen.getByText('Stock out')).toBeTruthy()
    expect(screen.getByText('Stock in')).toBeTruthy()
  })

  it('guides the user to the finished product before anything is picked', () => {
    renderPage()
    expect(screen.getByText(/Select the finished product you want to disassemble/i)).toBeTruthy()
    expect(screen.getByText(/Nothing entered yet/i)).toBeTruthy()
  })

  it('counts the rows that are on screen, never zero while components exist', async () => {
    renderPage()
    await pickItem('component', BOARD)
    fireEvent.change(screen.getByLabelText('Quantity produced, row 1'), { target: { value: '4' } })
    await waitFor(() => expect(screen.getByText(/1 component entered/i)).toBeTruthy())

    await pickItem('finished', LAPTOP)
    fireEvent.change(screen.getByLabelText('Quantity to disassemble, row 1'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText('1 component will be produced from 1 finished product.')).toBeTruthy())
  })

  it('posts the parent out and the components in, without the user setting a direction', async () => {
    renderPage()
    await pickItem('finished', LAPTOP)
    fireEvent.change(screen.getByLabelText('Quantity to disassemble, row 1'), { target: { value: '1' } })
    await pickItem('component', BOARD)
    fireEvent.change(screen.getByLabelText('Quantity produced, row 1'), { target: { value: '4' } })

    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('DISASSEMBLY')
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines[0]).toMatchObject({ item_id: 1, direction: 'out', qty: 1 })
    expect(payload.lines[1]).toMatchObject({ item_id: 2, direction: 'in', qty: 4 })
    await waitFor(() => expect(post).toHaveBeenCalledWith(88))
    expect(await screen.findByText(/DIS-000124 posted/i)).toBeTruthy()
  })

  it('refuses to post an empty document and says what is missing', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))
    expect(await screen.findByText('Pick the finished product you want to disassemble.')).toBeTruthy()
    expect(screen.getByText('Add at least one component this product breaks into.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('prices the components from the live valuation read', async () => {
    renderPage()
    await pickItem('component', BOARD)
    fireEvent.change(screen.getByLabelText('Quantity produced, row 1'), { target: { value: '2' } })
    await waitFor(() => expect((screen.getByLabelText('Estimated unit cost, row 1') as HTMLInputElement).value).toBe('8500'))
    expect(screen.getAllByText('₹ 17,000.00').length).toBeGreaterThan(0)
  })

  it('hides posting from a profile that may not post', () => {
    can.mockImplementation((key) => {
      const keys = typeof key === 'string' ? [key] : [...key]
      return !keys.some((k) => k.endsWith('.post'))
    })
    renderPage()
    expect(screen.queryByRole('button', { name: /save & post/i })).toBeNull()
    expect(screen.getByRole('button', { name: /save as draft/i })).toBeTruthy()
  })

  it('reports a shortfall on the row and blocks the post while the company blocks negative stock', async () => {
    availabilityCheck.mockResolvedValue({
      ok: false,
      lines: [{ index: 0, item_id: 1, requested: 5, available: 2, on_hand: 2, ok: false, short_by: 3 }],
    })
    renderPage()
    await pickItem('finished', LAPTOP)
    fireEvent.change(screen.getByLabelText('Quantity to disassemble, row 1'), { target: { value: '5' } })
    await pickItem('component', BOARD)
    fireEvent.change(screen.getByLabelText('Quantity produced, row 1'), { target: { value: '1' } })

    await waitFor(() => expect(screen.getAllByText(/short by/i).length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))
    await waitFor(() => expect(screen.getAllByText(/only 2 available/i).length).toBeGreaterThan(0))
    expect(create).not.toHaveBeenCalled()
  })

  it('works from the keyboard: Alt+N adds a component, Ctrl+S saves the draft', async () => {
    renderPage()
    await pickItem('component', BOARD)
    expect(screen.getAllByLabelText(/Quantity produced, row/)).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Quantity produced, row 1'), { target: { value: '2' } })

    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', altKey: true })
    await waitFor(() => expect(screen.getAllByLabelText(/Quantity produced, row/)).toHaveLength(2))

    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => expect(create).toHaveBeenCalled())
    // A draft saves what is entered so far; it does not demand the finished product first.
    expect(post).not.toHaveBeenCalled()
  })

  it('asks before leaving with unsaved changes', async () => {
    renderPage()
    await pickItem('component', BOARD)
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(await screen.findByText(/Leave without saving\?/i)).toBeTruthy()
  })

  it('offers the quick actions beside the document', () => {
    renderPage()
    const panel = screen.getByRole('heading', { name: 'Quick actions' }).parentElement as HTMLElement
    for (const label of ['Use BOM', 'Scan barcode', 'Recent', 'Copy document']) {
      expect(within(panel).getByText(label)).toBeTruthy()
    }
  })
})
