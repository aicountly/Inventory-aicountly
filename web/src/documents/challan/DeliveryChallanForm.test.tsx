import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeliveryChallanForm } from './DeliveryChallanForm'
import { specForCode } from '../registry'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { CreateDocumentPayload } from '../types'

/*
 * The screen a dispatch actually goes out on.
 *
 * These tests hold the two promises the rewrite has to keep: the entry loop
 * works (find an item, set a quantity, get a line), and what reaches the API is
 * still exactly the payload the shared document service has always accepted —
 * with no commercial field smuggled onto it.
 */

const spec = specForCode('DELIVERY_CHALLAN')!

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, profile: null, allowedWarehouses: null, isOwner: true }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 7, fy_id: 3, bo_id: 0 } }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 1, warehouse_name: 'Main', warehouse_code: 'MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
      { warehouse_id: 2, warehouse_name: 'Depot', warehouse_code: 'DEP', warehouse_type: 'store', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null | undefined) => (id === 1 ? 'Main' : id === 2 ? 'Depot' : ''),
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const searchItems = vi.fn<(q: string) => Promise<ItemSearchRow[]>>()
const batches = vi.fn()
const itemsByIds = vi.fn()

vi.mock('../../services/lookupApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lookupApi')>()
  return {
    ...actual,
    lookupApi: {
      ...actual.lookupApi,
      searchItems: (q: string) => searchItems(q),
      batches: (...args: unknown[]) => batches(...args),
      itemsByIds: (...args: unknown[]) => itemsByIds(...args),
      serials: () => Promise.resolve({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    },
  }
})

const check = vi.fn()

vi.mock('../../services/stockApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/stockApi')>()
  return {
    ...actual,
    availabilityApi: { ...actual.availabilityApi, check: (...args: unknown[]) => check(...args), forItems: () => Promise.resolve([]) },
    pendingApi: { list: () => Promise.resolve({ data: [], meta: { total: 0, limit: 0, offset: 0 } }) },
  }
})

vi.mock('../../services/partyApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/partyApi')>()
  return {
    ...actual,
    partyDirectory: {
      search: () => Promise.resolve([{ party_ref: 1042, party_name: 'Acme Ltd', last_document_date: '2026-09-01', last_document_no: 'DC-1', seen: 3 }]),
      context: () =>
        Promise.resolve({
          party_ref: 1042,
          open_challan_qty: 45,
          open_challan_lines: 3,
          open_challan_documents: 2,
          documents_on_record: 12,
          last_document_date: '2026-09-01',
          last_document_no: 'DC-1',
          last_document_type: 'Delivery Challan / Dispatch',
          commercial_available: false as const,
        }),
    },
  }
})

const create = vi.fn()
const post = vi.fn()

vi.mock('../../services/documentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/documentsApi')>()
  return {
    ...actual,
    documentsApi: {
      ...actual.documentsApi,
      create: (...args: unknown[]) => create(...args),
      post: (...args: unknown[]) => post(...args),
      update: vi.fn(),
      list: () => Promise.resolve({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    },
  }
})

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), notify: vi.fn() }
vi.mock('../../ui/ToastContext', () => ({ useToast: () => toast }))

const LAPTOP: ItemSearchRow = {
  item_id: 10,
  item_name: 'Laptop – Dell Inspiron 14',
  item_alias: null,
  print_name: null,
  item_sku: 'DEL-14-001',
  item_upc: '8901234567890',
  hsn_sac: null,
  mrp: null,
  unit_id: 5,
  unit_symbol: 'Nos',
  track_batch: 0,
  track_serial: 0,
  valuation_method: 'FIFO',
  default_warehouse_id: 1,
  grp_name: 'Electronics',
  cat_name: null,
  stock: { on_hand: 12, available: 12, reserved: 0 },
  units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
}

function renderForm(onSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <DeliveryChallanForm spec={spec} onSaved={onSaved} />
    </MemoryRouter>,
  )
}

