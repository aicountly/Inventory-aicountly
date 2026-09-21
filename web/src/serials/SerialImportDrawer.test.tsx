import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../ui/ToastContext'
import { SerialImportDrawer } from './SerialImportDrawer'

const bulkCreateSpy = vi.fn()

vi.mock('../services/masters', async () => {
  const actual = await vi.importActual<typeof import('../services/masters')>('../services/masters')
  return {
    ...actual,
    serialsApi: { ...actual.serialsApi, bulkCreate: (body: unknown) => bulkCreateSpy(body) },
    batchesApi: { ...actual.batchesApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
    locationsApi: { ...actual.locationsApi, list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 50, offset: 0 } }) },
  }
})

const WAREHOUSES = [
  { warehouse_id: 12, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
]

function renderDrawer(initialMethod: 'paste' | 'file' | 'range' | 'scan' = 'paste') {
  const onImported = vi.fn()
  render(
    <MemoryRouter>
      <ToastProvider>
        <SerialImportDrawer open onClose={vi.fn()} onImported={onImported} warehouses={WAREHOUSES} initialMethod={initialMethod} />
      </ToastProvider>
    </MemoryRouter>,
  )
  return { onImported }
}

beforeEach(() => {
  bulkCreateSpy.mockReset()
  bulkCreateSpy.mockResolvedValue({
    item_id: 5,
    item_name: 'MacBook Pro 14"',
    created: [{ serial_id: 1, serial_no: 'SN-0001' }],
    skipped: [{ serial_no: 'SN-0002', reason: 'already_registered', status: 'in_stock' }],
    created_count: 1,
    skipped_count: 1,
  })
})

describe('SerialImportDrawer', () => {
  it('classifies a pasted list before anything is sent', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText(/^Serial numbers/, { selector: 'textarea' }), {
      target: { value: 'SN-0001\nSN-0002\nSN-0001\n' },
    })
    await waitFor(() => expect(screen.getAllByText('2 ready').length).toBeGreaterThan(0))
    expect(screen.getAllByText('1 repeated').length).toBeGreaterThan(0)
    // Nothing is dropped quietly: the repeat is on screen with its reason.
    expect(screen.getAllByText('Repeated in this file').length).toBe(1)
  })

  it('will not import until an item is chosen', async () => {
    renderDrawer()
    fireEvent.change(screen.getByLabelText(/^Serial numbers/, { selector: 'textarea' }), { target: { value: 'SN-0001' } })
    await waitFor(() => expect(screen.getAllByText('1 ready').length).toBeGreaterThan(0))
    // A serial belongs to exactly one item — there is nowhere to put these yet.
    expect((screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('generates a numbered range into the list', async () => {
    renderDrawer('range')
    fireEvent.change(screen.getByLabelText(/^Prefix/, { selector: 'input' }), { target: { value: 'SN-' } })
    fireEvent.change(screen.getByLabelText(/^From/, { selector: 'input' }), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^To/, { selector: 'input' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Add the range to the list/ }))
    await waitFor(() => expect(screen.getAllByText('3 ready').length).toBeGreaterThan(0))
    expect(screen.getByText('SN-0001')).toBeTruthy()
    expect(screen.getByText('SN-0003')).toBeTruthy()
  })

  it('adds each scan to the list and flags a second scan of the same code', async () => {
    renderDrawer('scan')
    const box = screen.getByLabelText(/^Scan into the list/, { selector: 'input' })
    fireEvent.change(box, { target: { value: 'SN-0001' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.change(box, { target: { value: 'SN-0001' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText('1 ready').length).toBeGreaterThan(0))
    expect(screen.getAllByText('1 repeated').length).toBeGreaterThan(0)
  })

  it('offers a template for the file nobody has written yet', () => {
    renderDrawer('file')
    expect(screen.getByRole('button', { name: /Download a template/ })).toBeTruthy()
    expect(screen.getByText(/Choose a CSV file/)).toBeTruthy()
  })
})
