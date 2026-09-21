import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { stockBalanceRegister } from './stockRegisters'
import { cellText } from '../registerCells'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import type { ReportColumn } from '../RegisterConfig'

/**
 * The balance grid's cells.
 *
 * The screen gained a pill, a tile and a glyph; the spreadsheet and the printed
 * sheet must not have noticed. `balanceQtyColumn` overrides `render` only, and
 * the assertions on `cellText` below are what holds that line — a red pill that
 * leaked into a CSV would be a quantity no formula could add up.
 */

function row(over: Partial<StockBalanceGridRow> = {}): StockBalanceGridRow {
  return {
    balance_id: 1,
    cmp_id: 1,
    item_id: 7,
    warehouse_id: 3,
    batch_id: null,
    on_hand_qty: 10,
    reserved_qty: 0,
    committed_qty: 0,
    packed_qty: 0,
    in_transit_qty: 0,
    job_worker_qty: 0,
    quality_hold_qty: 0,
    damaged_qty: 0,
    blocked_qty: 0,
    expected_qty: 0,
    last_movement_at: null,
    item_name: 'Ballpoint Pens',
    item_sku: 'PEN-001',
    warehouse_name: 'Main',
    batch_no: null,
    available_qty: 10,
    ...over,
  }
}

const columns = stockBalanceRegister.columns as ReportColumn<StockBalanceGridRow>[]

function column(key: string): ReportColumn<StockBalanceGridRow> {
  const found = columns.find((c) => c.key === key)
  if (!found) throw new Error(`no ${key} column`)
  return found
}

function renderCell(key: string, r: StockBalanceGridRow) {
  const col = column(key)
  return render(<MemoryRouter>{col.render?.(r, 0)}</MemoryRouter>)
}

describe('the stock balance grid cells', () => {
  it('shows the item behind a tile, with its SKU under the name', () => {
    renderCell('item_name', row())
    expect(screen.getByText('Ballpoint Pens')).toBeTruthy()
    expect(screen.getByText('PEN-001')).toBeTruthy()
    // The whole cell is the way into that item's ledger.
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/registers/stock-ledger?item_id=7&warehouse_id=3',
    )
  })

  it('names the warehouse beside its glyph', () => {
    renderCell('warehouse_name', row())
    expect(screen.getByText('Main')).toBeTruthy()
  })

  it('says "(none)" rather than an empty cell for a row with no warehouse', () => {
    renderCell('warehouse_name', row({ warehouse_name: null }))
    expect(screen.getByText('(none)')).toBeTruthy()
  })

  it('leaves a positive quantity as plain text', () => {
    const { container } = renderCell('on_hand_qty', row({ on_hand_qty: 12 }))
    expect(container.textContent).toBe('12')
    expect(container.querySelector('.bg-red-50')).toBeNull()
  })

  it('puts a negative quantity in a pill that does not rely on colour', () => {
    const { container } = renderCell('on_hand_qty', row({ on_hand_qty: -1 }))
    const pill = container.querySelector('.bg-red-50')
    expect(pill, 'negative quantities get the soft-red pill').not.toBeNull()
    // Three cues, none of them colour: the sign, the title, the screen-reader
    // text. A reader who cannot see red still learns this figure is below zero.
    expect(container.textContent).toContain('-1')
    expect(pill!.getAttribute('title')).toBe('On hand is below zero')
    expect(container.querySelector('.sr-only')?.textContent).toContain('below zero')
  })

  it('flags a negative available quantity the same way', () => {
    const { container } = renderCell('available_qty', row({ available_qty: -1 }))
    expect(container.querySelector('.bg-red-50')).not.toBeNull()
  })

  it('exports the same plain number the column always exported', () => {
    // The pill is a screen treatment. What reaches a CSV, a sheet or a PDF is
    // still the figure `qtyColumn` resolved.
    expect(cellText(row({ on_hand_qty: -1 }), column('on_hand_qty'))).toBe('-1')
    expect(cellText(row({ available_qty: -1 }), column('available_qty'))).toBe('-1')
    expect(cellText(row(), column('item_name'))).toBe('Ballpoint Pens')
    expect(cellText(row(), column('warehouse_name'))).toBe('Main')
  })

  it('ticks rows by balance, not by item', () => {
    // item × warehouse × batch: one item is legitimately several rows, and
    // ticking it in Main must not also tick it in Overflow.
    const selectable = stockBalanceRegister.selectable
    expect(selectable).toBeDefined()
    expect(selectable!.idOf(row({ balance_id: 42 }))).toBe(42)
  })
})
