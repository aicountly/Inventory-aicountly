import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LineItemPicker } from './LineItemPicker'

/*
 * A line editor lives inside a box that scrolls sideways, and anything
 * positioned inside that box is clipped by it — the suggestion list opened to a
 * couple of pixels under a one-row grid and the item could not be picked at
 * all. The list is portalled for that reason, so this test holds the portal
 * rather than the markup: it asserts the list is NOT inside the scrolling
 * wrapper, which is the only property that makes the control usable.
 */

vi.mock('../services/lookupApi', () => ({
  lookupApi: {
    searchItems: async () => [
      { item_id: 90, item_name: 'Gear Housing', item_alias: null, print_name: 'Gear Housing', item_sku: 'FG-001', item_upc: null, hsn_sac: null, mrp: null, unit_id: 3, unit_symbol: 'Pcs', track_batch: 1, track_serial: 0, valuation_method: null, default_warehouse_id: 2, stock: { on_hand: 300, available: 240, reserved: 60 }, units: [] },
    ],
  },
}))

function renderInsideAScrollBox() {
  return render(
    <div data-testid="scroller" style={{ overflowX: 'auto', position: 'relative' }}>
      <LineItemPicker itemId={null} itemName="" itemSku={null} warehouseId={2} onPick={vi.fn()} onClear={vi.fn()} />
    </div>,
  )
}

describe('the item typeahead', () => {
  it('opens its list outside the box that would clip it', async () => {
    const { getByTestId } = renderInsideAScrollBox()
    fireEvent.focus(screen.getByRole('combobox'))

    const list = await screen.findByRole('listbox')
    expect(getByTestId('scroller').contains(list)).toBe(false)
    expect(document.body.contains(list)).toBe(true)
    expect(getComputedStyle(list).position).toBe('fixed')
  })

  it('shows what is on hand where the line will post', async () => {
    renderInsideAScrollBox()
    fireEvent.focus(screen.getByRole('combobox'))

    expect(await screen.findByText('Gear Housing')).toBeTruthy()
    expect(screen.getByText(/avail 240 \/ on hand 300/)).toBeTruthy()
  })

  it('picks the highlighted row on Enter', async () => {
    const onPick = vi.fn()
    render(<LineItemPicker itemId={null} itemName="" itemSku={null} warehouseId={2} onPick={onPick} onClear={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    await screen.findByRole('listbox')
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ item_id: 90 })))
  })

  it('closes on Escape without picking anything', async () => {
    const onPick = vi.fn()
    render(<LineItemPicker itemId={null} itemName="" itemSku={null} warehouseId={2} onPick={onPick} onClear={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    await screen.findByRole('listbox')
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(onPick).not.toHaveBeenCalled()
  })
})
