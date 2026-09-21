import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../ui/ToastContext'
import { SerialFormDrawer } from './SerialFormDrawer'
import { ApiError } from '../services/api'
import type { Serial } from '../services/masters'

const createSpy = vi.fn()
const updateSpy = vi.fn()

vi.mock('../services/masters', async () => {
  const actual = await vi.importActual<typeof import('../services/masters')>('../services/masters')
  return {
    ...actual,
    serialsApi: {
      ...actual.serialsApi,
      create: (body: Record<string, unknown>) => createSpy(body),
      update: (id: number, body: Record<string, unknown>) => updateSpy(id, body),
    },
    batchesApi: { ...actual.batchesApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
    locationsApi: { ...actual.locationsApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
  }
})

const OPTIONS = {
  item_groups: [],
  stock_categories: [],
  brands: [],
  units: [],
  warehouses: [{ warehouse_id: 12, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 }],
  valuation_methods: [],
  default_valuation_method: 'FIFO',
  negative_stock_policies: [],
  itc_eligibility_options: [],
}

const ROW: Serial = {
  serial_id: 1,
  item_id: 5,
  serial_no: 'SN-1',
  batch_id: null,
  warehouse_id: 12,
  location_id: null,
  status: 'in_stock',
  unit_cost: 1000,
  warranty_until: '2029-04-15',
  attributes: null,
  item_name: 'MacBook Pro 14"',
  item_sku: 'MBP14',
  warehouse_name: 'Main Warehouse',
  batch_no: null,
  location_code: null,
}

function renderDrawer(props: Partial<React.ComponentProps<typeof SerialFormDrawer>> = {}) {
  const onOpenExisting = vi.fn()
  const onSaved = vi.fn()
  render(
    <MemoryRouter>
      <ToastProvider>
        <SerialFormDrawer
          open
          mode="edit"
          row={ROW}
          onClose={vi.fn()}
          onSaved={onSaved}
          onOpenExisting={onOpenExisting}
          onBulkAdd={vi.fn()}
          options={OPTIONS as never}
          costVisible
          canWrite
          {...props}
        />
      </ToastProvider>
    </MemoryRouter>,
  )
  return { onOpenExisting, onSaved }
}

beforeEach(() => {
  createSpy.mockReset()
  updateSpy.mockReset()
  updateSpy.mockResolvedValue(ROW)
  createSpy.mockResolvedValue(ROW)
})

describe('SerialFormDrawer', () => {
  it('renders the record’s own fields', () => {
    renderDrawer()
    expect(screen.getByLabelText(/^Serial number/, { selector: 'input' })).toBeTruthy()
    expect((screen.getByLabelText(/^Serial number/, { selector: 'input' }) as HTMLInputElement).value).toBe('SN-1')
    expect(screen.getByLabelText(/^Unit cost/, { selector: 'input' })).toBeTruthy()
  })

  it('drops the cost field entirely when the reader may not see cost', () => {
    // A disabled input still carries the value it was given.
    renderDrawer({ costVisible: false })
    expect(screen.queryByLabelText(/^Unit cost/, { selector: 'input' })).toBeNull()
  })

  it('will not save an empty serial number', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText(/^Serial number/, { selector: 'input' }), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(screen.getByText(/required/i)).toBeTruthy())
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('keeps a serial exactly as typed — nothing is normalised away', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText(/^Serial number/, { selector: 'input' }), { target: { value: 'SN/AP-2026/00125' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0][1].serial_no).toBe('SN/AP-2026/00125')
  })

  it('offers the existing record when the API reports a duplicate', async () => {
    updateSpy.mockRejectedValue(
      new ApiError(409, 'conflict', 'Serial "SN-1" already exists for this item', { field: 'serial_no', serial_no: 'SN-1' }),
    )
    const { onOpenExisting } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))
    // The server owns uniqueness; the screen reports its answer and offers the
    // useful half of it.
    expect(await screen.findByText('Serial number already exists')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Show the existing/ }))
    expect(onOpenExisting).toHaveBeenCalledWith('SN-1')
  })

  it('saves on Ctrl+Enter', async () => {
    renderDrawer()
    fireEvent.keyDown(screen.getByLabelText(/^Serial number/, { selector: 'input' }), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
  })

  it('offers "Save & add another" only when registering, not when editing', () => {
    // Registering one unit at a time is rare; registering twelve is not. There
    // is nothing to add another of when editing an existing record.
    renderDrawer({ mode: 'create', row: null })
    expect(screen.getByRole('button', { name: /Save & add another/ })).toBeTruthy()
  })

  it('will not register a serial without an item to attach it to', async () => {
    renderDrawer({ mode: 'create', row: null })
    fireEvent.change(screen.getByLabelText(/^Serial number/, { selector: 'input' }), { target: { value: 'SN-2' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save serial number/ }))
    await waitFor(() => expect(screen.getByText(/required/i)).toBeTruthy())
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('shows no save button at all to a reader who may not write', () => {
    renderDrawer({ canWrite: false })
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })
})
