import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { SmartTable } from './SmartTable'
import type { SmartColumn } from './SmartTable'

interface Row {
  id: number
  code: string
  qty: number
  note?: string | null
}

const rows: Row[] = [
  { id: 1, code: 'ITEM-1', qty: 10 },
  { id: 2, code: 'ITEM-2', qty: 20, note: 'kept' },
  { id: 3, code: 'ITEM-3', qty: 30 },
]

const columns: SmartColumn<Row>[] = [
  { key: 'code', header: 'Code', sortKey: 'code' },
  { key: 'qty', header: 'Qty', align: 'right', sortKey: 'qty' },
  { key: 'note', header: 'Note' },
]

function renderTable(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('SmartTable grouping', () => {
  const grouped: Row[] = [
    { id: 1, code: 'ITEM-1', qty: 10, note: 'A' },
    { id: 2, code: 'ITEM-2', qty: 20, note: 'A' },
    { id: 3, code: 'ITEM-3', qty: 30, note: 'B' },
  ]
  const byNote = (r: Row) => ({ key: r.note ?? '', label: `Note ${r.note}` })

  it('puts a heading over each group and a subtotal under it', () => {
    renderTable(
      <SmartTable
        columns={columns}
        rows={grouped}
        rowKey="id"
        rowGroup={byNote}
        groupSubtotal={(rs, g) => ({ code: `${g.label} subtotal`, qty: rs.reduce((a, r) => a + r.qty, 0) })}
      />,
    )
    expect(screen.getByText('Note A')).toBeTruthy()
    expect(screen.getByText('Note B')).toBeTruthy()
    const subtotal = screen.getByText('Note A subtotal').closest('tr') as HTMLElement
    // 10 + 20 for the first group.
    expect(within(subtotal).getByText('30')).toBeTruthy()
    // 3 data rows + 2 headings + 2 subtotals + the header row.
    expect(screen.getAllByRole('row')).toHaveLength(8)
  })

  it('renders headings without subtotals when the register asks for none', () => {
    renderTable(<SmartTable columns={columns} rows={grouped} rowKey="id" rowGroup={byNote} />)
    expect(screen.getByText('Note A')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(6)
  })

  it('leaves the table exactly as it was when nothing is grouped', () => {
    renderTable(<SmartTable columns={columns} rows={grouped} rowKey="id" />)
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByText('Note A')).toBeNull()
  })
})

describe('SmartTable', () => {
  it('renders a header and a row per record', () => {
    renderTable(<SmartTable columns={columns} rows={rows} rowKey="id" />)
    expect(screen.getByText('Code')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1)
    expect(screen.getByText('ITEM-2')).toBeTruthy()
  })

  it('renders an em dash for a missing value rather than an empty cell', () => {
    renderTable(<SmartTable columns={columns} rows={rows} rowKey="id" />)
    // Two of the three rows have no note.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows a skeleton while loading with no rows yet', () => {
    const { container } = renderTable(
      <SmartTable columns={columns} rows={[]} rowKey="id" loading />,
    )
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('keeps the rows visible while reloading', () => {
    renderTable(<SmartTable columns={columns} rows={rows} rowKey="id" loading />)
    expect(screen.getByText('ITEM-1')).toBeTruthy()
  })

  it('renders the empty state when there is nothing to show', () => {
    renderTable(<SmartTable columns={columns} rows={[]} rowKey="id" />)
    expect(screen.getByText('No rows')).toBeTruthy()
  })

  it('renders an error with a retry the caller can handle', () => {
    const onRetry = vi.fn()
    renderTable(
      <SmartTable
        columns={columns}
        rows={[]}
        rowKey="id"
        error={{ title: 'Could not load', description: 'The server said no.', onRetry }}
      />,
    )
    expect(screen.getByText('Could not load')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows an Error instance message', () => {
    renderTable(
      <SmartTable columns={columns} rows={[]} rowKey="id" error={new Error('Network down')} />,
    )
    expect(screen.getByText('Network down')).toBeTruthy()
  })

  describe('sorting', () => {
    it('makes only columns with a sortKey clickable, and reports the key', () => {
      const onSort = vi.fn()
      renderTable(
        <SmartTable
          columns={columns}
          rows={rows}
          rowKey="id"
          sort={{ key: 'code', order: 'asc' }}
          onSort={onSort}
        />,
      )
      const headers = screen.getAllByRole('columnheader')
      expect(within(headers[2]).queryByRole('button')).toBeNull()
      fireEvent.click(within(headers[1]).getByRole('button'))
      expect(onSort).toHaveBeenCalledWith('qty')
    })

    it('marks the active column with aria-sort in the current direction', () => {
      const { rerender } = renderTable(
        <SmartTable
          columns={columns}
          rows={rows}
          rowKey="id"
          sort={{ key: 'code', order: 'asc' }}
          onSort={() => {}}
        />,
      )
      expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('ascending')
      rerender(
        <MemoryRouter>
          <SmartTable
            columns={columns}
            rows={rows}
            rowKey="id"
            sort={{ key: 'code', order: 'desc' }}
            onSort={() => {}}
          />
        </MemoryRouter>,
      )
      expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('descending')
    })

    it('renders plain headers when no onSort is supplied', () => {
      renderTable(<SmartTable columns={columns} rows={rows} rowKey="id" />)
      expect(screen.queryAllByRole('columnheader').every((h) => !within(h).queryByRole('button'))).toBe(
        true,
      )
    })
  })

  describe('row activation', () => {
    it('opens a row on Enter', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable columns={columns} rows={rows} rowKey="id" onRowActivate={onRowActivate} />,
      )
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onRowActivate).toHaveBeenCalledWith(rows[0], 0)
    })

    it('walks the rows with the arrow keys', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable columns={columns} rows={rows} rowKey="id" onRowActivate={onRowActivate} />,
      )
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      fireEvent.keyDown(window, { key: 'ArrowDown' })
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onRowActivate).toHaveBeenCalledWith(rows[2], 2)
    })

    it('does not open a row that is not activatable', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowActivate={onRowActivate}
          isRowActivatable={(row) => row.id !== 1}
        />,
      )
      // Focus starts on the first activatable row, which is the second record.
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(onRowActivate).toHaveBeenCalledWith(rows[1], 1)
    })

    it('leaves a single click as selection unless the caller opts in', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable columns={columns} rows={rows} rowKey="id" onRowActivate={onRowActivate} />,
      )
      fireEvent.click(screen.getByText('ITEM-2'))
      expect(onRowActivate).not.toHaveBeenCalled()
    })

    it('opens on a single click when activateOnSingleClick is set', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowActivate={onRowActivate}
          activateOnSingleClick
        />,
      )
      fireEvent.click(screen.getByText('ITEM-2'))
      expect(onRowActivate).toHaveBeenCalledWith(rows[1], 1)
    })

    it('opens on a double click', () => {
      const onRowActivate = vi.fn()
      renderTable(
        <SmartTable columns={columns} rows={rows} rowKey="id" onRowActivate={onRowActivate} />,
      )
      fireEvent.doubleClick(screen.getByText('ITEM-3'))
      expect(onRowActivate).toHaveBeenCalledWith(rows[2], 2)
    })

    it('fires the quick action on F12', () => {
      const onRowQuickAction = vi.fn()
      renderTable(
        <SmartTable
          columns={columns}
          rows={rows}
          rowKey="id"
          onRowActivate={() => {}}
          onRowQuickAction={onRowQuickAction}
        />,
      )
      fireEvent.keyDown(window, { key: 'F12' })
      expect(onRowQuickAction).toHaveBeenCalledWith(rows[0], 0)
    })
  })

  it('pins a totals row that lines up with the columns', () => {
    renderTable(
      <SmartTable
        columns={columns}
        rows={rows}
        rowKey="id"
        totals={{ code: 'Total (3 rows)', qty: '60' }}
      />,
    )
    const foot = screen.getByText('Total (3 rows)').closest('tr')
    expect(foot).toBeTruthy()
    expect(within(foot as HTMLElement).getAllByRole('cell')).toHaveLength(columns.length)
    expect(screen.getByText('60')).toBeTruthy()
  })

  it('renders raw tfoot rows when no totals map is given', () => {
    renderTable(
      <SmartTable
        columns={columns}
        rows={rows}
        rowKey="id"
        tfoot={
          <tr>
            <td colSpan={3}>Legacy footer</td>
          </tr>
        }
      />,
    )
    expect(screen.getByText('Legacy footer')).toBeTruthy()
  })

  it('uses render, then accessor, then the raw field', () => {
    renderTable(
      <SmartTable
        columns={[
          { key: 'a', header: 'A', render: () => 'rendered' },
          { key: 'b', header: 'B', accessor: (row) => `#${row.id}` },
          { key: 'code', header: 'C' },
        ]}
        rows={[rows[0]]}
        rowKey="id"
      />,
    )
    expect(screen.getByText('rendered')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('ITEM-1')).toBeTruthy()
  })
})
