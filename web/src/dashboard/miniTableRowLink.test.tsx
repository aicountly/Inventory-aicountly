import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * One press, one history entry.
 *
 * The first cell of a MiniTable row is a real `<a href>` — that is what
 * middle-click and the status bar need — and the row around it is clickable as
 * a convenience. React Router's Link preventDefaults the click but does not
 * stop it, so without a guard the press is handled twice: the same path is
 * pushed twice and Back returns to the page the reader was already on.
 */

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  // Only the row-level handler resolves useNavigate through this module; Link
  // keeps the router's own navigation, so the spy counts the second push alone.
  return { ...actual, useNavigate: () => navigate }
})

const { MemoryRouter } = await import('react-router-dom')
const { MiniTable } = await import('./components/MiniTable')

interface Row {
  id: number
  name: string
  qty: number
}

const rows: Row[] = [{ id: 7, name: 'Widget', qty: 4 }]

function renderTable() {
  navigate.mockClear()
  return render(
    <MemoryRouter>
      <MiniTable<Row>
        columns={[
          { key: 'name', header: 'Item', render: (r) => r.name },
          { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.qty },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        to={(r) => `/registers/stock-balances?item_id=${r.id}`}
        rowLabel={(r) => `${r.name}, ${r.qty} on hand`}
      />
    </MemoryRouter>,
  )
}

describe('MiniTable row links', () => {
  it('navigates once when the link in the first cell is clicked', () => {
    renderTable()
    fireEvent.click(screen.getByRole('link', { name: 'Widget, 4 on hand' }))
    expect(navigate, 'the row handler must not push the same path again').not.toHaveBeenCalled()
  })

  it('still lets the rest of the row be clicked', () => {
    renderTable()
    fireEvent.click(screen.getByText('4'))
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/registers/stock-balances?item_id=7')
  })
})
