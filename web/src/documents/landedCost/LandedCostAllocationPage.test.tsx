import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../ui/ToastContext'
import { LandedCostAllocationPage } from './LandedCostAllocationPage'
import { specForCode } from '../registry'
import type { CreateDocumentPayload, InventoryDocument } from '../types'

/**
 * The landed cost screen end to end.
 *
 * What is held here is the part that costs money if it is wrong: the split shown before posting is
 * the split that gets sent, several receipts are allocated over as ONE consignment, a receipt that
 * cannot carry a cost stops the posting rather than being quietly dropped, a receipt that moved
 * since it was read is refused, and a failed save never costs the operator the bill they just typed.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const list = vi.fn()
const get = vi.fn()
const create = vi.fn()
const update = vi.fn()
const post = vi.fn()

function receipt(id: number, no: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}): InventoryDocument {
  return {
    document_id: id,
    document_no: no,
    document_date: '2026-09-15',
    status: 'POSTED',
    version: 1,
    party_ref: 1042,
    party_name: 'Global Components Ltd.',
    lines,
    ...extra,
  } as unknown as InventoryDocument
}

// Two receipts of one consignment: 4,80,000 over 1,250 units and 1,20,000 over 300.
const GRN_145 = receipt(41, 'GRN-000145', [
  { line_id: 11, item_id: 5, item_label: 'Industrial bearing', item_sku: 'BRG-6205', direction: 'in', base_qty: 1000, valuation_rate: 400, valuation_amount: 400000, source_transaction_amount: 400000, warehouse_id: 1, warehouse_name: 'Main', unit_symbol: 'Pcs', landed_cost_amount: 0 },
  { line_id: 12, item_id: 6, item_label: 'Drive belt', item_sku: 'BLT-88', direction: 'in', base_qty: 250, valuation_rate: 320, valuation_amount: 80000, source_transaction_amount: 80000, warehouse_id: 1, warehouse_name: 'Main', unit_symbol: 'Pcs', landed_cost_amount: 0 },
  // Neither can carry a cost, so neither may appear in the review.
  { line_id: 13, item_id: 7, item_label: 'Issued widget', direction: 'out', base_qty: 4, valuation_rate: 100, valuation_amount: 400 },
  { line_id: 14, item_id: 8, item_label: 'Unvalued widget', direction: 'in', base_qty: 4, valuation_rate: null, valuation_amount: null },
])

const GRN_146 = receipt(42, 'GRN-000146', [
  { line_id: 21, item_id: 9, item_label: 'Seal kit', item_sku: 'SEA-12', direction: 'in', base_qty: 300, valuation_rate: 400, valuation_amount: 120000, source_transaction_amount: 120000, warehouse_id: 1, warehouse_name: 'Main', unit_symbol: 'Pcs', landed_cost_amount: 0 },
])

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 54, fy_id: 2, bo_id: 0 }, companyName: 'Acme Ltd', addressLines: [], gstin: null, logo: null }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'u1' }, profile: { template_key: 'owner' }, isOwner: false }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 1, warehouse_name: 'Main', warehouse_code: 'HO' }],
    units: [],
    defaultWarehouseId: 1,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Pcs',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: (...args: unknown[]) => list(...args),
    get: (...args: unknown[]) => get(...args),
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
    post: (...args: unknown[]) => post(...args),
  },
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    landedCostPolicy: vi.fn(async () => ({
      capitalisable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
      excluded_cost_types: [],
      switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
      always_capitalised_cost_types: ['non_creditable_tax'],
      all_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
    })),
    get: vi.fn(async () => ({ base_currency_code: 'INR' })),
    periodLocks: vi.fn(async () => []),
  },
}))

const SPEC = specForCode('LANDED_COST')!

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <LandedCostAllocationPage spec={SPEC} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/** Open the picker, tick the named receipts, close it, and wait for their lines. */
async function selectReceipts(numbers: string[], { expectLines = true } = {}) {
  fireEvent.click(screen.getAllByRole('button', { name: /^(Choose|Add) receipts$/ })[0])
  for (const no of numbers) {
    const row = await screen.findByText(no)
    fireEvent.click(within(row.closest('label') as HTMLElement).getByRole('checkbox'))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  // The lines are read after the tick, and nothing downstream — the review table, the totals, the
  // Post button's readiness — exists until they land. A receipt with no allocatable line never
  // produces the table at all, which is the point of that test rather than a wait to be endured.
  if (expectLines) await screen.findByRole('table', { name: /Per-line effect/i })
  else await screen.findByText(/Receipt no\./)
}

async function addCharge(amount: string, basis?: string) {
  // Exact: the stepper's "Add charges" step is a button too, and a regex matches it first.
  fireEvent.click(screen.getAllByRole('button', { name: 'Add charge' })[0])
  const n = screen.queryAllByLabelText(/Charge \d+ amount/).length
  fireEvent.change(screen.getByLabelText(`Charge ${n} amount`), { target: { value: amount } })
  if (basis) fireEvent.change(screen.getByLabelText(`Charge ${n} allocation basis`), { target: { value: basis } })
}

beforeEach(() => {
  vi.clearAllMocks()
  can.mockImplementation(() => true)
  list.mockResolvedValue({
    data: [
      { document_id: 41, document_no: 'GRN-000145', document_date: '2026-09-15', party_name: 'Global Components Ltd.', line_count: 4, valuation_total: 480000, status: 'POSTED' },
      { document_id: 42, document_no: 'GRN-000146', document_date: '2026-09-16', party_name: 'Global Components Ltd.', line_count: 1, valuation_total: 120000, status: 'POSTED' },
    ],
    meta: {},
  })
  get.mockImplementation(async (id: number) => (id === 41 ? GRN_145 : GRN_146))
  create.mockImplementation(async (payload: CreateDocumentPayload) => ({ ...receipt(99, 'LCA-00023', []), ...payload, document_id: 99, document_no: 'LCA-00023' }))
  update.mockImplementation(async () => receipt(99, 'LCA-00023', []))
  post.mockImplementation(async () => ({ ...receipt(99, 'LCA-00023', []), status: 'POSTED', warnings: [] }))
})

describe('LandedCostAllocationPage', () => {
  it('opens on the five-step tracker with the sections it will need', async () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Landed cost allocation' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: /progress/i })).toBeTruthy()
    for (const step of ['Document details', 'Select receipts', 'Add charges', 'Allocate & review', 'Post']) {
      expect(screen.getAllByText(step).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('No receipts selected')).toBeTruthy()
    expect(screen.getByText('No charges yet')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Nothing to review yet')).toBeTruthy())
  })

  it('offers only the receipt lines a cost can actually be loaded onto', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])

    await waitFor(() => expect(screen.getByText('Industrial bearing')).toBeTruthy())
    expect(screen.getByText('Drive belt')).toBeTruthy()
    // The outward line and the unvalued line carry no cost of goods to add to.
    expect(screen.queryByText('Issued widget')).toBeNull()
    expect(screen.queryByText('Unvalued widget')).toBeNull()
  })

  it('takes the supplier from the receipt rather than asking for it twice', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])

    await waitFor(() => expect((screen.getByLabelText(/Supplier ledger id/) as HTMLInputElement).value).toBe('1042'))
    expect((screen.getByLabelText('Supplier') as HTMLInputElement).value).toBe('Global Components Ltd.')
  })

  /** One bill over a consignment that arrived on two GRNs is the case this screen exists for. */
  it('spreads one charge over the lines of every selected receipt at once', async () => {
    renderPage()
    await selectReceipts(['GRN-000145', 'GRN-000146'])
    await waitFor(() => expect(screen.getByText('Seal kit')).toBeTruthy())

    await addCharge('60000')

    // By value over 4,00,000 / 80,000 / 1,20,000 of a 6,00,000 consignment: 40,000 / 8,000 / 12,000.
    const review = screen.getByRole('table', { name: /Per-line effect/i })
    await waitFor(() => expect(within(review).getByText('40,000.00')).toBeTruthy())
    expect(within(review).getByText('8,000.00')).toBeTruthy()
    expect(within(review).getByText('12,000.00')).toBeTruthy()
  })

  it('updates the landed cost and the revised stock value as the amount is typed', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('48550')

    // Header KPI, action bar and impact summary all read from the same figure.
    await waitFor(() => expect(screen.getAllByText(/48,550\.00/).length).toBeGreaterThan(1))
    expect(screen.getAllByText(/5,28,550\.00/).length).toBeGreaterThan(0)
  })

  it('re-splits when the basis changes', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('2400')

    // By value over lines worth 4,00,000 and 80,000: 2,000 and 400.
    const review = screen.getByRole('table', { name: /Per-line effect/i })
    await waitFor(() => expect(within(review).getAllByText('2,000.00').length).toBeGreaterThan(0))
    expect(within(review).getAllByText('400.00').length).toBeGreaterThan(0)

    // Equal: the same share to each of the two lines, whatever they are worth.
    fireEvent.change(screen.getByLabelText('Charge 1 allocation basis'), { target: { value: 'equal' } })
    await waitFor(() => expect(within(review).getAllByText('1,200.00').length).toBeGreaterThan(0))
  })

  it('typing over one line switches that charge to entered-per-line and keeps the other shares', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('2400')

    fireEvent.click(screen.getByRole('button', { name: /Per-charge columns/ }))
    const bearing = await screen.findByLabelText('Freight on Industrial bearing')
    await waitFor(() => expect((bearing as HTMLInputElement).value).toBe('2000'))

    fireEvent.change(bearing, { target: { value: '1500' } })

    await waitFor(() => expect((screen.getByLabelText('Charge 1 allocation basis') as HTMLSelectElement).value).toBe('manual'))
    // The other line keeps what the pro-rata split had worked out, rather than being blanked.
    expect((screen.getByLabelText('Freight on Drive belt') as HTMLInputElement).value).toBe('400')
  })

  it('refuses to post while part of a charge reaches no line, and says how much', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('2400')

    fireEvent.click(screen.getByRole('button', { name: /Per-charge columns/ }))
    const bearing = await screen.findByLabelText('Freight on Industrial bearing')
    await waitFor(() => expect((bearing as HTMLInputElement).value).toBe('2000'))
    fireEvent.change(bearing, { target: { value: '1000' } })

    // 1,000 typed plus the 400 the other line keeps leaves 1,000 of the charge reaching nothing.
    await waitFor(() => expect(screen.getByText(/Allocation reconciled/)).toBeTruthy())
    // Said in both places it matters: the readiness gate and the insight list.
    expect(screen.getAllByText(/1000\.00 of the charges reaches no line/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: /Allocate & post/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends both receipts and the charges the preview showed', async () => {
    renderPage()
    await selectReceipts(['GRN-000145', 'GRN-000146'])
    await waitFor(() => expect(screen.getByText('Seal kit')).toBeTruthy())
    await addCharge('60000')

    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const payload = create.mock.calls[0][0] as CreateDocumentPayload
    expect(payload.document_type).toBe('LANDED_COST')
    expect(payload.metadata?.target_document_ids).toEqual([41, 42])
    // The singular key rides along so readers written against the one-receipt shape keep working.
    expect(payload.metadata?.target_document_id).toBe(41)
    expect(payload.metadata?.charges).toEqual([{ cost_type: 'freight', amount: 60000, allocation_basis: 'value' }])
    expect(payload.lines).toEqual([])
  })

  it('keeps the entered bill when the save fails', async () => {
    create.mockRejectedValue(new Error('Inventory period is locked for this date.'))
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('48550')

    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))

    await waitFor(() => expect(screen.getByText('Inventory period is locked for this date.')).toBeTruthy())
    expect((screen.getByLabelText('Charge 1 amount') as HTMLInputElement).value).toBe('48550')
    expect(screen.getAllByText('GRN-000145').length).toBeGreaterThan(0)
  })

  it('confirms before posting, naming what it will and will not change', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('48550')

    fireEvent.click(screen.getByRole('button', { name: /Allocate & post/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Post landed cost allocation\?/)).toBeTruthy()
    expect(within(dialog).getByText(/GST figure are left exactly as they are/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Post allocation' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith(99))
    expect(await screen.findByRole('heading', { name: /LCA-00023 posted/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /View stock valuation/ })).toBeTruthy()
  })

  /**
   * The optimistic-lock check. A receipt that moved since it was read may have been re-posted or
   * reversed, and spreading a bill over figures that are no longer there is silent mis-statement.
   */
  it('refuses to post when a receipt changed after the allocation was prepared', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('48550')

    get.mockImplementation(async () => ({ ...GRN_145, version: 2 }))
    fireEvent.click(screen.getByRole('button', { name: /Allocate & post/ }))

    await waitFor(() => expect(screen.getByText(/Receipt data changed after this landed cost allocation was prepared/)).toBeTruthy())
    expect(post).not.toHaveBeenCalled()
  })

  it('stops the posting when a selected receipt cannot carry a cost, and says why', async () => {
    get.mockImplementation(async () => receipt(41, 'GRN-000145', [{ line_id: 11, item_id: 5, direction: 'in', base_qty: 4, valuation_rate: null, valuation_amount: null }]))
    renderPage()
    await selectReceipts(['GRN-000145'], { expectLines: false })
    await addCharge('1000')

    await waitFor(() => expect(screen.getAllByText('Unvalued').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/no line of this receipt was valued/i).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: /Allocate & post/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the draft but not the post to a profile that cannot post', async () => {
    can.mockImplementation((key) => {
      const keys = typeof key === 'string' ? [key] : [...key]
      return !keys.some((k) => k.endsWith('.post'))
    })
    renderPage()

    expect(screen.queryByRole('button', { name: /Allocate & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })

  it('says a charge is checked here, never that a service reviewed it', async () => {
    renderPage()
    await selectReceipts(['GRN-000145'])
    await addCharge('24960')

    await waitFor(() => expect(screen.getByText(/Freight is 5\.2% of invoice value/)).toBeTruthy())
    expect(screen.getByText(/checks run on this device/)).toBeTruthy()
  })
})
