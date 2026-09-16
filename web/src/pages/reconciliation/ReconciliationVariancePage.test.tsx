import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: vi.fn(() => true),
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: null,
    logo: null,
    branches: [],
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

const getRun = vi.fn()

vi.mock('../../services/reconciliationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reconciliationApi')>()
  return {
    ...actual,
    reconciliationApi: {
      ...actual.reconciliationApi,
      get: (...args: unknown[]) => getRun(...args),
      runs: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 12, offset: 0 } })),
    },
  }
})

const { ReconciliationVariancePage } = await import('./ReconciliationVariancePage')

beforeEach(() => {
  getRun.mockReset()
  getRun.mockImplementation(async (id: number) => ({
    run_id: id,
    run_uuid: null,
    cmp_id: 1,
    fy_id: 3,
    bo_id: 0,
    as_of_date: '2026-09-16',
    inventory_closing_value: 2456320,
    inventory_closing_qty: 968,
    books_stock_ledger_balance: 2445650,
    difference: 10670,
    status: 'COMPLETED',
    requested_by: 'asha',
    created_at: '2026-09-16 07:30:00',
    breakdown: {
      as_of: '2026-09-16',
      sign_convention: 'amount = contribution to (inventory - books)',
      explained_total: 10670,
      residual: 0,
      books: { available: true, status: 200, error: null },
      buckets: {
        pending_posting: {
          amount: 8670,
          count: 2,
          documents: [
            { document_id: 41, document_no: 'DN-41', document_type: 'delivery_note', document_date: '2026-09-15' },
          ],
        },
        failed_posting: { amount: 2000, count: 1 },
        revaluation: { amount: 0, count: 0 },
      },
    },
    document_status: null,
  }))
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/reconciliation/variance?run=87']}>
      <ReconciliationVariancePage />
    </MemoryRouter>,
  )
}

describe('ReconciliationVariancePage', () => {
  it('explains the gap by bucket, largest first, and opens onto the documents behind one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Run #87/)).toBeTruthy())

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('Pending posting')
    expect(rows[0].textContent).toContain('8,670.00')
    expect(rows[1].textContent).toContain('Failed posting')
    // A bucket that contributed nothing and counted nothing is not a row.
    expect(document.body.textContent).not.toContain('Revaluation')

    fireEvent.click(screen.getByRole('button', { name: /Pending posting/ }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'DN-41' })).toBeTruthy())
  })

  it('says why there is no per-item Books figure instead of inventing one', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Run #87/)).toBeTruthy())
    expect(document.body.textContent).toContain('not one per item')
    // No column claims to hold a Books value for an item.
    expect(screen.queryByRole('columnheader', { name: /Books value/i })).toBeNull()
  })
})
