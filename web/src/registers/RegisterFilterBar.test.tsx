import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('../services/lookupApi', () => ({
  lookupApi: {
    batches: async () => ({
      data: [
        { batch_id: 7, item_id: 12, batch_no: 'B-102', lot_no: null, mfg_date: null, expiry_date: '2026-12-31', status: 'active' },
      ],
      meta: { total: 1, limit: 200, offset: 0 },
    }),
  },
}))

vi.mock('../components/ItemFilter', () => ({
  ItemFilter: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Item" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const ctx = { today: '2026-09-14', fyFrom: '2026-04-01', fyTo: '2027-03-31' }

const itemFilterSpec: ReportFilter = { key: 'item_id', kind: 'item', label: 'Item' }

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
    expect(screen.getByLabelText('Search')).toHaveProperty('value', 'bolt')
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

  it('searches after the user pauses, not once per keystroke', async () => {
    // Each call here is a URL write, a navigation and a fetch, with the value
    // fed back asynchronously — typing four characters used to cost four.
    vi.useFakeTimers()
    try {
      const { onChange } = renderBar([{ key: 'q', kind: 'text', label: 'Search' }])
      const box = screen.getByLabelText('Search')
      for (const value of ['b', 'bo', 'bol', 'bolt']) {
        fireEvent.change(box, { target: { value } })
      }
      expect(onChange).not.toHaveBeenCalled()
      // The caret must also survive: the box shows what was typed straight away.
      expect(box).toHaveProperty('value', 'bolt')
      await act(async () => {
        vi.advanceTimersByTime(350)
      })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('q', 'bolt')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a text filter from its own × button', async () => {
    vi.useFakeTimers()
    try {
      const { onChange } = renderBar([{ key: 'q', kind: 'text', label: 'Search' }], { q: 'bolt' })
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      await act(async () => {
        vi.advanceTimersByTime(350)
      })
      expect(onChange).toHaveBeenCalledWith('q', '')
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the / shortcut hint on the search box', () => {
    renderBar([{ key: 'q', kind: 'text', label: 'Search' }])
    expect(screen.getByText('/')).toBeTruthy()
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

  it('offers the item\u2019s batches once an item is chosen', async () => {
    // Every batch-bearing endpoint has read batch_id all along; the bar simply
    // had no control that could send one.
    const { onChange } = renderBar(
      [itemFilterSpec, { key: 'batch_id', kind: 'batch', label: 'Batch' }],
      { item_id: '12' },
    )
    const select = screen.getByLabelText('Batch') as HTMLSelectElement
    expect(select.disabled).toBe(false)
    await waitFor(() => expect(select.options).toHaveLength(2))
    expect(select.options[1].value).toBe('7')
    expect(select.options[1].text).toContain('B-102')

    fireEvent.change(select, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith('batch_id', '7')
  })

  it('stays inert until there is an item, because a batch belongs to one', () => {
    renderBar([itemFilterSpec, { key: 'batch_id', kind: 'batch', label: 'Batch' }])
    const select = screen.getByLabelText('Batch') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.options[0].text).toBe('Pick an item first')
  })

  it('drops a batch left over from a cleared item', async () => {
    // Otherwise the register filters to nothing while the control says "All".
    const { onChange } = renderBar(
      [itemFilterSpec, { key: 'batch_id', kind: 'batch', label: 'Batch' }],
      { batch_id: '7' },
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('batch_id', ''))
  })

  it('renders the trailing slot for exports and counts', () => {
    renderBar([], {}, { trailing: <span>412 movements</span> })
    expect(screen.getByText('412 movements')).toBeTruthy()
  })
})
