import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LandedCostPanel } from './LandedCostPanel'
import type { ChargePayload } from '../landedCost'

/**
 * The charges block the user actually works in: pick the receipt, add charges, watch the split.
 *
 * The figure on screen has to be the figure that gets stored, so what is asserted here is that the
 * preview reaches the payload unchanged and that typing over one line's share switches that charge
 * to "entered per line" — rather than leaving a pro-rata basis on the document while the user
 * believes they set the numbers by hand.
 */

const RECEIPT = {
  document_id: 41,
  document_no: 'P-1001',
  document_date: '2026-04-10',
  party_ref: 77,
  lines: [
    { line_id: 11, item_id: 5, item_label: 'Cheap widget', direction: 'in', base_qty: 10, valuation_rate: 100, valuation_amount: 1000, unit_symbol: 'Pcs' },
    { line_id: 12, item_id: 6, item_label: 'Dear widget', direction: 'in', base_qty: 10, valuation_rate: 300, valuation_amount: 3000, unit_symbol: 'Pcs' },
    // An outward line and an unvalued line: neither can carry a landed cost, so neither is offered.
    { line_id: 13, item_id: 7, item_label: 'Issued widget', direction: 'out', base_qty: 4, valuation_rate: 100, valuation_amount: 400, unit_symbol: 'Pcs' },
    { line_id: 14, item_id: 8, item_label: 'Unvalued widget', direction: 'in', base_qty: 4, valuation_rate: null, valuation_amount: null, unit_symbol: 'Pcs' },
  ],
}

vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: vi.fn(async () => ({ data: [{ document_id: 41, document_no: 'P-1001', document_date: '2026-04-10', party_name: 'Acme Supplies' }], meta: {} })),
    get: vi.fn(async () => RECEIPT),
  },
}))

// The default company policy: every cost type is capitalised into stock. A company that has
// switched one off is LandedCostPanel.policy.test.tsx.
vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    landedCostPolicy: vi.fn(async () => ({
      capitalisable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
      excluded_cost_types: [],
      switchable_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other'],
      always_capitalised_cost_types: ['non_creditable_tax'],
      all_cost_types: ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
    })),
  },
}))

type PanelChange = (targetDocumentId: number | null, charges: ChargePayload[], partyRef: number | null) => void

function panelChange(): ReturnType<typeof vi.fn<PanelChange>> {
  return vi.fn<PanelChange>()
}

function lastPayload(onChange: ReturnType<typeof panelChange>): { targetId: number | null; charges: ChargePayload[] } {
  const call = onChange.mock.calls.at(-1)
  return { targetId: call?.[0] ?? null, charges: call?.[1] ?? [] }
}

