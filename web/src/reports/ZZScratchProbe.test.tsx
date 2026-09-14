import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReportPage } from './ReportPage'
import { defineRegister } from '../registers/RegisterConfig'
import type { ReportResponse } from '../services/reportsApi'

/*
 * Configure Columns waits for the member uuid.
 *
 * The choice is stored against `access.me.member.uuid` (registers/columnPrefs),
 * so one taken while that uuid is still unknown has nowhere to be written: it
 * shows on screen, never reaches storage, and is dropped the moment the uuid
 * lands and the per-user key changes under the reader. The window is real on
 * every first paint and again after a company switch, because AccessContext
 * re-runs GET /v1/access/me with `keepData: false`.
 */

const access = vi.hoisted(() => ({ member: null as { uuid: string } | null }))

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
  useAccess: () => ({ can: () => true, loading: false, member: access.member }),
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
  movement_id: number
  document_no: string
  value: number
}

interface Summary {
  rows: number
}

const ROWS: Row[] = [{ movement_id: 1, document_no: 'GRN-001', value: 1000 }]

const fetchSpy = vi.fn()

const register = defineRegister<Row, Summary>({
  slug: 'colwait',
  path: 'colwait',
  title: 'Column wait register',
  description: 'A register used to pin the Configure Columns guard',
  defaultSort: 'movement_id',
  filters: [],
  columns: [
    { key: 'document_no', header: 'Document', alwaysVisible: true },
    { key: 'value', header: 'Value', align: 'right', format: 'amount', amount: true },
  ],
  rowKey: (r) => r.movement_id,
  summary: () => [],
})

function response(): ReportResponse<Row, Summary> {
  return { data: ROWS, meta: { total: 1, limit: 100, offset: 0 }, summary: { rows: 1 }, report: 'colwait' }
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/registers/colwait']}>
      <Routes>
        <Route path="/registers/colwait" element={<ReportPage config={register} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function columnsButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Columns/ }) as HTMLButtonElement
}

beforeEach(() => {
  access.member = null
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(response())
  register.fetch = (args) => fetchSpy(args) as Promise<ReportResponse<Row, Summary>>
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('ZZ scratch defect probe', () => {
  it('a choice taken before the uuid lands is lost when it lands', async () => {
    const view = renderRegister()
    await screen.findByText('GRN-001')
    // Pre-uuid: force the dialog open regardless of the disabled guard by
    // driving the hook through the rendered control when it is available.
    const btn = columnsButton()
    expect(btn.disabled).toBe(false) // only valid in the REVERTED tree
    fireEvent.click(btn)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Value/ })).toBeNull()
    })
    expect(window.localStorage.getItem('inventory.reports.columns.colwait.')).toBeNull()

    // the uuid lands
    access.member = { uuid: 'user-a' }
    view.rerender(
      <MemoryRouter initialEntries={['/registers/colwait']}>
        <Routes>
          <Route path="/registers/colwait" element={<ReportPage config={register} />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Value/ })).toBeTruthy()
    })
  })
})
