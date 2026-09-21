import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import type { CreateDocumentPayload } from '../types'
import { newHeader, newLine } from '../formModel'
import { specForCode } from '../registry'
import { BatchAdjustmentPage } from './BatchAdjustmentPage'

/*
 * The screen the product owner approved, held to what it promises: the figures come off the draft,
 * the two batch columns describe one reallocation, and Save draft sends the payload the server
 * already accepts — batch_id on the line, the other end of the mapping in its metadata.
 */

const SPEC = specForCode('BATCH_ADJUSTMENT')!

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' }, profile: null, allowedWarehouses: null }),
  useCan: () => true,
}))

const WAREHOUSES = [
  { warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 2, warehouse_name: 'Quarantine', warehouse_code: 'QC', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null) => WAREHOUSES.find((w) => w.warehouse_id === id)?.warehouse_name ?? '',
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const ITEM: ItemSearchRow = {
  item_id: 10,
  item_name: 'Axle Assembly',
  item_alias: null,
  print_name: 'Axle Assembly',
  item_sku: 'ITEM-AX45',
  item_upc: null,
  hsn_sac: null,
  mrp: null,
  unit_id: 5,
  unit_symbol: 'Nos',
  track_batch: 1,
  track_serial: 0,
  valuation_method: 'FIFO',
  default_warehouse_id: null,
  stock: { on_hand: 200, available: 195, reserved: 5 },
  units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
}

function batch(id: number, no: string, available: number): BatchRow {
  return { batch_id: id, item_id: 10, batch_no: no, lot_no: null, mfg_date: null, expiry_date: null, status: 'active', stock: { on_hand: available, reserved: 0, available } }
}

const searchItems = vi.fn(async () => [ITEM])
const batches = vi.fn(async () => ({ data: [batch(101, 'BATCH-24-A', 120), batch(102, 'BATCH-24-B', 75)], meta: {} }))
vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: (...args: unknown[]) => searchItems(...(args as [])),
    batches: (...args: unknown[]) => batches(...(args as [])),
    itemsByIds: async () => [ITEM],
    createBatch: async () => batch(103, 'BATCH-NEW', 0),
    serials: async () => ({ data: [], meta: {} }),
    bulkCreateSerials: async () => ({ created: [], skipped: [] }),
  },
}))

const create = vi.fn(async (payload: CreateDocumentPayload) => ({ document_id: 55, document_no: 'BA-2026-000128', ...payload }))
const post = vi.fn(async () => ({ document_id: 55, document_no: 'BA-2026-000128', warnings: [] }))
vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (...args: unknown[]) => create(...(args as [CreateDocumentPayload])),
    update: vi.fn(),
    post: (...args: unknown[]) => post(...(args as [])),
  },
}))

function renderPage(props: Partial<Parameters<typeof BatchAdjustmentPage>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BatchAdjustmentPage spec={SPEC} {...props} />
    </MemoryRouter>,
  )
}

