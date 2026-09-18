import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CreateDocumentPayload, InventoryDocument } from '../types'
import type { ItemSearchRow } from '../../services/lookupApi'

/*
 * The assembly screen's contract, held end to end:
 *
 *   components are the OUT lines, the assembled item is the IN line, and the document that posts
 *   is an ordinary ASSEMBLY built by the same `toPayload` every other editor uses;
 *   the cost on screen is the INVENTORY valuation cost, fetched per item, and it is absent —
 *   not blanked — for a profile that may not see it;
 *   nothing posts until the form is complete, and the reasons are named.
 */

const permissions = new Set<string>([
  'documents.read',
  'documents.create',
  'documents.edit',
  'documents.assembly.create',
  'documents.assembly.post',
  'reports.valuation.read',
])

const can = (key: string | readonly string[]) =>
  typeof key === 'string' ? permissions.has(key) : key.some((k) => permissions.has(k))

const create = vi.fn<(payload: CreateDocumentPayload) => Promise<InventoryDocument>>()
const post = vi.fn<(id: number, options?: unknown) => Promise<InventoryDocument>>()
const unitCosts = vi.fn<(ids: number[]) => Promise<{ item_id: number; unit_cost: number; valuation_method_applied: string | null }[]>>()

function item(partial: Partial<ItemSearchRow> & { item_id: number; item_name: string }): ItemSearchRow {
  return {
    item_alias: null,
    print_name: null,
    item_sku: `SKU-${partial.item_id}`,
    item_upc: null,
    hsn_sac: null,
    mrp: null,
    unit_id: 5,
    unit_symbol: 'Nos',
    track_batch: 0,
    track_serial: 0,
    valuation_method: null,
    default_warehouse_id: null,
    units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
    ...partial,
  }
}

const CATALOGUE = [
  item({ item_id: 11, item_name: 'Steel frame' }),
  item({ item_id: 12, item_name: 'Table top' }),
  item({ item_id: 90, item_name: 'Office table (assembled)' }),
]

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    companyName: 'Acme Ltd',
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, permissions: [...permissions], isOwner: false }),
  useCan: () => true,
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main', warehouse_code: 'MN', is_default: 1, bo_id: 0 },
      { warehouse_id: 4, warehouse_name: 'HQ', warehouse_code: 'HQ', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: (id: number | null) => (id === 3 ? 'Main' : id === 4 ? 'HQ' : ''),
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (payload: CreateDocumentPayload) => create(payload),
    post: (id: number, options?: unknown) => post(id, options),
    update: vi.fn(),
    get: vi.fn(),
    list: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 5, offset: 0 } })),
    linesFor: vi.fn(async () => ({})),
  },
  newIdempotencyKey: () => 'test-key',
}))

vi.mock('../../services/valuationApi', () => ({
  valuationApi: { unitCosts: (ids: number[]) => unitCosts(ids) },
}))

vi.mock('../../services/stockApi', () => ({
  availabilityApi: {
    check: vi.fn(async (lines: { item_id: number; qty: number }[]) => ({
      ok: true,
      lines: lines.map((l, index) => ({
        index,
        item_id: l.item_id,
        requested: l.qty,
        available: 100,
        on_hand: 100,
        ok: true,
      })),
    })),
    forItems: vi.fn(async () => [{ item_id: 90, on_hand: 25, available: 25 }]),
    balances: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0 } })),
  },
  shortBy: (r: { short_by?: number; shortfall?: number }) => Number(r.short_by ?? r.shortfall ?? 0) || 0,
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: vi.fn(async (q: string) =>
      CATALOGUE.filter((row) => row.item_name.toLowerCase().includes(q.toLowerCase())),
    ),
    itemsByIds: vi.fn(async () => []),
    boms: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 100, offset: 0 } })),
    bom: vi.fn(),
    explodeBom: vi.fn(),
    batches: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 200, offset: 0 } })),
    serials: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 500, offset: 0 } })),
  },
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: vi.fn(async () => ({ base_currency_code: 'INR' })) },
}))

const { AssemblyPage } = await import('./AssemblyPage')
const { specForCode } = await import('../registry')
const spec = specForCode('ASSEMBLY')!

function saved(id: number, no: string): InventoryDocument {
  return { document_id: id, document_no: no, status: 'DRAFT', lines: [] } as unknown as InventoryDocument
}

function renderPage(onSaved = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/documents/new/assembly']}>
      <AssemblyPage spec={spec} onSaved={onSaved} />
    </MemoryRouter>,
  )
}

/**
 * Type into a typeahead and click the suggestion it offers.
 *
 * Found by placeholder, not by role: a native `<select>` also reports `combobox`, and this page
 * has several of them (warehouse, unit) ahead of the item field in the DOM.
 */
