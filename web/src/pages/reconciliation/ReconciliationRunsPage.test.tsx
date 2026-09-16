import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    branches: [{ boId: 7, name: 'Head office' }],
    boId: 0,
    selectBranch: vi.fn(),
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
const getRun = vi.fn()
const runNow = vi.fn()

vi.mock('../../services/reconciliationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reconciliationApi')>()
  return {
    ...actual,
    reconciliationApi: {
      ...actual.reconciliationApi,
      runs: (...args: unknown[]) => runs(...args),
      get: (...args: unknown[]) => getRun(...args),
      run: (...args: unknown[]) => runNow(...args),
    },
  }
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
  getRun.mockReset()
  getRun.mockImplementation(async (id: number) => ({
    ...run(id),
    breakdown: {
      as_of: '2026-09-14',
      sign_convention: 'amount = contribution to (inventory - books)',
      explained_total: 1000,
      residual: 0,
      books: { available: true, status: 200, error: null },
      buckets: {
        pending_posting: { amount: 900, count: 2 },
        rounding: { amount: 100, count: 1 },
        unexplained: { amount: 0, count: 0 },
      },
    },
    document_status: null,
  }))
  runNow.mockReset()
  runNow.mockImplementation(async () => ({ ...run(99), breakdown: null, document_status: null }))
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
    // Collapsed, the panel still carries the one sentence that decides what the
    // figures mean; the reasoning is behind the disclosure.
    await waitFor(() => expect(screen.getByRole('button', { name: /How reconciliation works/ })).toBeTruthy())
    expect(document.body.textContent).toContain('Difference = Inventory − Books')

    fireEvent.click(screen.getByRole('button', { name: /How reconciliation works/ }))
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
    expect(lines[0]).toContain('Difference %')
    expect(lines).toHaveLength(31)
  })

  it('names the two money columns on the SCREEN, not only in the file', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Inventory value/ })).toBeTruthy())

    // Two right-aligned money columns with different owners: one is what the
    // stock cost, the other is the Books ledger balance. A reader has no other
    // way to tell them apart, and "Difference" alone does not say which way —
    // so each header carries its basis on a second line.
    const table = within(screen.getByRole('table', { name: /Reconciliation runs/ }))
    expect(table.getByRole('columnheader', { name: /Inventory value \(₹\)\s*valuation/ })).toBeTruthy()
    expect(table.getByRole('columnheader', { name: /Books stock ledger \(₹\)\s*Stock-in-Hand/ })).toBeTruthy()
    expect(table.getByRole('columnheader', { name: /Difference \(₹\)\s*Inventory − Books/ })).toBeTruthy()
    expect(table.queryByRole('columnheader', { name: /^Difference$/ })).toBeNull()
  })

  it('never says "scheduled" — there is no scheduler — and the file says what the screen says', async () => {
    runs.mockImplementation(async () => ({
      data: [{ ...run(1), requested_by: null }],
      meta: { total: 1, limit: 25, offset: 0 },
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Not recorded')).toBeTruthy())

    // The explainer directly above the table states this deployment has no
    // background job. A By column reading "scheduled" contradicts it.
    fireEvent.click(screen.getByRole('button', { name: /How reconciliation works/ }))
    expect(document.body.textContent).toContain('this deployment has no background job')
    expect(document.body.textContent).not.toMatch(/\bscheduled\b/)

    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    // The file must reproduce the screen, not drop the cell.
    expect(downloadCsv.mock.calls[0][1]).toContain('Not recorded')
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

describe('ReconciliationRunsPage — the states a reconciliation actually has', () => {
  it('says Books could not be reached instead of drawing the balance as ₹0', async () => {
    runs.mockImplementation(async () => ({
      data: [
        {
          ...run(1),
          status: 'BOOKS_UNAVAILABLE',
          books_stock_ledger_balance: null,
          difference: null,
        },
      ],
      meta: { total: 1, limit: 25, offset: 0 },
    }))
    renderPage()

    await waitFor(() => expect(screen.getAllByText(/Books data temporarily unavailable/).length).toBeGreaterThan(0))
    // ₹0 is a real balance. A run Books never answered must not borrow it.
    expect(document.body.textContent).not.toContain('₹ 0.00')
    expect(screen.getAllByRole('button', { name: /Retry/ }).length).toBeGreaterThan(0)
    // The inventory side of the same run is still reported in full.
    expect(document.body.textContent).toContain('₹ 12,50,000.00')
  })

  it('reports a real ₹0 Books balance as a balance, not as an outage', async () => {
    runs.mockImplementation(async () => ({
      data: [{ ...run(1), books_stock_ledger_balance: 0, difference: 1250000 }],
      meta: { total: 1, limit: 25, offset: 0 },
    }))
    renderPage()

    await waitFor(() => expect(screen.getByRole('table', { name: /Reconciliation runs/ })).toBeTruthy())
    expect(document.body.textContent).not.toContain('Books data temporarily unavailable')
  })

  it('posts one run for a double-click, not two', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Reconciliation/ })).toBeTruthy())
    const button = screen.getByRole('button', { name: /Run Reconciliation/ })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(runNow).toHaveBeenCalledOnce())
  })

  it('does not re-query while a filter is being typed — only on Apply', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('table', { name: /Reconciliation runs/ })).toBeTruthy())
    const calls = runs.mock.calls.length

    fireEvent.change(screen.getByLabelText(/As at from/), { target: { value: '2026-09-01' } })
    expect(runs.mock.calls.length).toBe(calls)

    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }))
    await waitFor(() => expect(runs.mock.calls.length).toBeGreaterThan(calls))
    // The table asks for the filtered page. (The headline strip asks for the
    // latest runs unfiltered, on purpose — four cards reporting March because
    // somebody filtered to March is how a KPI lies.)
    const filteredCall = runs.mock.calls
      .slice(calls)
      .find((call) => (call[0] as Record<string, unknown> | undefined)?.from === '2026-09-01')
    expect(filteredCall).toBeTruthy()
  })

  it('offers the first run rather than an empty table', async () => {
    runs.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    renderPage()

    await waitFor(() => expect(screen.getByText(/No reconciliation runs yet/)).toBeTruthy())
    expect(document.body.textContent).toContain('compare closing inventory valuation with the Books Stock-in-Hand ledger')
    expect(screen.getAllByRole('button', { name: /Run Reconciliation/ }).length).toBeGreaterThan(0)
  })
})