/** Scan one code in, which is the fastest way to a real line without driving the typeahead. */
async function addScannedLine() {
  // The toolbar and the empty state both offer it; either door opens the same dialog.
  fireEvent.click(screen.getAllByRole('button', { name: /Scan & add/i })[0])
  const field = await screen.findByLabelText('Scan or type an item code')
  fireEvent.change(field, { target: { value: 'ITEM-AX45' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  await waitFor(() => expect(screen.getAllByText('ITEM-AX45').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
}

/** The one line's controls, once the batch lists have arrived. */
async function lineControls() {
  const qty = await screen.findByLabelText('Quantity on line 1')
  await waitFor(() => expect(within(screen.getByLabelText('Current batch on line 1')).getAllByRole('option').length).toBeGreaterThan(1))
  return {
    qty,
    from: screen.getByLabelText('Current batch on line 1') as HTMLSelectElement,
    to: screen.getByLabelText('Revised batch on line 1') as HTMLSelectElement,
    direction: screen.getByLabelText('Direction on line 1') as HTMLSelectElement,
  }
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockClear()
  post.mockClear()
  searchItems.mockClear()
  batches.mockClear()
})

describe('the batch adjustment workspace', () => {
  it('opens on an empty document that says what it is for', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'New batch adjustment' })).toBeTruthy()
    expect(screen.getByText('Correct batch allocations without changing inventory value.')).toBeTruthy()
    expect(screen.getByText('No adjustment lines yet')).toBeTruthy()
    for (const label of ['Draft lines', 'Total qty out', 'Total qty in', 'Warehouse', 'Variance risk', 'Exceptions']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0)
    }
  })

  it('shows the branch default warehouse as the one new lines inherit', () => {
    renderPage()
    expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0)
    expect((screen.getByLabelText(/Default warehouse/) as HTMLSelectElement).value).toBe('1')
  })

  it('counts the quantity a line moves into the KPI strip and the footer', async () => {
    renderPage()
    await addScannedLine()
    const { qty } = await lineControls()
    fireEvent.change(qty, { target: { value: '10' } })

    await waitFor(() => expect(screen.getByText('10 out')).toBeTruthy())
    expect(screen.getByText('0 in')).toBeTruthy()
    // Out without a matching in is a variance, and the document says so rather than hiding it.
    expect(screen.getByText(/Variance -10/)).toBeTruthy()
  })

  it('refuses a negative quantity at the keystroke', async () => {
    renderPage()
    await addScannedLine()
    const { qty } = await lineControls()
    fireEvent.change(qty, { target: { value: '-5' } })
    expect((qty as HTMLInputElement).value).toBe('')
  })

  it('offers the batches in stock at the line’s warehouse on both ends of the mapping', async () => {
    renderPage()
    await addScannedLine()
    const { from, to } = await lineControls()
    for (const select of [from, to]) {
      const labels = within(select).getAllByRole('option').map((o) => o.textContent)
      expect(labels.some((l) => l?.includes('BATCH-24-A') && l.includes('avail 120'))).toBe(true)
      expect(labels.some((l) => l?.includes('BATCH-24-B'))).toBe(true)
    }
  })

  it('warns when the current and revised batch are the same', async () => {
    renderPage()
    await addScannedLine()
    const { from, to, qty } = await lineControls()
    fireEvent.change(qty, { target: { value: '5' } })
    fireEvent.change(from, { target: { value: '101' } })
    fireEvent.change(to, { target: { value: '101' } })

    // The rail is where a check reports; the row itself only carries the chip.
    await waitFor(() => {
      const row = screen.getByText('Duplicate batch mapping').closest('button')
      expect(row, 'the check row is clickable once it has something to say').toBeTruthy()
      expect(within(row as HTMLElement).getByText('1 warning')).toBeTruthy()
    })
    expect(within(screen.getByRole('table')).getByText('Warning')).toBeTruthy()
  })

  it('sends the batch the quantity leaves on the line and the destination beside it', async () => {
    renderPage()
    await addScannedLine()
    const { from, to, qty } = await lineControls()
    fireEvent.change(qty, { target: { value: '10' } })
    fireEvent.change(from, { target: { value: '101' } })
    fireEvent.change(to, { target: { value: '102' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('BATCH_ADJUSTMENT')
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 10, warehouse_id: 1, qty: 10, direction: 'out', batch_id: 101 })
    expect(payload.lines[0].metadata).toEqual({
      batch_adjustment: { from_batch_id: 101, from_batch_no: 'BATCH-24-A', to_batch_id: 102, to_batch_no: 'BATCH-24-B' },
    })
  })

  it('moves the stored batch to the other end when the line turns into a receipt', async () => {
    renderPage()
    await addScannedLine()
    const { from, to, qty, direction } = await lineControls()
    fireEvent.change(qty, { target: { value: '10' } })
    fireEvent.change(from, { target: { value: '101' } })
    fireEvent.change(to, { target: { value: '102' } })
    fireEvent.change(direction, { target: { value: 'in' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0].lines[0]).toMatchObject({ direction: 'in', batch_id: 102 })
  })

  it('asks before it posts, and never posts straight from the button', async () => {
    renderPage()
    await addScannedLine()
    const { from, to, qty } = await lineControls()
    fireEvent.change(qty, { target: { value: '10' } })
    fireEvent.change(from, { target: { value: '101' } })
    fireEvent.change(to, { target: { value: '102' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save & post' }))
    expect(await screen.findByText('Post batch adjustment?')).toBeTruthy()
    expect(post).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Post adjustment' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('will not let the confirmation post a document with a blocking error', async () => {
    renderPage()
    await addScannedLine()
    // No quantity and no batch: two errors the server would reject anyway.
    fireEvent.click(screen.getByRole('button', { name: 'Save & post' }))
    expect(await screen.findByText('Fix before posting')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Post adjustment' }).hasAttribute('disabled')).toBe(true)
  })

  it('hides posting from a profile that may not post', async () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).some((k) => k.includes('.post')))
    renderPage()
    expect(screen.queryByRole('button', { name: 'Save & post' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy()
  })

  it('adds a line from the keyboard without touching the mouse', async () => {
    renderPage()
    expect(screen.getByText('No adjustment lines yet')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', altKey: true })
    expect(await screen.findByLabelText('Quantity on line 1')).toBeTruthy()
  })

  it('opens a posted document read-only, with the ways out of it', () => {
    renderPage({
      documentId: 55,
      documentNo: 'BA-2026-000128',
      readOnly: true,
      statusLabel: 'Posted',
      initial: {
        header: { ...newHeader(SPEC, '2026-09-18'), document_no: 'BA-2026-000128', default_warehouse_id: 1 },
        lines: [newLine(SPEC, { item_id: 10, item_name: 'Axle Assembly', item_sku: 'ITEM-AX45', track_batch: true, warehouse_id: 1, direction: 'out', qty: '10', batch_id: 101, batch_no: 'BATCH-24-A' })],
      },
    })
    expect(screen.getByText('Posted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add line/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open document' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })

  it('leaves nothing editable on a posted document, the serial drawer included', () => {
    renderPage({
      documentId: 55,
      documentNo: 'BA-2026-000128',
      readOnly: true,
      statusLabel: 'Posted',
      initial: {
        header: { ...newHeader(SPEC, '2026-09-18'), document_no: 'BA-2026-000128', default_warehouse_id: 1 },
        lines: [
          newLine(SPEC, {
            item_id: 11,
            item_name: 'Brake Disc (Serial)',
            item_sku: 'ITEM-BR10',
            track_batch: true,
            track_serial: true,
            warehouse_id: 1,
            direction: 'in',
            qty: '2',
            batch_id: 202,
            batch_no: 'BATCH-NEW',
          }),
        ],
      },
    })
    expect((screen.getByLabelText('Quantity on line 1') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Direction on line 1') as HTMLSelectElement).disabled).toBe(true)
    // The serials are readable in the button's label; opening the drawer would let them be changed.
    expect(screen.getByRole('button', { name: /Map 2/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: /Scan & add/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Import from file/i })).toBeNull()
  })
})