async function renderPanel(onChange: ReturnType<typeof panelChange>) {
  render(<LandedCostPanel initial={{}} onChange={onChange} />)
  await screen.findByRole('option', { name: /P-1001/ })
  fireEvent.change(screen.getByLabelText(/Receipt/), { target: { value: '41' } })
  await screen.findByText('Cheap widget')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LandedCostPanel', () => {
  it('offers only the receipt lines a cost can actually be loaded onto', async () => {
    await renderPanel(panelChange())

    expect(screen.getByText('Cheap widget')).toBeTruthy()
    expect(screen.getByText('Dear widget')).toBeTruthy()
    expect(screen.queryByText('Issued widget')).toBeNull()
    expect(screen.queryByText('Unvalued widget')).toBeNull()
  })

  it('shows the per-line split and sends the same charge up', async () => {
    const onChange = panelChange()
    await renderPanel(onChange)

    fireEvent.click(screen.getByRole('button', { name: '+ Add charge' }))
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '400' } })

    // By value over lines worth 1000 and 3000: 100 and 300.
    await waitFor(() => expect((screen.getByLabelText('Freight on Cheap widget') as HTMLInputElement).value).toBe('100'))
    expect((screen.getByLabelText('Freight on Dear widget') as HTMLInputElement).value).toBe('300')

    await waitFor(() => expect(lastPayload(onChange).charges).toEqual([{ cost_type: 'freight', amount: 400, allocation_basis: 'value' }]))
    expect(lastPayload(onChange).targetId).toBe(41)
  })

  it('re-splits when the basis changes', async () => {
    await renderPanel(panelChange())

    fireEvent.click(screen.getByRole('button', { name: '+ Add charge' }))
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '400' } })
    await waitFor(() => expect((screen.getByLabelText('Freight on Cheap widget') as HTMLInputElement).value).toBe('100'))

    fireEvent.change(screen.getByLabelText('Charge 1 allocation basis'), { target: { value: 'qty' } })

    // Equal quantities take equal shares whatever the lines are worth.
    await waitFor(() => expect((screen.getByLabelText('Freight on Cheap widget') as HTMLInputElement).value).toBe('200'))
    expect((screen.getByLabelText('Freight on Dear widget') as HTMLInputElement).value).toBe('200')
  })

  /**
   * The Busy behaviour the user asked for: override a line and the charge becomes an entered-per-line
   * one. The other line keeps the share the pro-rata split had worked out, so overriding one number
   * does not silently blank the rest and send a charge that no longer adds up.
   */
  it('typing over one line switches the charge to entered-per-line and keeps the other shares', async () => {
    const onChange = panelChange()
    await renderPanel(onChange)

    fireEvent.click(screen.getByRole('button', { name: '+ Add charge' }))
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '400' } })
    await waitFor(() => expect((screen.getByLabelText('Freight on Cheap widget') as HTMLInputElement).value).toBe('100'))

    fireEvent.change(screen.getByLabelText('Freight on Cheap widget'), { target: { value: '150' } })

    await waitFor(() => expect((screen.getByLabelText('Charge 1 allocation basis') as HTMLSelectElement).value).toBe('manual'))
    expect((screen.getByLabelText('Freight on Dear widget') as HTMLInputElement).value).toBe('300')
    await waitFor(() =>
      expect(lastPayload(onChange).charges[0].lines).toEqual([
        { line_id: 11, amount: 150 },
        { line_id: 12, amount: 300 },
      ]),
    )
  })

  it('warns when part of a charge reaches no line at all', async () => {
    await renderPanel(panelChange())

    fireEvent.click(screen.getByRole('button', { name: '+ Add charge' }))
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '400' } })
    await waitFor(() => expect((screen.getByLabelText('Freight on Cheap widget') as HTMLInputElement).value).toBe('100'))

    fireEvent.change(screen.getByLabelText('Charge 1 allocation basis'), { target: { value: 'manual' } })
    fireEvent.change(screen.getByLabelText('Freight on Cheap widget'), { target: { value: '250' } })

    await waitFor(() => expect(screen.getByText(/is not spread over any line/)).toBeTruthy())
  })

  /** The limit is on the screen, not only in a docblock and a warning after posting. */
  it('says on screen that stock already issued is not re-costed', async () => {
    await renderPanel(panelChange())
    expect(screen.getByText(/Stock already issued out of this receipt is not re-costed/)).toBeTruthy()
  })

  it('reopens a saved draft with its charges', async () => {
    const onChange = panelChange()
    render(
      <LandedCostPanel
        initial={{ target_document_id: 41, charges: [{ cost_type: 'duty', amount: 200, allocation_basis: 'qty' }] }}
        onChange={onChange}
      />,
    )
    await screen.findByText('Cheap widget')

    expect((screen.getByLabelText('Charge 1 cost type') as HTMLSelectElement).value).toBe('duty')
    expect((screen.getByLabelText('Charge 1 amount') as HTMLInputElement).value).toBe('200')
    const row = screen.getByText('Cheap widget').closest('tr') as HTMLElement
    expect((within(row).getByLabelText('Customs duty on Cheap widget') as HTMLInputElement).value).toBe('100')
  })
})
