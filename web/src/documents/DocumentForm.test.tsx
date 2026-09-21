import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentForm } from './DocumentForm'
import { specForCode } from './registry'

/*
 * A smoke render for the "lines"-form premium workspace (metrics row, AI assistant panel,
 * duplicate-line action, shortcuts popover, toasts) layered onto the shared engine every native
 * type still funnels through here, plus a check that a type with its own dedicated workspace
 * upstream (job work, transfer, …) — modelled here by a type DocumentForm itself still renders a
 * plain single column for — never gets the "lines"-only chrome.
 */

const can = vi.fn(() => true)
vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false }),
}))

vi.mock('./useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 1, warehouse_name: 'Main store', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 }],
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null) => (id === 1 ? 'Main store' : ''),
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ notify: () => {}, success: () => {}, error: () => {}, info: () => {} }),
}))

function renderForm(code: string) {
  const spec = specForCode(code)
  if (!spec) throw new Error(`no spec for ${code}`)
  return render(
    <MemoryRouter>
      <DocumentForm spec={spec} onSaved={() => {}} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
})

describe('DocumentForm — "lines" type gets the premium workspace', () => {
  it('renders the metrics row, document details, items table and AI assistant panel', () => {
    renderForm('WRITE_IN')
    expect(screen.getByText('Items Added')).toBeTruthy()
    expect(screen.getByText('Estimated Value')).toBeTruthy()
    expect(screen.getByText('Auto-Cost Confidence')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Stock Write-In / Excess' })).toBeTruthy()
    expect(screen.getByText('Items')).toBeTruthy()
    expect(screen.getByText('AI Inventory Assistant')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search item by name, SKU or barcode…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save & post/ })).toBeTruthy()
  })

  it('shows the Variance Source card reflecting the entered reason code', () => {
    renderForm('WRITE_IN')
    expect(screen.getByText('Manual Entry')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('e.g. DAMAGE'), { target: { value: 'FOUND' } })
    expect(screen.getByText('FOUND')).toBeTruthy()
  })

  it('reflects an entered quantity and rate in the estimated value card and the totals footer', () => {
    renderForm('WRITE_IN')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '100' } })
    // Once in the "Estimated Value" metric card, once in the line's own Amount cell.
    expect(screen.getAllByDisplayValue('500').length + screen.getAllByText(/₹\s*500\.00/).length).toBeGreaterThan(0)
  })

  it('offers a duplicate action on each line alongside remove', () => {
    renderForm('WRITE_IN')
    expect(screen.getByRole('button', { name: 'Duplicate line 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeTruthy()
  })

  it('opens the keyboard shortcuts popover and lists the search-items binding for a lines type', () => {
    renderForm('WRITE_OFF')
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Keyboard shortcuts')).toBeTruthy()
    expect(dialog.getByText('Search items')).toBeTruthy()
    expect(dialog.getByText('Add line')).toBeTruthy()
  })
})

describe('DocumentForm — a type without the "lines" form kind stays a single column', () => {
  it('renders Landed Cost with its own panel and no metrics/AI panel', () => {
    renderForm('LANDED_COST')
    expect(screen.queryByText('Items Added')).toBeNull()
    expect(screen.queryByText('AI Inventory Assistant')).toBeNull()
  })
})
