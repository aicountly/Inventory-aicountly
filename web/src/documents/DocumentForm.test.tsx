import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentForm } from './DocumentForm'
import { specForCode } from './registry'

/*
 * A smoke render for the "lines"-form workspace (metrics, AI assistant panel, sticky action bar)
 * plus a check that every other native type still renders its original, unchanged single-column
 * layout — the two states DocumentForm switches between.
 *
 * The breadcrumb, the page title and the Draft badge are deliberately NOT asserted here: they
 * moved up to DocumentFormPage, which now wraps DocumentForm in a PageShell + BreadcrumbHeader
 * the same way it wraps every type that has since gained a screen of its own. This file mounts
 * DocumentForm alone, so that chrome is not in the tree; DocumentFormPage.openingStock.test.tsx
 * is what covers it.
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
  it('renders the metric cards, document details, line items and AI assistant panel', () => {
    renderForm('WRITE_IN')
    expect(screen.getByText('Items Added')).toBeTruthy()
    expect(screen.getByText('Estimated Value')).toBeTruthy()
    expect(screen.getByText('Auto-Cost Confidence')).toBeTruthy()
    // The details card is titled with the type itself; the page above supplies the breadcrumb.
    expect(screen.getByText('Stock Write-In / Excess')).toBeTruthy()
    expect(screen.getByText('Narration')).toBeTruthy()
    expect(screen.getByText('Items')).toBeTruthy()
    expect(screen.getByText('AI Inventory Assistant')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search item by name, SKU or barcode…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save & post/ })).toBeTruthy()
  })

  it('reflects an entered quantity and rate in the estimated value card', () => {
    renderForm('WRITE_IN')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '100' } })
    // The "Estimated Value" metric card. The sticky bar carries the line count and the
    // actions, not an amount, so the figure appears exactly once.
    expect(screen.getAllByText('₹ 500.00')).toHaveLength(1)
  })
})

describe('DocumentForm — every other native type keeps its original layout', () => {
  // A stock transfer reaches StockTransferWorkspace through DocumentFormPage now, so this is
  // the fallback layout rather than the screen a user sees — still worth holding: the fallback
  // is what any type without a dedicated screen gets.
  it('renders Stock Transfer with its own header fields and no lines-only chrome', () => {
    renderForm('STOCK_TRANSFER')
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
  it('opens the keyboard shortcuts popover from the line toolbar action', () => {
    renderForm('WRITE_OFF')
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    expect(within(screen.getByRole('dialog')).getByText('Keyboard shortcuts')).toBeTruthy()
  })
})
