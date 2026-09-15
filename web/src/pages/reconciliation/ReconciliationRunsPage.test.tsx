import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReconciliationRun } from '../../services/reconciliationApi'

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  footerNotes?: string[]
}

const printTabular = vi.fn((_p: SheetPayload) => true)
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: (p: SheetPayload) => printTabular(p),
}))

vi.mock('../../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/csv')>()
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv) }
})

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const runs = vi.fn()

vi.mock('../../services/reconciliationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reconciliationApi')>()
  return { ...actual, reconciliationApi: { ...actual.reconciliationApi, runs: (...args: unknown[]) => runs(...args) } }
})

const { ReconciliationRunsPage } = await import('./ReconciliationRunsPage')

function run(id: number): ReconciliationRun {
  return {
    run_id: id,
    run_uuid: null,
    cmp_id: 1,
    fy_id: 3,
    bo_id: 0,
    as_of_date: '2026-09-14',
    inventory_closing_value: 1250000,
    inventory_closing_qty: 4820,
    books_stock_ledger_balance: 1249000,
    difference: 1000,
    status: 'COMPLETED',
    requested_by: 'asha',
    created_at: '2026-09-14 18:30:00',
  }
}

const ALL = Array.from({ length: 30 }, (_, i) => run(i + 1))

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  runs.mockReset()
  runs.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 50)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/reconciliation?limit=25']}>
      <ReconciliationRunsPage />
    </MemoryRouter>,
  )
}

describe('ReconciliationRunsPage', () => {
  it('says on the screen what a run compares and what its difference means', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/What a run compares/)).toBeTruthy())
    const text = document.body.textContent ?? ''
    expect(text).toContain('Stock-in-Hand balance in the Books ledger')
    expect(text).toContain('difference is Inventory minus Books')
    expect(text).toContain('posting is not one transaction')
  })

  it('exports every run and states the direction of the difference on paper', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const lines = downloadCsv.mock.calls[0][1].trim().split('\r\n')
    expect(lines[0]).toContain('Inventory closing value (valuation)')
    expect(lines[0]).toContain('Books stock ledger balance')
    expect(lines[0]).toContain('Difference (Inventory − Books)')
    expect(lines).toHaveLength(31)
  })

  it('prints the letterheaded sheet with the sign convention in its footer', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.rows).toHaveLength(30)
    expect(sheet.footerNotes?.join(' ')).toContain(
      'Difference = Inventory closing value − Books stock ledger balance',
    )
  })
})
