import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SerialAdjustmentPage } from './SerialAdjustmentPage'
import type { SerialLookupRow } from '../../services/lookupApi'

/*
 * What this screen must not get wrong, held as a test rather than as a comment.
 *
 * The screen is serial-first: the operator types a number and everything else on the row —
 * item, warehouse, batch, status — arrives from `GET /v1/serials`. So the tests below are
 * mostly about what happens between a keystroke in the serial column and the payload that
 * reaches `documentsApi`, because that is the whole of the redesign.
 */

const findSerialExact = vi.fn()
const itemsByIds = vi.fn()
const create = vi.fn()
const post = vi.fn()
const update = vi.fn()

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    findSerialExact: (...a: unknown[]) => findSerialExact(...a),
    findSerials: vi.fn().mockResolvedValue([]),
    itemsByIds: (...a: unknown[]) => itemsByIds(...a),
    searchItems: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    post: (...a: unknown[]) => post(...a),
  },
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, profile: null, loading: false, allowedWarehouses: null }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 3, warehouse_name: 'Main', warehouse_code: 'MN', is_default: 1, bo_id: 0 },
      { warehouse_id: 4, warehouse_name: 'Spare', warehouse_code: 'SP', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

const toasts: { kind: string; message: string }[] = []
vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({
    notify: (kind: string, message: string) => toasts.push({ kind, message }),
    success: (message: string) => toasts.push({ kind: 'success', message }),
    error: (message: string) => toasts.push({ kind: 'error', message }),
    info: (message: string) => toasts.push({ kind: 'info', message }),
  }),
}))

function serial(over: Partial<SerialLookupRow> = {}): SerialLookupRow {
  return {
    serial_id: 1,
    item_id: 10,
    serial_no: 'SN-1',
    batch_id: null,
    warehouse_id: 3,
    location_id: null,
    status: 'in_stock',
    unit_cost: null,
    received_document_id: null,
    issued_document_id: null,
    warranty_until: null,
    item_name: 'Dell Latitude 5440',
    item_sku: 'DELL5440',
    warehouse_name: 'Main',
    warehouse_code: 'MN',
    batch_no: null,
    expiry_date: null,
    location_code: null,
    ...over,
  }
}

function renderPage(onSaved = vi.fn()) {
  return render(
    <MemoryRouter>
      <SerialAdjustmentPage onSaved={onSaved} />
    </MemoryRouter>,
  )
}

/**
 * The item name deliberately appears twice once a serial resolves — once on the grid row and
 * once in the Live stock info panel — so these helpers assert presence, not uniqueness.
 */
async function resolved(text: string | RegExp) {
  await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0))
}

/** Type into the first serial cell and commit it the way Enter or a scanner would. */
async function scanInto(value: string, line = 1) {
  const input = screen.getByLabelText(`Serial number, line ${line}`)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input, { target: { value } })
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  toasts.length = 0
  itemsByIds.mockResolvedValue([
    {
      item_id: 10,
      item_name: 'Dell Latitude 5440',
      item_sku: 'DELL5440',
      unit_id: 7,
      unit_symbol: 'Nos',
      units: [{ unit_id: 7, is_default: 1, conversion_factor: 1, uom_role: 'base', unit_symbol: 'Nos', unit_name: 'Nos' }],
      track_batch: 0,
      track_serial: 1,
      default_warehouse_id: 3,
    },
  ])
})

