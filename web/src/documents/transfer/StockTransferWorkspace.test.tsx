import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../ui/ToastContext'
import { specForCode } from '../registry'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { StockTransferWorkspace } from './StockTransferWorkspace'

/*
 * The screen a storekeeper spends the day on. What is pinned here is what the
 * screen promises: it cannot send stock to the warehouse it came from, the
 * figures on the right are the figures on the lines, the buttons do what they
 * say once and only once, and nothing about stock is decided here that the
 * server does not decide again.
 */

const SPEC = specForCode('STOCK_TRANSFER')!
const TODAY = '2026-09-18'

const WAREHOUSES = [
  { warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
  { warehouse_id: 2, warehouse_name: 'Production Unit', warehouse_code: 'PROD', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
  { warehouse_id: 3, warehouse_name: 'Quarantine', warehouse_code: 'QTN', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
]

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, permissions: [], profile: null, member: null, allowedWarehouses: null, isOwner: false, error: null, reload: () => {} }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    branches: [],
  }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null | undefined) => WAREHOUSES.find((w) => w.warehouse_id === id)?.warehouse_name ?? '',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const create = vi.fn()
const update = vi.fn()
const post = vi.fn()

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
    post: (...args: unknown[]) => post(...args),
    documentTypes: () => Promise.resolve([{ code: 'PURCHASE_RECEIPT', label: 'Purchase Receipt' }]),
    list: () => Promise.resolve({ data: [], meta: {} }),
  },
  newIdempotencyKey: () => 'test-key',
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: () => Promise.resolve([]),
    itemsByIds: () => Promise.resolve([]),
    batches: () => Promise.resolve({ data: [], meta: {} }),
    serials: () => Promise.resolve({ data: [], meta: {} }),
  },
}))

const forItems = vi.fn(() => Promise.resolve([{ item_id: 10, warehouse_id: 1, batch_id: null, on_hand: 25, reserved: 0, committed: 0, packed: 0, in_transit: 0, job_worker: 0, quality_hold: 0, damaged: 0, blocked: 0, expected: 0, available: 25, projected: 25 }]))

vi.mock('../../services/stockApi', () => ({
  availabilityApi: { forItems: (...args: unknown[]) => forItems(...(args as [])) },
  shortBy: () => 0,
}))

vi.mock('../../services/valuationApi', () => ({
  valuationApi: { unitCosts: () => Promise.resolve([{ item_id: 10, unit_cost: 50000, valuation_method_applied: 'FIFO' }]) },
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: () => Promise.resolve({ negative_stock_policy: 'block', base_currency_code: 'INR' }) },
}))

function draft(headerPatch: Partial<HeaderDraft> = {}, linePatch: Partial<LineDraft> = {}) {
  return {
    header: {
      ...newHeader(SPEC, TODAY),
      from_warehouse_id: 1,
      to_warehouse_id: 2,
      reason_code: 'BRANCH_TRANSFER',
      movement_reason: 'Branch Transfer',
      ...headerPatch,
    },
    lines: [
      newLine(SPEC, {
        item_id: 10,
        item_name: 'Laptop Dell Inspiron 15',
        item_sku: 'PRD-001',
        unit_id: 5,
        units: [{ unit_id: 5, unit_symbol: 'Nos', unit_name: null, conversion_factor: 1, is_default: true }],
        qty: '10',
        ...linePatch,
      }),
    ],
  }
}

const onSaved = vi.fn()

function renderWorkspace(initial = draft()) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <StockTransferWorkspace spec={SPEC} initial={initial} onSaved={onSaved} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Lets the debounced availability / valuation / settings reads land. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450))
  })
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockReset()
  create.mockResolvedValue({ document_id: 55, document_no: 'ST-2026-0001', status: 'DRAFT', warnings: [] })
  update.mockReset()
  update.mockResolvedValue({ document_id: 55, document_no: 'ST-2026-0001', status: 'DRAFT', warnings: [] })
  post.mockReset()
  post.mockResolvedValue({ document_id: 55, document_no: 'ST-2026-0001', status: 'POSTED', warnings: [] })
  onSaved.mockReset()
  forItems.mockClear()
})

describe('the transfer workspace', () => {
  it('opens as the stock transfer screen, not the generic document form', async () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'New Stock Transfer', level: 1 })).toBeTruthy()
    expect(screen.getByText(/Move stock between warehouses, locations or branches/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Documents' })).toBeTruthy()
    await settle()
  })

  it('adds up the lines on the right as they are typed', async () => {
    renderWorkspace()
    await settle()
    const summary = screen.getByRole('heading', { name: 'Transfer Summary' }).closest('div')?.parentElement as HTMLElement
    expect(within(summary).getByText('Total Items').parentElement?.textContent).toContain('1')
    expect(within(summary).getByText('Total Quantity').parentElement?.textContent).toContain('10')

    fireEvent.change(screen.getByRole('textbox', { name: /Quantity for line 1/ }), { target: { value: '12' } })
    await waitFor(() => {
      expect(within(summary).getByText('Total Quantity').parentElement?.textContent).toContain('12')
    })
  })

  it('values the transfer at the inventory unit cost, in the company currency', async () => {
    renderWorkspace()
    await settle()
    await waitFor(() => expect(screen.getAllByText('₹ 5,00,000.00').length).toBeGreaterThan(0))
  })

  it('withholds the value from a profile that may not read stock valuation', async () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).includes('reports.valuation.read'))
    renderWorkspace()
    await settle()
    expect(screen.getByText('Not available')).toBeTruthy()
    expect(screen.queryByText('₹ 5,00,000.00')).toBeNull()
  })

  it('shows what the source warehouse holds free right now', async () => {
    renderWorkspace()
    await settle()
    await waitFor(() => expect(screen.getByText('25 Nos')).toBeTruthy())
    expect(forItems).toHaveBeenCalledWith([10], 1, true, expect.anything())
  })
})

