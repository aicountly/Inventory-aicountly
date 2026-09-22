import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReportPage } from './ReportPage'
import { defineRegister } from '../registers/RegisterConfig'
import type { ReportResponse } from '../services/reportsApi'

/*
 * A register IS its grid, and how much room the grid gets is not cosmetic.
 *
 * Two things used to take it away. The page was capped at `max-w-screen-2xl`, so a register
 * declaring a 1600px grid scrolled sideways from the first paint on a 1920 monitor with a
 * third of the screen empty either side. And `minWidth` is declared for a register's FULL
 * column set, so a reader who hid half the columns still got a grid forced to the full width
 * — a horizontal scrollbar for columns that are not on screen.
 */

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '',
    logo: null,
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [],
    units: [],
    defaultWarehouseId: null,
    warehouseName: () => '',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: () => {} }),
}))

vi.mock('../registers/useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({ options: [], loading: false }),
}))

interface Row {
  id: number
  name: string
  a: number
  b: number
  c: number
}

interface Summary {
  rows: number
}

const ROWS: Row[] = [{ id: 1, name: 'Widget', a: 1, b: 2, c: 3 }]
const fetchSpy = vi.fn()

/** Four columns, 1600px declared for all four — 400px of grid per column. */
const register = defineRegister<Row, Summary>({
  slug: 'widegrid',
  path: 'widegrid',
  title: 'Wide grid register',
  description: 'A register used to pin how much room the grid gets',
  defaultSort: 'name',
  minWidth: 1600,
  filters: [],
  columns: [
    { key: 'name', header: 'Name', alwaysVisible: true },
    { key: 'a', header: 'A', align: 'right' },
    { key: 'b', header: 'B', align: 'right' },
    { key: 'c', header: 'C', align: 'right' },
  ],
  rowKey: (r) => r.id,
  summary: () => [],
})

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/registers/widegrid']}>
      <Routes>
        <Route path="/registers/widegrid" element={<ReportPage config={register} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function grid(): HTMLElement {
  return screen.getByRole('table')
}

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue({
    data: ROWS,
    meta: { total: 1, limit: 100, offset: 0 },
    summary: { rows: 1 },
    report: 'widegrid',
  } satisfies ReportResponse<Row, Summary>)
  register.fetch = (args) => fetchSpy(args) as Promise<ReportResponse<Row, Summary>>
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('how much room a register grid gets', () => {
  it('uses the width the app frame gives it rather than a 1536px column', async () => {
    const { container } = renderRegister()
    await screen.findByText('Widget')

    const shell = container.querySelector('.aic')
    expect(shell).not.toBeNull()
    expect(shell?.className).not.toContain('max-w-screen-2xl')
  })

  it('asks for the declared width while every column is on screen', async () => {
    renderRegister()
    await screen.findByText('Widget')

    expect(grid().style.minWidth).toBe('1600px')
  })

  it('shrinks the grid when the reader hides a column, instead of scrolling for one that is gone', async () => {
    renderRegister()
    await screen.findByText('Widget')

    fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(grid().style.minWidth).toBe('1200px')
    })
  })
})
