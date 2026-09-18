import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DocumentListResponse } from '../../services/documentsApi'
import type { CreateDocumentPayload, InventoryDocument } from '../types'

/*
 * The dispatch screen. What these hold is the part a user would notice if it broke: that the
 * job worker is picked from ledgers this company has actually used, that the payload is still
 * the one the API has always taken, and that nothing on screen is invented.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const documentsList = vi.fn<() => Promise<DocumentListResponse>>()
const create = vi.fn<(p: CreateDocumentPayload) => Promise<InventoryDocument>>()
const post = vi.fn<(id: number) => Promise<InventoryDocument>>()
const pendingList = vi.fn()
const availabilityCheck = vi.fn()

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 54, fy_id: 2, bo_id: 0 } }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main store', warehouse_code: 'MAIN' },
      { warehouse_id: 4, warehouse_name: 'Finishing', warehouse_code: 'FIN' },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main store',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: () => documentsList(),
    create: (p: CreateDocumentPayload) => create(p),
    post: (id: number) => post(id),
    update: vi.fn(),
  },
  newIdempotencyKey: () => 'key',
}))

vi.mock('../../services/stockApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/stockApi')>()
  return {
    ...actual,
    pendingApi: { list: () => pendingList() },
    availabilityApi: { check: () => availabilityCheck(), forItems: vi.fn(async () => []) },
  }
})

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: async () => ({ base_currency_code: 'INR', negative_stock_policy: 'block' }) },
}))

const ITEM = {
  item_id: 90,
  item_name: 'Steel rod 12mm',
  item_alias: null,
  print_name: null,
  item_sku: 'ROD-12',
  item_upc: null,
  hsn_sac: null,
  mrp: null,
  unit_id: 1,
  unit_symbol: 'Nos',
  track_batch: 0,
  track_serial: 0,
  valuation_method: null,
  default_warehouse_id: 3,
  stock: { on_hand: 425, available: 425, reserved: 0 },
  units: [{ unit_id: 1, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
}

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    itemsByIds: vi.fn(async () => []),
    searchItems: vi.fn(async () => [ITEM]),
    batches: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } })),
    serials: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } })),
  },
}))

const { JobWorkOutwardForm } = await import('./JobWorkOutwardForm')
const { specForCode } = await import('../registry')
const SPEC = specForCode('JOB_WORK_OUT')!

function docRow(partial: Record<string, unknown> = {}) {
  return {
    document_id: 11,
    document_uuid: 'u',
    document_type: 'JOB_WORK_OUT',
    document_no: 'JWO-2026-27-0007',
    document_date: '2026-08-22',
    status: 'POSTED',
    source_app: 'inventory',
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: 501,
    party_name: 'Precision Turning Co',
    from_warehouse_id: null,
    to_warehouse_id: null,
    narration: null,
    posted_at: null,
    created_at: null,
    fy_id: 2,
    bo_id: 0,
    line_count: 2,
    valuation_total: 0,
    ...partial,
  }
}

function pendingRow(partial: Record<string, unknown> = {}) {
  return {
    pending_id: 1,
    cmp_id: 54,
    fy_id: 2,
    document_id: 11,
    line_id: 1,
    pending_kind: 'job_work',
    direction: 'out',
    item_id: 90,
    item_name: 'Steel rod 12mm',
    unit_id: 1,
    unit_symbol: 'Nos',
    warehouse_id: 3,
    warehouse_name: 'Main store',
    party_ref: 501,
    qty_original: 100,
    qty_settled: 82,
    qty_open: 18,
    status: 'partial',
    document_no: 'JWO-2026-27-0007',
    document_date: '2026-08-22',
    document_type: 'JOB_WORK_OUT',
    ...partial,
  }
}

function renderForm(onSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <JobWorkOutwardForm spec={SPEC} onSaved={onSaved} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  create.mockReset()
  post.mockReset()
  documentsList.mockResolvedValue({ data: [docRow()], meta: { total: 1, limit: 200, offset: 0 } } as DocumentListResponse)
  pendingList.mockResolvedValue({ data: [pendingRow()], meta: { total: 1, limit: 500, offset: 0 } })
  availabilityCheck.mockResolvedValue({ ok: true, lines: [] })
})

describe('new job work outward', () => {
  it('shows the workflow, not just a form', async () => {
    renderForm()
    expect(await screen.findByText('New job work outward')).toBeTruthy()
    const cycle = screen.getByText('Track job work cycle').closest('div.aic') as HTMLElement
    const steps = within(cycle.parentElement as HTMLElement)
    for (const step of ['Job Work Outward', 'Process at job worker', 'Job Work Inward', 'Reconciliation']) {
      expect(steps.getByText(step)).toBeTruthy()
    }
    // Step 1 is where a new document is, and the card says so.
    expect(steps.getByText('Current')).toBeTruthy()
  })

  it('offers the job workers this company has actually used', async () => {
    renderForm()
    const box = await screen.findByRole('combobox', { name: /job worker/i })
    fireEvent.focus(box)
    const option = await screen.findByRole('option', { name: /Precision Turning Co/ })
    // The open quantity is a fact from the pending register, not a guess.
    expect(within(option).getByText(/18 open/)).toBeTruthy()
    expect(within(option).getByText(/acc 501/)).toBeTruthy()
  })

  it('takes a ledger id for a job worker that is not on the list', async () => {
    renderForm()
    const box = await screen.findByRole('combobox', { name: /job worker/i })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '9042' } })
    fireEvent.mouseDown(await screen.findByText(/Use Books ledger #9042/))
    await waitFor(() => expect(screen.getByText('acc 9042')).toBeTruthy())
  })

  it('refuses to save without a job worker and says where the problem is', async () => {
    renderForm()
    fireEvent.click(await screen.findByRole('button', { name: /Save as draft/ }))
    expect(await screen.findByText(/Pick the job worker/)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses to save with no item line', async () => {
    renderForm()
    const box = await screen.findByRole('combobox', { name: /job worker/i })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Precision Turning Co/ }))
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    expect(await screen.findByText(/Add at least one item line/)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('sends the payload the API has always taken', async () => {
    create.mockResolvedValue({ document_id: 77, document_no: 'JWO-8' } as InventoryDocument)
    const onSaved = vi.fn()
    renderForm(onSaved)

    const box = await screen.findByRole('combobox', { name: /job worker/i })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Precision Turning Co/ }))

    const itemBox = screen.getByPlaceholderText(/Search item by name, SKU or barcode/)
    fireEvent.focus(itemBox)
    fireEvent.change(itemBox, { target: { value: 'rod' } })
    fireEvent.mouseDown(await screen.findByText('Steel rod 12mm'))

    fireEvent.change(screen.getByLabelText(/Quantity for line 1/), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0]
    expect(payload).toMatchObject({
      document_type: 'JOB_WORK_OUT',
      // The ledger id is what pending quantities are matched on, and the name is a snapshot.
      party_ref: 501,
      party_name: 'Precision Turning Co',
      returnable: true,
    })
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 90, warehouse_id: 3, qty: 25 })
    // Nothing on a dispatch is costed: the stock never leaves the principal's ownership.
    expect(payload.lines[0].valuation_rate ?? null).toBeNull()
    expect(onSaved).toHaveBeenCalled()
  })

  it('shows what is already out with the job worker, from the pending register', async () => {
    renderForm()
    const box = await screen.findByRole('combobox', { name: /job worker/i })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Precision Turning Co/ }))

    const itemBox = screen.getByPlaceholderText(/Search item by name, SKU or barcode/)
    fireEvent.focus(itemBox)
    fireEvent.change(itemBox, { target: { value: 'rod' } })
    fireEvent.mouseDown(await screen.findByText('Steel rod 12mm'))

    expect(await screen.findByText(/18 already out with this job worker/)).toBeTruthy()
  })

  it('hides Save & post from a profile that cannot post', async () => {
    can.mockImplementation((key) => {
      const keys = Array.isArray(key) ? key : [key]
      return !keys.some((k) => String(k).includes('.post'))
    })
    renderForm()
    await screen.findByText('New job work outward')
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })

  it('calls the challan value what it is, and never a cost', async () => {
    renderForm()
    await screen.findByText('New job work outward')
    expect(screen.getByText('Challan rate')).toBeTruthy()
    expect(screen.queryByText(/Inventory rate/i)).toBeNull()
    expect(screen.queryByText(/Unit cost/i)).toBeNull()
  })

  it('carries no invented document number', async () => {
    renderForm()
    const number = (await screen.findByLabelText(/Document no/i)) as HTMLInputElement
    expect(number.value).toBe('')
    expect(screen.getByText(/Leave empty to number automatically/)).toBeTruthy()
  })
})
