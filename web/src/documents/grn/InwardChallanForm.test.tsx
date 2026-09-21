import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../ui/ToastContext'
import { InwardChallanForm } from './InwardChallanForm'
import { newHeader, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { specForCode } from '../registry'

/*
 * The receiving screen's promise, held here: the running totals and the alerts are derived from
 * the draft on screen, and the one button that cannot be taken back is disabled while anything
 * about the draft would make posting wrong.
 */

const GRN = specForCode('INWARD_CHALLAN')!

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, permissions: [], profile: null, member: null, allowedWarehouses: null, isOwner: true, error: null, reload: () => {} }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    companyName: 'Aicountly Interactive Services',
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Aicountly Interactive Services · FY 2026-27 · All branches',
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', is_default: 1, bo_id: 0 }],
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null) => (id === 1 ? 'Main Warehouse' : ''),
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: vi.fn().mockResolvedValue({ base_currency_code: 'INR' }) },
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    itemsByIds: vi.fn().mockResolvedValue([]),
    searchItems: vi.fn().mockResolvedValue([]),
    itemByBarcode: vi.fn().mockResolvedValue(null),
    batches: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    serials: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    createBatch: vi.fn(),
    bulkCreateSerials: vi.fn(),
  },
}))

const post = vi.fn()
vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: vi.fn().mockResolvedValue({ document_id: 7, status: 'DRAFT', lines: [] }),
    update: vi.fn(),
    post: (...args: unknown[]) => post(...args),
    list: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
  },
}))

function header(partial: Partial<HeaderDraft> = {}): HeaderDraft {
  return {
    ...newHeader(GRN, '2026-09-18'),
    party_ref: '1042',
    party_name: 'Adani Enterprises Limited',
    default_warehouse_id: 1,
    ...partial,
  }
}

function line(partial: Partial<LineDraft> = {}): LineDraft {
  return newLine(GRN, {
    item_id: 10,
    item_name: 'UltraTech Cement 50kg',
    item_sku: 'UTC-50',
    warehouse_id: 1,
    unit_id: 1,
    units: [{ unit_id: 1, unit_symbol: 'Bags', conversion_factor: 1, is_default: true }],
    qty: '200',
    rate: '450',
    amount: '90000',
    ...partial,
  })
}

function renderForm(initial?: { header: HeaderDraft; lines: LineDraft[] }) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <InwardChallanForm spec={GRN} initial={initial} onSaved={() => {}} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  post.mockReset()
})

describe('the inward challan screen', () => {
  it('opens on a usable document rather than an empty one', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: /New Inward Challan \/ GRN/i })).toBeTruthy()
    expect(screen.getByText('Receive goods from supplier against a purchase order, challan or direct supply.')).toBeTruthy()
    // The document number is left to the server unless the user asks to type one.
    const documentNo = screen.getByLabelText(/Document no/i) as HTMLInputElement
    expect(documentNo.disabled).toBe(true)
    expect(screen.getByText(/Numbered automatically when the draft is saved/i)).toBeTruthy()
  })

  it('offers every way of adding an item', () => {
    renderForm()
    expect(screen.getByRole('button', { name: /^Add item$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Scan barcode/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bulk add/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import from PO/i })).toBeTruthy()
    expect(screen.getByPlaceholderText(/Add item — search by name, SKU, barcode or scan/i)).toBeTruthy()
  })

  it('totals the lines on screen instead of keeping a running figure', () => {
    renderForm({ header: header(), lines: [line(), line({ qty: '10', rate: '52000', amount: '520000' })] })
    const summary = screen.getByText('Total amount').closest('div')?.parentElement as HTMLElement
    expect(within(summary).getByText('Total items').nextElementSibling?.textContent).toBe('2')
    expect(within(summary).getByText('Total quantity').nextElementSibling?.textContent).toBe('210')
    expect(within(summary).getByText('Total amount').nextElementSibling?.textContent).toContain('6,10,000.00')
  })

  it('says what posting will do to stock, and changes its mind with the stock effect', () => {
    renderForm({ header: header(), lines: [line()] })
    expect(screen.getByText('Stock will be updated as pending (Challan only).')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Stock effect/i), { target: { value: 'physical' } })
    expect(screen.getByText('Stock moves into the warehouse as soon as this document posts.')).toBeTruthy()
  })

  it('will not offer to post a receipt whose batch-tracked line has no batch', () => {
    renderForm({ header: header(), lines: [line({ track_batch: true })] })
    expect(screen.getByText(/batch-tracked item still needs a batch/i)).toBeTruthy()
    const postButton = screen.getByRole('button', { name: /Save & post/i }) as HTMLButtonElement
    expect(postButton.disabled).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it('confirms before posting rather than posting on the click', () => {
    renderForm({ header: header(), lines: [line()] })
    fireEvent.click(screen.getByRole('button', { name: /Save & post/i }))
    expect(screen.getByRole('heading', { name: /Post inward challan \/ GRN\?/i })).toBeTruthy()
    expect(screen.getByText(/Stock will remain pending until the challan is accepted or converted/i)).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
  })

  it('hides Save & post from a profile that may not post', () => {
    can.mockImplementation((key) => !(Array.isArray(key) ? key : [key as string]).some((k) => k.includes('.post')))
    renderForm({ header: header(), lines: [line()] })
    expect(screen.queryByRole('button', { name: /Save & post/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/i })).toBeTruthy()
  })

  it('records a workflow tag without touching how the document posts', () => {
    renderForm({ header: header(), lines: [line()] })
    const tag = screen.getByRole('button', { name: 'Sample Goods' })
    expect(tag.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(tag)
    expect(screen.getByRole('button', { name: 'Sample Goods' }).getAttribute('aria-pressed')).toBe('true')
    // The stock effect is untouched by a label.
    expect(screen.getByText('Stock will be updated as pending (Challan only).')).toBeTruthy()
  })

  it('warns when the supplier ledger is not linked, because pending quantities are matched on it', () => {
    renderForm({ header: header({ party_ref: '' }), lines: [line()] })
    expect(screen.getByText(/No supplier ledger is linked/i)).toBeTruthy()
  })
})
