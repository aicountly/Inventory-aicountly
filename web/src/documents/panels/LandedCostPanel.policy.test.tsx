import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LandedCostPanel } from './LandedCostPanel'

/**
 * The charges panel under a company that does NOT capitalise every kind of charge.
 *
 * Which charges are part of the cost of inventory is an accounting policy of the company holding
 * the stock — some capitalise inward freight, some expense it — and it is set in Inventory
 * settings. The panel offers only what is switched on; the server refuses the rest with a 422,
 * which is what actually enforces the policy. Offering a type the server would refuse teaches the
 * operator to type something that cannot be saved.
 *
 * The one type that is never absent is a non-creditable tax: under AS-2 a tax that cannot be
 * recovered is part of the cost of purchase, so it is not a switch at all.
 */

const RECEIPT = {
  document_id: 41,
  document_no: 'P-1001',
  document_date: '2026-04-10',
  party_ref: 77,
  lines: [{ line_id: 11, item_id: 5, item_label: 'Cheap widget', direction: 'in', base_qty: 10, valuation_rate: 100, valuation_amount: 1000, unit_symbol: 'Pcs' }],
}

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: vi.fn(async () => ({ data: [{ document_id: 41, document_no: 'P-1001', document_date: '2026-04-10', party_name: 'Acme Supplies' }], meta: {} })),
    get: vi.fn(async () => RECEIPT),
  },
}))

// Freight and "other" are expensed by this company, not capitalised.
vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    landedCostPolicy: vi.fn(async () => ({
      capitalisable_cost_types: ['duty', 'insurance', 'handling', 'non_creditable_tax'],
      excluded_cost_types: ['freight', 'other'],
      switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
      always_capitalised_cost_types: ['non_creditable_tax'],
      all_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
    })),
  },
}))

async function renderPanel(initial: Record<string, unknown> = {}) {
  render(<LandedCostPanel initial={initial} onChange={vi.fn()} />)
  await screen.findByRole('option', { name: /P-1001/ })
  fireEvent.change(screen.getByLabelText(/Receipt/), { target: { value: '41' } })
  await screen.findByText('Cheap widget')
}

function costTypeOptions(): string[] {
  const select = screen.getByLabelText('Charge 1 cost type') as HTMLSelectElement
  return Array.from(select.options).map((o) => o.value)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LandedCostPanel under a capitalisation policy', () => {
  it('offers only the cost types this company capitalises', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Add charge/ }))

    expect(costTypeOptions()).toEqual(['duty', 'insurance', 'handling', 'non_creditable_tax'])
    expect(costTypeOptions()).not.toContain('freight')
  })

  /** Seeding a row with a type the server refuses is a 422 the operator never asked for. */
  it('starts a new charge on a type the company actually capitalises', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Add charge/ }))

    expect((screen.getByLabelText('Charge 1 cost type') as HTMLSelectElement).value).toBe('duty')
  })

  /**
   * A draft saved before the policy changed. The select must still show its stored type, or it
   * renders blank and the next edit silently rewrites the charge to the first option in the list.
   */
  it('still shows the stored type of a charge saved before the type was switched off', async () => {
    await renderPanel({ target_document_id: 41, charges: [{ cost_type: 'freight', amount: 400, allocation_basis: 'value' }] })

    const select = screen.getByLabelText('Charge 1 cost type') as HTMLSelectElement
    expect(select.value).toBe('freight')
    expect(costTypeOptions()).toContain('freight')
  })

  it('says on screen which charges this company does not capitalise, and that the tax one is not a switch', async () => {
    await renderPanel()

    expect(screen.getByText(/does not capitalise Freight, Other into stock/)).toBeTruthy()
    expect(screen.getByText(/non-creditable tax is always capitalised and cannot be switched off/i)).toBeTruthy()
  })
})
