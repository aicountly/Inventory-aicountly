import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CreateDocumentPayload, InventoryDocument } from '../types'
import type { ItemSearchRow } from '../../services/lookupApi'
import { draftFromDocument } from '../formModel'
import { specForCode } from '../registry'
import type { DocumentTypeSpec } from '../registry'
import { MaterialReceiptForm } from './MaterialReceiptForm'

/*
 * The receipt screen itself.
 *
 * What these hold is the promise the screen makes to a storekeeper: the
 * arithmetic on the line is right, a receipt that cannot post says so before
 * the API is called, the payload carries everything that was typed — including
 * the supplier, the challan reference and the gate details — and a failed save
 * never costs anybody their forty lines of typing.
 */

const spec = specForCode('MATERIAL_RECEIPT') as DocumentTypeSpec

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const create = vi.fn<(payload: CreateDocumentPayload) => Promise<InventoryDocument>>()
const update = vi.fn<(id: number, payload: CreateDocumentPayload) => Promise<InventoryDocument>>()
const post = vi.fn<(id: number) => Promise<InventoryDocument>>()
const searchItems = vi.fn<() => Promise<ItemSearchRow[]>>()

const CEMENT: ItemSearchRow = {
  item_id: 11,
  item_name: 'Cement OPC 53 Grade',
  item_alias: null,
  print_name: null,
  item_sku: 'CEM-001',
  item_upc: '8901234567890',
  hsn_sac: null,
  mrp: null,
  unit_id: 5,
  unit_symbol: 'Bags',
  track_batch: 0,
  track_serial: 0,
  valuation_method: null,
  default_warehouse_id: null,
  stock: { on_hand: 1240, available: 1240, reserved: 0 },
  units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Bags', unit_name: 'Bags' }],
}

function documentFor(payload: CreateDocumentPayload, id = 501): InventoryDocument {
  return {
    ...payload,
    document_id: id,
    document_no: 'MR-2026-00124',
    document_type: 'MATERIAL_RECEIPT',
    status: 'DRAFT',
    lines: [],
  } as unknown as InventoryDocument
}

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, profile: { profile_name: 'Owner' } }),
  useCan: () => true,
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 },
      { warehouse_id: 4, warehouse_name: 'Site A', warehouse_code: null, warehouse_type: 'store', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Bags',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (payload: CreateDocumentPayload) => create(payload),
    update: (id: number, payload: CreateDocumentPayload) => update(id, payload),
    post: (id: number) => post(id),
  },
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: () => searchItems(),
    itemByBarcode: () => Promise.resolve(null),
    batches: () => Promise.resolve({ data: [], meta: {} }),
    serials: () => Promise.resolve({ data: [], meta: {} }),
    createBatch: () => Promise.resolve(null),
  },
}))

function renderForm() {
  return render(
    <MemoryRouter>
      <MaterialReceiptForm spec={spec} />
    </MemoryRouter>,
  )
}

/** Pick the one item the search offers into line 1. */
async function pickCement() {
  fireEvent.focus(screen.getByRole('combobox', { name: 'Item' }))
  const option = await screen.findByRole('option', { name: /Cement OPC 53 Grade/ })
  fireEvent.mouseDown(option)
  await screen.findByText('CEM-001')
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockReset()
  update.mockReset()
  post.mockReset()
  searchItems.mockReset()
  searchItems.mockResolvedValue([CEMENT])
  create.mockImplementation(async (payload) => documentFor(payload))
  post.mockImplementation(async (id) => ({ ...documentFor({} as CreateDocumentPayload, id), status: 'POSTED', warnings: [] }) as InventoryDocument)
})

