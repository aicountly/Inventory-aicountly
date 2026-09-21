import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import { specForCode } from '../registry'
import { EMPTY_SNAPSHOT } from './countModel'
import type { LineSnapshot } from './countModel'

/*
 * The counting workspace, end to end through the parts that matter:
 * load → type a figure → see the variance → save → post.
 *
 * The two rules these tests exist to hold are the ones a wrong screen would
 * break silently: only COUNTED lines are ever submitted (the server rejects a
 * line with no counted quantity), and a reader without `reports.valuation.read`
 * is shown no cost anywhere.
 */

const COUNT = specForCode('PHYSICAL_ADJUSTMENT')!

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const create = vi.fn()
const update = vi.fn()
const post = vi.fn()
const loadCountSheet = vi.fn()
const loadVarianceHistory = vi.fn(async () => [])
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 54, fy_id: 2, bo_id: 0 } }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can,
    loading: false,
    member: { uuid: 'user-a' },
    profile: { profile_name: 'Owner', template_key: 'owner' },
    permissions: [],
    allowedWarehouses: null,
    isOwner: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main store', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: (id: number | null | undefined) => (id === 3 ? 'Main store' : ''),
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (payload: unknown) => create(payload),
    update: (id: number, payload: unknown) => update(id, payload),
    post: (id: number, options: unknown) => post(id, options),
  },
  newIdempotencyKey: () => 'test-key',
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: async () => ({ base_currency_code: 'INR' }) },
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: { itemsByIds: async () => [], serials: async () => ({ data: [], meta: { total: 0 } }), batches: async () => ({ data: [], meta: { total: 0 } }) },
}))

vi.mock('./physicalCountApi', () => ({
  loadCountSheet: (options: unknown) => loadCountSheet(options),
  loadVarianceHistory: () => loadVarianceHistory(),
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), notify: vi.fn() }),
}))

const { PhysicalStockCountPage } = await import('./PhysicalStockCountPage')

function line(partial: Partial<LineDraft>): LineDraft {
  return newLine(COUNT, {
    warehouse_id: 3,
    unit_id: 1,
    units: [{ unit_id: 1, unit_symbol: 'Nos', conversion_factor: 1, is_default: true }],
    physical_qty: '',
    origin: 'count',
    ...partial,
  })
}

const SHEET = {
  lines: [
    line({ key: 'count-1', item_id: 1, item_sku: 'ITM-001', item_name: 'HP Laptop 15s', book_qty: '10' }),
    line({ key: 'count-2', item_id: 2, item_sku: 'ITM-002', item_name: 'Logitech Mouse', book_qty: '25' }),
  ],
  snapshots: {
    'count-1': { ...EMPTY_SNAPSHOT, unitCost: 45000, warehouseName: 'Main store', unitSymbol: 'Nos' } as LineSnapshot,
    'count-2': { ...EMPTY_SNAPSHOT, unitCost: 1200, warehouseName: 'Main store', unitSymbol: 'Nos' } as LineSnapshot,
  },
  notes: [],
  totalAvailable: 2,
}

function renderPage(onSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <PhysicalStockCountPage spec={COUNT} onSaved={onSaved} />
    </MemoryRouter>,
  )
}

/** Load the sheet and wait for the rows. */
async function loadSheet() {
  fireEvent.click(screen.getAllByRole('button', { name: /load book quantities/i })[0])
  await screen.findByText('ITM-001')
}

function countedInput(itemName: string): HTMLInputElement {
  return screen.getByLabelText(`Counted quantity for ${itemName}`) as HTMLInputElement
}