/** Drive the entry bar the way a clerk does: search, pick, quantity, add. */
async function addLaptop(qty = '5') {
  const search = screen.getByRole('combobox', { name: /search items/i })
  fireEvent.focus(search)
  fireEvent.change(search, { target: { value: 'Laptop' } })
  const option = await screen.findByRole('option', { name: /Laptop – Dell Inspiron 14/ }, { timeout: 3000 })
  fireEvent.mouseDown(option)
  const qtyBox = screen.getByLabelText('Qty')
  fireEvent.change(qtyBox, { target: { value: qty } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await screen.findByTitle('Laptop – Dell Inspiron 14')
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  searchItems.mockReset()
  searchItems.mockResolvedValue([LAPTOP])
  batches.mockReset()
  batches.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } })
  itemsByIds.mockReset()
  itemsByIds.mockResolvedValue([])
  check.mockReset()
  check.mockResolvedValue({ ok: true, lines: [{ index: 0, item_id: 10, requested: 5, available: 12, on_hand: 12, ok: true }] })
  create.mockReset()
  create.mockResolvedValue({ document_id: 91, document_no: 'DC-2026-00124', status: 'DRAFT', lines: [] })
  post.mockReset()
  post.mockResolvedValue({ document_id: 91, document_no: 'DC-2026-00124', status: 'POSTED', lines: [], warnings: [] })
  Object.values(toast).forEach((fn) => fn.mockReset())
})

