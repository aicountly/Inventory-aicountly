import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ServerTablePagination, TablePagination } from './TablePagination'
import { useClientTablePagination } from './useClientTablePagination'
import { useListParams } from '../../hooks/useListParams'

/**
 * "Rows per page" has to survive the click that changes it.
 *
 * The control used to set the size and then reset the page in two separate
 * calls. On a URL-backed list those are two navigations, and react-router
 * builds the second from the query string of the render that is already stale
 * — so the second silently discarded the first, and the select snapped back to
 * the old size. Every server-paginated screen in the app shared it, which is
 * why the reset now belongs to whoever owns the state rather than to the
 * control.
 */

function ServerHarness() {
  const params = useListParams({ sort: 'name', limit: 50 })
  const location = useLocation()
  return (
    <>
      <output data-testid="url">{location.search}</output>
      <output data-testid="limit">{params.state.limit}</output>
      <output data-testid="page">{params.state.page}</output>
      <ServerTablePagination
        meta={{ total: 500, limit: params.state.limit, offset: (params.state.page - 1) * params.state.limit }}
        limit={params.state.limit}
        onPage={params.setPage}
        onLimit={params.setLimit}
      />
    </>
  )
}

const ROWS = Array.from({ length: 120 }, (_, i) => i + 1)

function ClientHarness() {
  const { pagination, page, pageSize, setPage, setPageSize, pageRows } = useClientTablePagination(ROWS, {
    initialPageSize: 25,
  })
  return (
    <>
      <output data-testid="page">{page}</output>
      <output data-testid="size">{String(pageSize)}</output>
      <output data-testid="first">{pageRows[0]}</output>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        from={pagination.from}
        to={pagination.to}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </>
  )
}

const value = (id: string) => screen.getByTestId(id).textContent

describe('changing the page size on a URL-backed list', () => {
  it('keeps the new size in the URL and returns to page 1', () => {
    render(
      <MemoryRouter initialEntries={['/list?page=7']}>
        <ServerHarness />
      </MemoryRouter>,
    )
    expect(value('page')).toBe('7')

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } })

    expect(value('limit')).toBe('100')
    expect(value('page')).toBe('1')
    expect(value('url')).toContain('limit=100')
    expect(value('url')).not.toContain('page=7')
  })

  it('drops the parameter again when the reader picks the default back', () => {
    render(
      <MemoryRouter initialEntries={['/list?limit=100']}>
        <ServerHarness />
      </MemoryRouter>,
    )
    expect(value('limit')).toBe('100')
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } })
    expect(value('limit')).toBe('50')
    expect(value('url')).not.toContain('limit')
  })

  it('still pages normally when only the page changes', () => {
    const onPage = vi.fn()
    render(
      <MemoryRouter initialEntries={['/list']}>
        <ServerTablePagination meta={{ total: 500, limit: 50, offset: 0 }} limit={50} onPage={onPage} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(onPage).toHaveBeenCalledWith(2)
  })
})

describe('changing the page size on a client-paginated table', () => {
  it('goes back to the first row rather than leaving the reader past the end', () => {
    render(<ClientHarness />)

    fireEvent.click(screen.getByLabelText('Last page'))
    expect(value('page')).toBe('5')

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } })

    expect(value('size')).toBe('100')
    expect(value('page')).toBe('1')
    expect(value('first')).toBe('1')
  })
})