beforeEach(() => {
  can.mockReset()
  can.mockImplementation(() => true)
  create.mockReset()
  create.mockResolvedValue({ document_id: 77, document_no: 'PSC-0001', status: 'DRAFT', lines: [] })
  update.mockReset()
  post.mockReset()
  post.mockResolvedValue({ document_id: 77, document_no: 'PSC-0001', status: 'POSTED', lines: [], warnings: [] })
  loadCountSheet.mockReset()
  loadCountSheet.mockResolvedValue(SHEET)
  loadVarianceHistory.mockClear()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('before anything is loaded', () => {
  it('offers a way in instead of an empty grid', async () => {
    renderPage()
    expect(await screen.findByText(/load stock to begin counting/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /load book quantities/i }).length).toBeGreaterThan(0)
  })

  it('reports zero progress rather than a fabricated percentage', () => {
    renderPage()
    expect(screen.getByLabelText(/count progress 0%/i)).toBeTruthy()
  })
})

describe('counting', () => {
  it('loads the sheet from the snapshot service and renders the rows', async () => {
    renderPage()
    await loadSheet()
    expect(screen.getByText('HP Laptop 15s')).toBeTruthy()
    expect(screen.getByText('Logitech Mouse')).toBeTruthy()
    expect(loadCountSheet).toHaveBeenCalledTimes(1)
  })

  it('shows the difference and the variance value as the figure is typed', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })

    await waitFor(() => expect(screen.getByText('-2')).toBeTruthy())
    // 2 short × ₹45,000, in the row. The same figure is also in the KPI strip
    // and the footer — that agreement is the point, so the row is scoped here
    // and the strip is asserted separately below.
    const sheet = within(screen.getByRole('table'))
    expect(sheet.getByText(/-90,000\.00/)).toBeTruthy()
    expect(sheet.getByText('Shortage')).toBeTruthy()
    expect(screen.getAllByText(/-90,000\.00/).length).toBeGreaterThan(1)
  })

  it('moves progress and the shortage count as lines are counted', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })
    await waitFor(() => expect(screen.getByLabelText(/count progress 50%/i)).toBeTruthy())

    fireEvent.change(countedInput('Logitech Mouse'), { target: { value: '25' } })
    await waitFor(() => expect(screen.getByLabelText(/count progress 100%/i)).toBeTruthy())
  })

  it('treats a blank quantity as uncounted and zero as counted', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '0' } })
    await waitFor(() => expect(screen.getByText('-10')).toBeTruthy())

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByLabelText(/count progress 0%/i)).toBeTruthy())
  })
})

describe('saving', () => {
  it('submits only the lines that were counted', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save draft$/i })[0])

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as { lines: { item_id: number; book_qty: number; physical_qty: number }[] }
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 1, book_qty: 10, physical_qty: 8 })
  })

  it('says plainly that uncounted lines were not stored', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save draft$/i })[0])

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls.some((c) => /uncounted line/i.test(String(c[0])))).toBe(true)
  })

  it('refuses to save a sheet where nothing differs from book', async () => {
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '10' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save draft$/i })[0])

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(create).not.toHaveBeenCalled()
  })

  it('reports a failed save without losing the entered counts', async () => {
    create.mockRejectedValue(new Error('network down'))
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save draft$/i })[0])

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Unable to save the draft.'))
    expect(countedInput('HP Laptop 15s').value).toBe('8')
  })
})

describe('posting', () => {
  it('confirms before posting and states what will happen', async () => {
    renderPage()
    await loadSheet()
    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })

    fireEvent.click(screen.getAllByRole('button', { name: /save & post/i })[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/post physical stock count\?/i)).toBeTruthy()
    expect(within(dialog).getByText(/net inventory variance/i)).toBeTruthy()
    // The uncounted line is named as a warning, not as a blocker.
    expect(within(dialog).getByText(/1 item still uncounted/i)).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
  })

  it('saves then posts once confirmed', async () => {
    const onSaved = vi.fn()
    renderPage(onSaved)
    await loadSheet()
    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })

    fireEvent.click(screen.getAllByRole('button', { name: /save & post/i })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /post stock count/i }))

    await waitFor(() => expect(post).toHaveBeenCalledWith(77, { negativeOverride: false }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalled()
  })

  it('will not offer the post button while a serial-tracked shortage has no units named', async () => {
    loadCountSheet.mockResolvedValue({
      ...SHEET,
      lines: [line({ key: 'count-1', item_id: 1, item_sku: 'ITM-001', item_name: 'Router X1', book_qty: '10', track_serial: true })],
      snapshots: { 'count-1': { ...EMPTY_SNAPSHOT, unitCost: 900, warehouseName: 'Main store' } },
    })
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: /load book quantities/i })[0])
    await screen.findByText('Router X1')

    fireEvent.change(countedInput('Router X1'), { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /save & post/i })[0])

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/resolve before posting/i)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: /post stock count/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('permissions', () => {
  it('hides cost, variance value and the value KPI without reports.valuation.read', async () => {
    can.mockImplementation((key) => {
      const keys = typeof key === 'string' ? [key] : [...key]
      return !keys.includes('reports.valuation.read')
    })
    renderPage()
    await loadSheet()

    fireEvent.change(countedInput('HP Laptop 15s'), { target: { value: '8' } })

    await waitFor(() => expect(screen.getByText('-2')).toBeTruthy())
    expect(screen.queryByText(/45,000\.00/)).toBeNull()
    expect(screen.queryByText(/-90,000\.00/)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /unit cost/i })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: /variance value/i })).toBeNull()
  })

  it('keeps Save draft but drops Save & post without the post permission', async () => {
    can.mockImplementation((key) => {
      const keys = typeof key === 'string' ? [key] : [...key]
      return !keys.some((k) => k.endsWith('.post'))
    })
    renderPage()
    await loadSheet()

    expect(screen.getAllByRole('button', { name: /^save draft$/i }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /save & post/i })).toBeNull()
  })
})