async function pickItem(input: HTMLElement, name: string) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: name } })
  const option = await screen.findByRole('option', { name: new RegExp(name, 'i') }, { timeout: 3000 })
  fireEvent.mouseDown(option)
}

function componentSearch(row = 0): HTMLElement {
  return screen.getAllByPlaceholderText(/search item by name, sku or barcode/i)[row]
}

function finishedSearch(): HTMLElement {
  return screen.getByPlaceholderText(/search finished item/i)
}

beforeEach(() => {
  vi.clearAllMocks()
  permissions.add('reports.valuation.read')
  create.mockResolvedValue(saved(501, 'ASM-00024'))
  post.mockResolvedValue({ ...saved(501, 'ASM-00024'), status: 'POSTED', warnings: [] } as InventoryDocument)
  unitCosts.mockResolvedValue([
    { item_id: 11, unit_cost: 1200, valuation_method_applied: 'FIFO' },
    { item_id: 12, unit_cost: 800, valuation_method_applied: 'FIFO' },
  ])
})

describe('AssemblyPage', () => {
  it('shows both halves of the document and the summary figures', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /new assembly/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /components \(materials out\)/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /assembled item \(finished good\)/i })).toBeTruthy()
    expect(screen.getByText(/components cost/i)).toBeTruthy()
    expect(screen.getByText(/estimated unit cost/i)).toBeTruthy()
    // Breadcrumb keeps the reader inside Documents › Assembly.
    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i })
    expect(within(crumbs).getByText('Documents')).toBeTruthy()
    expect(within(crumbs).getByText('Assembly')).toBeTruthy()
  })

  it('prices components from the inventory valuation cost and divides by the output quantity', async () => {
    renderPage()
    await pickItem(componentSearch(), 'Steel frame')

    const qty = await screen.findByLabelText('Quantity for component 1')
    fireEvent.change(qty, { target: { value: '2' } })

    await waitFor(() => expect(unitCosts).toHaveBeenCalled())
    // 2 × 1200 = 2400 over an output of 1.
    await waitFor(() => expect(screen.getAllByText('₹ 2,400.00').length).toBeGreaterThan(0))
  })

  it('posts the components as out lines and the assembled item as the in line', async () => {
    const onSaved = vi.fn()
    renderPage(onSaved)

    await pickItem(componentSearch(), 'Steel frame')
    fireEvent.change(await screen.findByLabelText('Quantity for component 1'), { target: { value: '2' } })
    await pickItem(finishedSearch(), 'Office table')

    await waitFor(() => expect(unitCosts).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('ASSEMBLY')
    expect(payload.lines.map((l) => [l.item_id, l.direction, l.qty])).toEqual([
      [11, 'out', 2],
      [90, 'in', 1],
    ])
    // The kit enters stock at what the components cost, not at whatever it last cost.
    expect(payload.lines[1].valuation_rate).toBe(2400)
    expect(payload.lines[0].valuation_rate).toBeUndefined()
    expect(payload.metadata?.assembly_mode).toBe('standard')

    await waitFor(() => expect(post).toHaveBeenCalledWith(501, { negativeOverride: false }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSaved.mock.calls[0][1]).toBe(true)
  })

  it('refuses to post an incomplete assembly and says what is missing', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))

    // The summary lists it and the field beneath repeats it, so both are expected.
    await waitFor(() => expect(screen.getByText('Add at least one component.')).toBeTruthy())
    expect(screen.getAllByText('Select a finished item.').length).toBeGreaterThan(0)
    expect(create).not.toHaveBeenCalled()
  })

  it('will not let an assembly consume the item it builds', async () => {
    renderPage()
    await pickItem(componentSearch(), 'Office table')
    fireEvent.change(await screen.findByLabelText('Quantity for component 1'), { target: { value: '1' } })
    await pickItem(finishedSearch(), 'Office table')

    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))
    await waitFor(() =>
      expect(screen.getAllByText('The assembled item cannot also be one of its own components.').length).toBeGreaterThan(0),
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('hides inventory cost entirely from a profile without the valuation permission', async () => {
    permissions.delete('reports.valuation.read')
    renderPage()

    expect(screen.queryByText(/components cost/i)).toBeNull()
    expect(screen.queryByText(/estimated unit cost/i)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /unit cost/i })).toBeNull()
    expect(screen.getByText(/your profile does not hold the stock valuation permission/i)).toBeTruthy()
    // …and it never asks the API for a figure it may not show.
    await waitFor(() => expect(unitCosts).not.toHaveBeenCalled())
  })

  it('adds a component row and keeps the warehouse the header set', async () => {
    renderPage()
    expect(screen.getAllByLabelText(/^Warehouse for component/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^add component$/i }))
    await waitFor(() => expect(screen.getAllByLabelText(/^Warehouse for component/)).toHaveLength(3))
    const third = screen.getByLabelText('Warehouse for component 3') as HTMLSelectElement
    expect(third.value).toBe('3')
  })
})
