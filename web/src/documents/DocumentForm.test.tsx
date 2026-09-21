import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentForm } from './DocumentForm'
import { specForCode } from './registry'

/*
 * A smoke render for the revamped "lines"-form workspace (hero, metrics, AI assistant panel,
 * sticky action bar) plus a check that every other native type still renders its original,
 * unchanged single-column layout — the two states DocumentForm switches between.
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
  it('renders the hero, metric cards, document details, line items and AI assistant panel', () => {
    renderForm('WRITE_IN')
    expect(screen.getByRole('heading', { name: 'Stock Write-In / Excess', level: 1 })).toBeTruthy()
    expect(screen.getByText('Bring found or excess stock in at a cost.')).toBeTruthy()
    expect(screen.getByText('Items Added')).toBeTruthy()
    expect(screen.getByText('Estimated Value')).toBeTruthy()
    expect(screen.getByText('Auto-Cost Confidence')).toBeTruthy()
    expect(screen.getByText('Document Details')).toBeTruthy()
    expect(screen.getByText('Narration')).toBeTruthy()
    expect(screen.getByText('Line Items')).toBeTruthy()
    expect(screen.getByText('AI Inventory Assistant')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search item by name, SKU or barcode…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save Draft/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save & Post/ })).toBeTruthy()
  })

  it('shows the Draft, Auto Numbering, Warehouse and Cost Review chips for a fresh new document', () => {
    renderForm('WRITE_IN')
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Auto Numbering')).toBeTruthy()
    expect(screen.getByText('Warehouse: Main store')).toBeTruthy()
    expect(screen.getByText('Cost Review')).toBeTruthy()
  })

  it('reflects an entered quantity and rate in the estimated value card and the totals footer', () => {
    renderForm('WRITE_IN')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '100' } })
    // Once in the "Estimated Value" metric card, once in the sticky footer's Amount total.
    expect(screen.getAllByText('₹ 500.00')).toHaveLength(2)
  })
})

describe('DocumentForm — every other native type keeps its original layout', () => {
  it('renders Stock Transfer with its own header fields and no lines-only chrome', () => {
    renderForm('STOCK_TRANSFER')
    expect(screen.getByRole('heading', { name: 'Stock Transfer', level: 1 })).toBeTruthy()
    expect(screen.getByText('From warehouse')).toBeTruthy()
    expect(screen.getByText('To warehouse')).toBeTruthy()
    expect(screen.queryByText('Items Added')).toBeNull()
    expect(screen.queryByText('AI Inventory Assistant')).toBeNull()
  })

  it('renders Stock Revaluation with its own lines note and no lines-only chrome', () => {
    renderForm('REVALUATION')
    expect(screen.getByText(/re-prices every layer/)).toBeTruthy()
    expect(screen.queryByText('AI Inventory Assistant')).toBeNull()
  })
})

describe('DocumentForm — shared chrome applies to every type', () => {
  it('opens the keyboard shortcuts popover from the hero action', () => {
    renderForm('WRITE_OFF')
    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    expect(within(screen.getByRole('dialog')).getByText('Keyboard shortcuts')).toBeTruthy()
  })
})