describe('the material receipt workspace', () => {
  it('opens on a receipt dated today, in the default warehouse, with one empty line', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: 'Material receipt' })).toBeTruthy()
    expect((screen.getByLabelText(/Default warehouse/) as HTMLSelectElement).value).toBe('3')
    expect((screen.getByLabelText('Warehouse for line 1') as HTMLSelectElement).value).toBe('3')
    expect(screen.getByRole('combobox', { name: 'Item' })).toBeTruthy()
  })

  it('will not post an empty receipt, and says what is missing before calling the API', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    expect(await screen.findByText('Add at least one item to receive.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('fills the amount from quantity × rate', async () => {
    renderForm()
    await pickCement()
    type('Quantity for line 1', '100')
    type('Rate for line 1', '420')
    expect((screen.getByLabelText('Amount for line 1') as HTMLInputElement).value).toBe('42000')
  })

  it('adds and removes lines', async () => {
    renderForm()
    await pickCement()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0])
    await waitFor(() => expect(screen.getByLabelText('Quantity for line 2')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 2' }))
    await waitFor(() => expect(screen.queryByLabelText('Quantity for line 2')).toBeNull())
  })

  it('sends everything that was typed — supplier, challan reference and gate details — when the draft is saved', async () => {
    renderForm()
    await pickCement()
    type('Quantity for line 1', '100')
    type('Rate for line 1', '420')
    type('Supplier', 'Shree Cement')
    type('Books ledger id', '1042')
    type('Reference no.', 'INV-4421')
    type('Reference date', '2026-09-17')
    type('Gate entry no.', 'GE-0148')
    type('Vehicle no.', 'mh12ab3456')
    fireEvent.click(screen.getByRole('switch', { name: /Quality check completed/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('MATERIAL_RECEIPT')
    expect(payload.party_name).toBe('Shree Cement')
    expect(payload.party_ref).toBe(1042)
    expect(payload.source_document_no).toBe('INV-4421')
    expect(payload.source_document_date).toBe('2026-09-17')
    expect(payload.metadata).toMatchObject({ gate_entry_no: 'GE-0148', vehicle_no: 'MH12AB3456', quality_checked: true })
    expect(payload.lines).toEqual([
      expect.objectContaining({ item_id: 11, warehouse_id: 3, unit_id: 5, qty: 100, rate: 420, amount: 42000 }),
    ])
    expect(post).not.toHaveBeenCalled()
  })

  it('saves the draft first and posts it second, then offers what to do next', async () => {
    renderForm()
    await pickCement()
    type('Quantity for line 1', '100')
    type('Rate for line 1', '420')

    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/posted successfully/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View receipt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Receive another' })).toBeTruthy()
  })

  it('keeps every line on screen when the save fails', async () => {
    create.mockRejectedValue(new Error('The posting period is locked.'))
    renderForm()
    await pickCement()
    type('Quantity for line 1', '100')
    type('Rate for line 1', '420')

    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))

    expect(await screen.findByText('The posting period is locked.')).toBeTruthy()
    expect((screen.getByLabelText('Quantity for line 1') as HTMLInputElement).value).toBe('100')
    expect((screen.getByLabelText('Rate for line 1') as HTMLInputElement).value).toBe('420')
    expect(screen.getByText('CEM-001')).toBeTruthy()
  })

  it('does not offer to post to a profile that may only raise the draft', () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).some((k) => k.includes('.post')))
    renderForm()
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy()
  })

  it('reopens a stored receipt with its reference and gate details in place', () => {
    const stored = {
      document_id: 77,
      document_type: 'MATERIAL_RECEIPT',
      document_no: 'MR-2026-00124',
      document_date: '2026-09-18',
      status: 'DRAFT',
      party_ref: 1042,
      party_name: 'Shree Cement',
      source_document_no: 'INV-4421',
      source_document_date: '2026-09-17',
      narration: 'Received at gate 2.',
      metadata: { gate_entry_no: 'GE-0148', vehicle_no: 'MH12AB3456', quality_checked: true, transporter_name: 'Blue Dart' },
      lines: [
        {
          line_id: 1,
          document_id: 77,
          item_id: 11,
          item_label: 'Cement OPC 53 Grade',
          item_sku: 'CEM-001',
          warehouse_id: 3,
          dest_warehouse_id: null,
          location_id: null,
          batch_id: 9,
          batch_no: 'B00124',
          expiry_date: '2026-12-31',
          unit_id: 5,
          unit_symbol: 'Bags',
          direction: 'in',
          qty: 100,
          conversion_factor: 1,
          base_qty: 100,
          source_transaction_rate: 420,
          source_transaction_amount: 42000,
          valuation_rate: null,
          valuation_amount: null,
          valuation_method_applied: null,
          landed_cost_amount: null,
          book_qty: null,
          physical_qty: null,
          sort_order: 1,
          metadata: null,
          serials: [],
        },
      ],
    } as unknown as InventoryDocument

    render(
      <MemoryRouter>
        <MaterialReceiptForm spec={spec} documentId={77} initial={draftFromDocument(stored, spec)} />
      </MemoryRouter>,
    )

    expect((screen.getByLabelText('Reference no.') as HTMLInputElement).value).toBe('INV-4421')
    expect((screen.getByLabelText('Reference date') as HTMLInputElement).value).toBe('2026-09-17')
    expect((screen.getByLabelText('Supplier') as HTMLInputElement).value).toBe('Shree Cement')
    expect((screen.getByLabelText('Transporter') as HTMLInputElement).value).toBe('Blue Dart')
    expect((screen.getByLabelText('Gate entry no.') as HTMLInputElement).value).toBe('GE-0148')
    expect(screen.getByRole('switch', { name: /Quality check completed/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('31 Dec 2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
  })

  it('lays the lines out as cards where a ten-column grid would not fit', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )
    try {
      renderForm()
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByLabelText('Quantity for line 1')).toBeTruthy()
      expect(screen.getByRole('combobox', { name: 'Item' })).toBeTruthy()
    } finally {
      matchMedia.mockRestore()
    }
  })

  it('keeps the purchase order and invoice reader visible, and says why they are off', () => {
    renderForm()
    const po = screen.getByRole('button', { name: 'Create from PO' }) as HTMLButtonElement
    const ai = screen.getByRole('button', { name: 'AI auto-fill' }) as HTMLButtonElement
    expect(po.disabled).toBe(true)
    expect(ai.disabled).toBe(true)
    // Visible, disabled and explained — never hidden, so a missing relay does
    // not read as a missing feature.
    expect(screen.getByText('Not connected in this environment yet.')).toBeTruthy()
    expect(screen.getByText(/Attachments are not switched on/)).toBeTruthy()
  })
})