describe('source and destination', () => {
  it('will not offer the destination as the source as well', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('combobox', { name: /From Warehouse/ }))
    const option = screen.getByRole('option', { name: /Production Unit/ })
    expect(option.getAttribute('aria-disabled')).toBe('true')
    expect(within(option).getByText('Already the destination of this transfer')).toBeTruthy()
  })

  it('refuses to post when both sides are the same warehouse', async () => {
    renderWorkspace(draft({ to_warehouse_id: 1 }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(screen.getAllByText(/Source and destination cannot be the same warehouse/).length).toBeGreaterThan(0))
    expect(create).not.toHaveBeenCalled()
  })

  it('swaps the two sides', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Swap source and destination/ }))
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /From Warehouse/ }).textContent).toContain('Production Unit')
      expect(screen.getByRole('combobox', { name: /To Warehouse/ }).textContent).toContain('Main Warehouse')
    })
  })

  it('asks first when swapping would throw away the batches and serials already chosen', async () => {
    renderWorkspace(draft({}, { track_serial: true, serials: [{ serial_id: 1, serial_no: 'SN-1' }] }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Swap source and destination/ }))

    expect(screen.getByRole('heading', { name: /Swap source and destination\?/ })).toBeTruthy()
    // Declining leaves everything exactly as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('combobox', { name: /From Warehouse/ }).textContent).toContain('Main Warehouse')

    fireEvent.click(screen.getByRole('button', { name: /Swap source and destination/ }))
    fireEvent.click(screen.getByRole('button', { name: /Swap and clear allocations/ }))
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /From Warehouse/ }).textContent).toContain('Production Unit')
    })
    expect(screen.getByRole('button', { name: /Serials 0 \/ 10/ })).toBeTruthy()
  })
})

describe('saving and posting', () => {
  it('saves a draft through the existing create endpoint', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('STOCK_TRANSFER')
    expect(payload.from_warehouse_id).toBe(1)
    expect(payload.to_warehouse_id).toBe(2)
    expect(payload.reason_code).toBe('BRANCH_TRANSFER')
    expect(payload.lines).toHaveLength(1)
    expect(post).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ document_id: 55 }), false)
  })

  it('creates then posts, in that order, so a refused post leaves a saved draft', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(55, { negativeOverride: false })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: 'POSTED' }), true)
  })

  it('will not post without a reason, but will still save a draft', async () => {
    renderWorkspace(draft({ reason_code: '', movement_reason: '' }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: /Save & post/ }))
    await waitFor(() => expect(screen.getAllByText('Pick why this stock is moving.').length).toBeGreaterThan(0))
    expect(create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('shows what the server said when it refuses', async () => {
    create.mockRejectedValueOnce(new Error('Period is locked up to 30 Sep 2026'))
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    await waitFor(() => expect(screen.getByText(/Period is locked up to 30 Sep 2026/)).toBeTruthy())
  })

  it('cannot be submitted twice by clicking twice', async () => {
    let release: (v: unknown) => void = () => {}
    create.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    renderWorkspace()
    await settle()

    const save = screen.getByRole('button', { name: /Save as draft/ })
    fireEvent.click(save)
    fireEvent.click(save)
    fireEvent.click(save)
    expect(create).toHaveBeenCalledTimes(1)

    await act(async () => {
      release({ document_id: 55, document_no: 'ST-2026-0001', status: 'DRAFT', warnings: [] })
    })
  })

  it('hides the post button from a profile that may not post', async () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).some((k) => k.endsWith('.post')))
    renderWorkspace()
    await settle()
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })
})

describe('keyboard shortcuts', () => {
  it('saves on Alt+S and posts on Alt+P', async () => {
    renderWorkspace()
    await settle()

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', altKey: true })
    })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    create.mockClear()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'p', altKey: true })
    })
    await waitFor(() => expect(post).toHaveBeenCalled())
  })

  it('stays out of the way while the narration is being typed', async () => {
    renderWorkspace()
    await settle()
    const narration = screen.getByLabelText(/Narration \/ Remarks/)
    await act(async () => {
      fireEvent.keyDown(narration, { key: 's', altKey: true })
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('still saves on Ctrl+S from inside a field, which is what Ctrl+S is for', async () => {
    renderWorkspace()
    await settle()
    const narration = screen.getByLabelText(/Narration \/ Remarks/)
    await act(async () => {
      fireEvent.keyDown(narration, { key: 's', ctrlKey: true })
    })
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })
})

describe('the lines', () => {
  it('duplicates a row without duplicating its serial numbers', async () => {
    renderWorkspace(draft({}, { track_serial: true, qty: '2', serials: [{ serial_id: 1, serial_no: 'SN-1' }, { serial_id: 2, serial_no: 'SN-2' }] }))
    await settle()
    expect(screen.getByRole('button', { name: /Serials 2 \/ 2/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate line 1' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Serials/ })).toHaveLength(2))

    const serialButtons = screen.getAllByRole('button', { name: /^Serials/ })
    expect(serialButtons[0].textContent).toContain('2 / 2')
    expect(serialButtons[1].textContent).toContain('0 / 2')
  })

  it('removes a row', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    await waitFor(() => expect(screen.getByText('No items on this transfer yet')).toBeTruthy())
  })

  it('keeps the per-line warehouse override the old editor had', async () => {
    renderWorkspace()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Main Warehouse.*Production Unit/ }))
    expect(screen.getByLabelText('From (this line)')).toBeTruthy()
    expect(screen.getByLabelText('To (this line)')).toBeTruthy()
  })
})