describe('the delivery challan screen', () => {
  it('opens on the item tab with the header, the entry bar and an empty line table', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: 'Delivery Challan / Dispatch' })).toBeTruthy()
    expect(screen.getByText('Dispatch goods to a customer ahead of the invoice.')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Item details/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('combobox', { name: /search items/i })).toBeTruthy()
    expect(screen.getByText('No items on this challan yet')).toBeTruthy()
  })

  it('defaults the document date and the warehouse without inventing a document number', () => {
    renderForm()
    expect((screen.getByLabelText(/Document date/) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((screen.getByLabelText(/Document no\./) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Document no\./) as HTMLInputElement).placeholder).toBe('Auto-generate')
    expect(screen.getByText('Leave empty to number automatically.')).toBeTruthy()
  })

  it('offers only the stock effects the type declares', () => {
    renderForm()
    const options = within(screen.getByLabelText('Stock effect') as HTMLSelectElement).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Challan only (pending)', 'Physical movement'])
  })

  it('adds a line from the entry bar and counts it in the summary', async () => {
    renderForm()
    await addLaptop('5')
    // Scoped to the table: focus returns to the search box after an add, so the
    // suggestion list is open again and names the same SKU.
    expect(within(screen.getByRole('table')).getByText('DEL-14-001')).toBeTruthy()
    const summary = within(screen.getByRole('region', { name: 'Quick summary' }))
    expect(summary.getByText('Total items').nextElementSibling?.textContent).toBe('1')
    expect(summary.getByText('Total quantity').nextElementSibling?.textContent).toBe('5')
  })

  it('shows the live availability the server answered, never a figure of its own', async () => {
    renderForm()
    await addLaptop('5')
    await waitFor(() => expect(check).toHaveBeenCalled(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('Main', { selector: 'span.block' })).toBeTruthy())
  })

  it('will not save an empty challan, and says what is missing', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(screen.getByText('Please fix before saving')).toBeTruthy())
    expect(screen.getByText('At least one item line is required.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('sends the shared document payload — quantities, no commercial fields', async () => {
    const onSaved = vi.fn()
    renderForm(onSaved)
    const customer = screen.getByRole('combobox', { name: 'Customer' })
    fireEvent.focus(customer)
    fireEvent.change(customer, { target: { value: 'Acme' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Acme Ltd/ }, { timeout: 3000 }))
    await addLaptop('5')

    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    const payload = create.mock.calls[0][0] as CreateDocumentPayload
    expect(payload.document_type).toBe('DELIVERY_CHALLAN')
    expect(payload.stock_effect).toBe('challan_only')
    expect(payload.party_ref).toBe(1042)
    expect(payload.party_name).toBe('Acme Ltd')
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 10, qty: 5, warehouse_id: 1, unit_id: 5 })
    // A challan moves goods, not money: nothing commercial may ride along.
    expect(payload.lines[0].rate).toBeUndefined()
    expect(payload.lines[0].amount).toBeUndefined()
    expect('total' in payload).toBe(false)
    expect('tax' in payload).toBe(false)
    expect(onSaved).toHaveBeenCalled()
  })

  it('writes transport details into the metadata the document already carries', async () => {
    renderForm()
    await addLaptop('2')
    fireEvent.click(screen.getByRole('tab', { name: /Transport & dispatch/ }))
    fireEvent.change(screen.getByLabelText(/Vehicle no\./), { target: { value: 'mh12ab1234' } })
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as CreateDocumentPayload
    expect(payload.metadata?.transport).toEqual({ vehicle_no: 'MH12AB1234' })
  })

  it('re-checks stock before posting and stops on a conflict instead of posting blind', async () => {
    renderForm()
    await addLaptop('5')
    check.mockResolvedValue({ ok: false, lines: [{ index: 0, item_id: 10, requested: 5, available: 4, on_hand: 4, ok: false, short_by: 1 }] })

    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(screen.getByText('Stock changed since this challan was prepared')).toBeTruthy(), { timeout: 3000 })
    expect(create).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('posts through the existing endpoints once stock is confirmed', async () => {
    renderForm()
    await addLaptop('5')
    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(91, { negativeOverride: false }), { timeout: 3000 })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('hides Save & post from a profile without the posting permission', () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).some((k) => k.includes('.post')))
    renderForm()
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })

  it('never offers a value, tax or total anywhere on the screen', async () => {
    renderForm()
    await addLaptop('5')
    const table = screen.getByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual(['#', 'Item', 'SKU', 'Warehouse', 'Batch', 'Unit', 'Qty', 'Serials', 'Availability', 'Actions'])
    // No commercial control exists anywhere on the form. (The summary card does
    // say in words that a challan carries none — that sentence is the promise,
    // not a breach of it, so the check is over controls rather than prose.)
    for (const label of [/rate/i, /price/i, /discount/i, /tax/i, /amount/i, /total value/i]) {
      expect(screen.queryAllByLabelText(label)).toEqual([])
    }
  })

  it('edits a saved draft in place, naming it and its status', async () => {
    const { newHeader, newLine } = await import('../formModel')
    const initial = {
      header: { ...newHeader(spec, '2026-09-18'), party_name: 'Acme Ltd', party_ref: '1042', metadata: { transport: { vehicle_no: 'MH12AB1234' } } },
      lines: [newLine(spec, { item_id: 10, item_name: 'Laptop – Dell Inspiron 14', item_sku: 'DEL-14-001', unit_id: 5, warehouse_id: 1, qty: '5' })],
    }
    render(
      <MemoryRouter>
        <DeliveryChallanForm spec={spec} documentId={91} initial={initial} status="DRAFT" documentNo="DC-2026-00124" version={2} onSaved={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /Edit delivery challan \/ dispatch DC-2026-00124/i })).toBeTruthy()
    expect(screen.getByText('Version 2')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('DEL-14-001')).toBeTruthy()
    // Stored transport metadata comes back into the tab it was typed in.
    fireEvent.click(screen.getByRole('tab', { name: /Transport & dispatch/ }))
    expect((screen.getByLabelText(/Vehicle no\./) as HTMLInputElement).value).toBe('MH12AB1234')
  })

  it('reports what the customer has open from the live API rather than guessing', async () => {
    renderForm()
    const customer = screen.getByRole('combobox', { name: 'Customer' })
    fireEvent.focus(customer)
    fireEvent.change(customer, { target: { value: 'Acme' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Acme Ltd/ }, { timeout: 3000 }))
    await waitFor(() => expect(screen.getByText(/45 open on 2 challans/)).toBeTruthy(), { timeout: 3000 })
  })
})
