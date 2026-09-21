import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RegisterFilterPanel } from './RegisterFilterPanel'
import type { ReportFilter } from '../reports/types'

/*
 * The panel's arrangement, pinned.
 *
 * A checkbox is not a field. When toggles sat in the field grid they took a
 * quarter of the panel's width each and pushed the real filters onto a second
 * row — which is how the stock balance register ended up with "Group by"
 * stranded on a line of its own above the table while "Below zero only" held a
 * cell the size of a dropdown. These tests are here so that does not come back.
 */

vi.mock('../services/lookupApi', () => ({
  lookupApi: {
    items: vi.fn(async () => []),
    batches: vi.fn(async () => []),
  },
}))

vi.mock('../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main store' }],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main store',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: () => {} }),
}))

vi.mock('./useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({ options: [], loading: false }),
}))

const FILTERS: ReportFilter[] = [
  { key: 'warehouse_id', kind: 'warehouse', label: 'Warehouse' },
  { key: 'nonzero', kind: 'toggle', label: 'Hide zero balances', defaultOn: true },
  { key: 'negative', kind: 'toggle', label: 'Below zero only', defaultOn: false },
]

const CTX = { fyFrom: '2026-04-01', fyTo: '2027-03-31', today: '2026-09-19' }

function renderPanel(over: Partial<Parameters<typeof RegisterFilterPanel>[0]> = {}) {
  return render(
    <RegisterFilterPanel
      spec={{ description: 'Refine your view of stock balances' }}
      filters={FILTERS}
      values={{ nonzero: '1', negative: '0' }}
      onChange={vi.fn()}
      onReset={vi.fn()}
      onApply={vi.fn()}
      activeCount={0}
      ctx={CTX}
      {...over}
    />,
  )
}

describe('the register filter panel', () => {
  it('keeps toggles out of the field grid', () => {
    const { container } = renderPanel()
    const grid = container.querySelector<HTMLElement>('.grid')
    expect(grid, 'the panel renders a field grid').not.toBeNull()

    // The warehouse select belongs in the grid; the two checkboxes do not.
    expect(grid!.querySelectorAll('select').length).toBe(1)
    expect(grid!.querySelectorAll('input[type="checkbox"]').length).toBe(0)

    expect(screen.getByLabelText('Hide zero balances')).toBeTruthy()
    expect(screen.getByLabelText('Below zero only')).toBeTruthy()
  })

  it('gives the trailing control a cell in that grid', () => {
    const { container } = renderPanel({
      trailing: (
        <label>
          Group by
          <select aria-label="Group by">
            <option>No grouping</option>
          </select>
        </label>
      ),
    })
    const grid = container.querySelector<HTMLElement>('.grid')!
    // Warehouse and Group by — the grouping control sits with the filters
    // rather than on a row of its own above the table.
    expect(grid.querySelectorAll('select').length).toBe(2)
    expect(within(grid).getByLabelText('Group by')).toBeTruthy()
  })

  it('renders Clear all and Apply filters on the toggles row', () => {
    renderPanel()
    const clear = screen.getByRole('button', { name: 'Clear all' })
    const apply = screen.getByRole('button', { name: 'Apply filters' })
    const row = clear.closest('div')!.parentElement!
    expect(row.contains(apply)).toBe(true)
    expect(row.querySelectorAll('input[type="checkbox"]').length).toBe(2)
  })

  it('still renders the actions when a register declares no toggles', () => {
    renderPanel({ filters: [FILTERS[0]] })
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeTruthy()
  })

  it('disables Clear all when there is nothing set to clear', () => {
    renderPanel({ activeCount: 0 })
    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveProperty('disabled', true)
  })
})
