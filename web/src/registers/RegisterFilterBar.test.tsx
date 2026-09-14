import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RegisterFilterBar } from './RegisterFilterBar'
import type { ReportFilter } from '../reports/types'

// The bar's data hooks talk to the API through CompanyContext; the bar's own
// behaviour is what is under test, so they are stubbed.
vi.mock('../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main store', warehouse_code: 'MS' }],
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
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 5, grp_name: 'Raw materials' }],
      stock_categories: [{ stock_cat_id: 9, cat_name: 'Consumables' }],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('./useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({
    options: [{ value: 'GRN', label: 'Goods receipt' }],
    loading: false,
  }),
}))

vi.mock('../components/ItemFilter', () => ({
  ItemFilter: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Item" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const ctx = { today: '2026-09-14', fyFrom: '2026-04-01', fyTo: '2027-03-31' }

function renderBar(
  filters: ReportFilter[],
  values: Record<string, string> = {},
  overrides: Partial<Parameters<typeof RegisterFilterBar>[0]> = {},
) {
  const onChange = vi.fn()
  const onChangeMany = vi.fn()
  render(
    <MemoryRouter>
      <RegisterFilterBar
        filters={filters}
        values={values}
        onChange={onChange}
        onChangeMany={onChangeMany}
        ctx={ctx}
        {...overrides}
      />
    </MemoryRouter>,
  )
  return { onChange, onChangeMany }
}

describe('RegisterFilterBar', () => {
  it('writes both ends of a period in ONE update', () => {
    // react-router's setSearchParams navigates from the render-closure query
    // string, so two separate writes would drop the first. A preset pick must
    // go through onChangeMany or the "from" date silently disappears.
    const { onChange, onChangeMany } = renderBar(
      [{ key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' }],
      { from: '2026-04-01', to: '2027-03-31' },
    )
    fireEvent.change(screen.getByLabelText('Period preset'), { target: { value: 'this_month' } })
    expect(onChangeMany).toHaveBeenCalledTimes(1)
    expect(onChangeMany).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('falls back to two writes only when no batched setter is supplied', () => {
    const onChange = vi.fn()
    render(
      <MemoryRouter>
        <RegisterFilterBar
          filters={[{ key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' }]}
          values={{ from: '2026-04-01', to: '2027-03-31' }}
          onChange={onChange}
          ctx={ctx}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Period preset'), { target: { value: 'today' } })
    expect(onChange).toHaveBeenNthCalledWith(1, 'from', '2026-09-14')
    expect(onChange).toHaveBeenNthCalledWith(2, 'to', '2026-09-14')
  })

  it('does not render a hidden filter, but leaves its value alone', () => {
    renderBar(
      [
        { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' },
        { key: 'to', kind: 'date', label: 'To', hidden: true },
      ],
      { from: '2026-04-01', to: '2026-09-14' },
    )
    // One control owns both dates; the declared companion must not appear twice.
    expect(screen.getAllByLabelText(/Period (from|to)/)).toHaveLength(2)
    expect(screen.queryByLabelText('To')).toBeNull()
  })

  it('renders each filter kind and reports its own key', () => {
    const { onChange } = renderBar([
      { key: 'warehouse_id', kind: 'warehouse', label: 'Warehouse' },
      { key: 'item_grp_id', kind: 'item_group', label: 'Item group' },
      { key: 'document_type', kind: 'document_type', label: 'Type' },
      { key: 'nonzero', kind: 'toggle', label: 'Hide zero rows', defaultOn: true },
      { key: 'q', kind: 'text', label: 'Search' },
    ])

    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith('warehouse_id', '3')

    fireEvent.change(screen.getByLabelText('Item group'), { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith('item_grp_id', '5')

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'GRN' } })
    expect(onChange).toHaveBeenCalledWith('document_type', 'GRN')

    fireEvent.click(screen.getByRole('checkbox', { name: /Hide zero rows/ }))
    expect(onChange).toHaveBeenCalledWith('nonzero', '1')

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bolt' } })
    expect(onChange).toHaveBeenCalledWith('q', 'bolt')
  })

  it('gives a select with no blank option an explicit "all" row', () => {
    renderBar([
      {
        key: 'direction',
        kind: 'select',
        label: 'Direction',
        placeholder: 'In and out',
        options: [
          { value: 'in', label: 'In' },
          { value: 'out', label: 'Out' },
        ],
      },
    ])
    const select = screen.getByLabelText('Direction') as HTMLSelectElement
    // Without it the first option becomes a filter nobody chose.
    expect(select.options[0].value).toBe('')
    expect(select.options[0].text).toBe('In and out')
  })

  it('clears a text filter from its own × button', () => {
    const { onChange } = renderBar([{ key: 'q', kind: 'text', label: 'Search' }], { q: 'bolt' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }))
    expect(onChange).toHaveBeenCalledWith('q', '')
  })

  it('offers Reset only when something is filtered', () => {
    const onReset = vi.fn()
    const filters: ReportFilter[] = [{ key: 'q', kind: 'text', label: 'Search' }]
    const { rerender } = render(
      <MemoryRouter>
        <RegisterFilterBar filters={filters} values={{}} onChange={vi.fn()} ctx={ctx} onReset={onReset} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()

    rerender(
      <MemoryRouter>
        <RegisterFilterBar
          filters={filters}
          values={{ q: 'bolt' }}
          onChange={vi.fn()}
          ctx={ctx}
          onReset={onReset}
          showReset
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalled()
  })

  it('renders the trailing slot for exports and counts', () => {
    renderBar([], {}, { trailing: <span>412 movements</span> })
    expect(screen.getByText('412 movements')).toBeTruthy()
  })
})