describe('the serial adjustment screen', () => {
  it('renders the two steps, the contextual panel and the action bar', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /new serial adjustment/i })).toBeTruthy()
    expect(screen.getByText('Document details')).toBeTruthy()
    expect(screen.getByText('Serial details')).toBeTruthy()
    expect(screen.getByText('Live stock info')).toBeTruthy()
    expect(screen.getByText('Adjustment summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: /save as draft/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /save & post/i })).toBeTruthy()
  })

  it('defaults the document date to today and pre-fills the default warehouse', async () => {
    renderPage()
    const date = screen.getByLabelText(/document date/i) as HTMLInputElement
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => {
      const wh = screen.getByLabelText(/default warehouse/i) as HTMLSelectElement
      expect(wh.value).toBe('3')
    })
  })

  it('fills the item, warehouse and status from the serial the API returned', async () => {
    findSerialExact.mockResolvedValue(serial())
    renderPage()

    await scanInto('SN-1')

    await resolved('Dell Latitude 5440')
    expect(screen.getAllByText('SKU: DELL5440').length).toBeGreaterThan(0)
    // The contextual panel follows the scan.
    expect(screen.getAllByText('In stock').length).toBeGreaterThan(0)
    expect(findSerialExact).toHaveBeenCalledWith('SN-1', expect.anything())
  })

  it('says so, in words, when the serial is not registered', async () => {
    findSerialExact.mockResolvedValue(null)
    renderPage()

    await scanInto('GHOST-1')

    await resolved(/No serial number .*GHOST-1.* is registered/)
  })

  it('flags a serial that is not in stock without blocking it', async () => {
    findSerialExact.mockResolvedValue(serial({ status: 'issued' }))
    renderPage()

    await scanInto('SN-1')

    await resolved(/not in stock/i)
  })

  it('catches the same serial entered twice and names the line it is already on', async () => {
    findSerialExact.mockResolvedValue(serial())
    renderPage()

    await scanInto('SN-1')
    await resolved('Dell Latitude 5440')

    fireEvent.click(screen.getByRole('button', { name: /add another line/i }))
    await scanInto('SN-1', 2)

    await waitFor(() => expect(screen.getByText('Already added on line 1.')).toBeTruthy())
  })

  it('adds and removes lines', async () => {
    renderPage()
    expect(screen.getByLabelText('Serial number, line 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /add another line/i }))
    await waitFor(() => expect(screen.getByLabelText('Serial number, line 2')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Remove line 2/ }))
    await waitFor(() => expect(screen.queryByLabelText('Serial number, line 2')).toBeNull())
  })

  it('refuses to save an empty document and says why', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))
    await waitFor(() => expect(screen.getByText('Scan or add at least one serial number.')).toBeTruthy())
    expect(create).not.toHaveBeenCalled()
  })

  it('posts the folded by_line payload the server expects', async () => {
    findSerialExact.mockResolvedValue(serial())
    create.mockResolvedValue({ document_id: 55, document_no: 'SA-55', lines: [] })
    post.mockResolvedValue({ document_id: 55, document_no: 'SA-55', lines: [], warnings: [] })
    const onSaved = vi.fn()
    renderPage(onSaved)

    await scanInto('SN-1')
    await resolved('Dell Latitude 5440')

    fireEvent.click(screen.getByRole('button', { name: /save & post/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0]
    expect(payload.document_type).toBe('SERIAL_ADJUSTMENT')
    expect(payload.lines).toHaveLength(1)
    expect(payload.lines[0]).toMatchObject({ item_id: 10, warehouse_id: 3, qty: 1, direction: 'out', serials: [1] })
    await waitFor(() => expect(post).toHaveBeenCalledWith(55, {}))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(toasts.some((t) => t.kind === 'success')).toBe(true)
  })

  it('saves a draft without posting it', async () => {
    findSerialExact.mockResolvedValue(serial())
    create.mockResolvedValue({ document_id: 56, document_no: 'SA-56', lines: [] })
    renderPage()

    await scanInto('SN-1')
    await resolved('Dell Latitude 5440')

    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(post).not.toHaveBeenCalled()
  })

  it('shows a server validation error instead of swallowing it', async () => {
    findSerialExact.mockResolvedValue(serial())
    create.mockRejectedValue(new Error('Line 1: direction (in|out) is required for SERIAL_ADJUSTMENT'))
    renderPage()

    await scanInto('SN-1')
    await resolved('Dell Latitude 5440')
    fireEvent.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(screen.getByText(/direction \(in\|out\) is required/)).toBeTruthy())
    expect(toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('does not fire a second lookup when a blur follows an Enter on the same value', async () => {
    findSerialExact.mockResolvedValue(serial())
    renderPage()

    const input = screen.getByLabelText('Serial number, line 1')
    fireEvent.change(input, { target: { value: 'SN-1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await resolved('Dell Latitude 5440')
    fireEvent.blur(input, { target: { value: 'SN-1' } })

    await waitFor(() => expect(findSerialExact).toHaveBeenCalledTimes(1))
  })

  it('keeps the running summary in step with the grid', async () => {
    findSerialExact.mockResolvedValue(serial())
    renderPage()

    await scanInto('SN-1')

    await waitFor(() => {
      const row = screen.getByText('Serials entered').closest('div')
      expect(row?.textContent).toContain('1')
    })
  })

  it('offers the shortcut list the header advertises', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Add another line')).toBeTruthy()
    expect(within(dialog).getByText('Open the scanner')).toBeTruthy()
  })

  it('explains that AI assistance is not configured rather than pretending to run it', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /try with ai/i }))
    await waitFor(() => expect(screen.getByText(/not configured for this environment/i)).toBeTruthy())
  })

  it('opens the scanner drawer from the toolbar', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /scan serial/i }))
    await waitFor(() => expect(screen.getByLabelText(/scan or type, then press enter/i)).toBeTruthy())
  })

  it('keeps the document number placeholder that means "number it for me"', () => {
    renderPage()
    const input = screen.getByLabelText(/document no/i) as HTMLInputElement
    expect(input.placeholder).toBe('Auto-generate')
    expect(input.value).toBe('')
  })
})

describe('permissions', () => {
  it('hides Save & post from a profile that may not post', async () => {
    vi.resetModules()
    vi.doMock('../../access/AccessContext', () => ({
      useAccess: () => ({ can: (keys: string | string[]) => !(Array.isArray(keys) ? keys : [keys]).some((k) => k.includes('post')), profile: null, loading: false, allowedWarehouses: null }),
    }))
    const { SerialAdjustmentPage: Restricted } = await import('./SerialAdjustmentPage')
    render(
      <MemoryRouter>
        <Restricted onSaved={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /save & post/i })).toBeNull()
    expect(screen.getByRole('button', { name: /save as draft/i })).toBeTruthy()
    vi.doUnmock('../../access/AccessContext')
  })
})
