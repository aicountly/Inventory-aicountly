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

  it('opens onto why the unexplained residual exists and what to do about it', async () => {
    getRun.mockImplementation(async (id: number) => ({
      run_id: id,
      run_uuid: null,
      cmp_id: 1,
      fy_id: 3,
      bo_id: 0,
      as_of_date: '2026-09-16',
      inventory_closing_value: 2456320,
      inventory_closing_qty: 968,
      books_stock_ledger_balance: 179549.11,
      difference: -2275554.89,
      status: 'COMPLETED',
      requested_by: 'asha',
      created_at: '2026-09-16 07:30:00',
      breakdown: {
        as_of: '2026-09-16',
        sign_convention: 'amount = contribution to (inventory - books)',
        explained_total: 0,
        residual: -2275554.89,
        books: { available: true, status: 200, error: null },
        buckets: {
          opening_difference: { amount: 0, count: 0 },
          unexplained: { amount: -2275554.89, count: 1 },
        },
        diagnostics: {
          valuation_method_variance: { amount: -2275000, count: 1, unvalued_movements: 15 },
        },
      },
      document_status: null,
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Run #87/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Unexplained/ }))
    await waitFor(() => expect(screen.getByText(/mathematically guaranteed to agree/)).toBeTruthy())
    expect(document.body.textContent).toContain('across 15 movements costed with no real rate on record')
    expect(screen.getByRole('link', { name: /Review negative & zero-cost layers/ })).toBeTruthy()
  })

  /**
   * Production shape: Orobite opens at 66,18,992.75 in Books and 90,87,528.50 in Inventory. The
   * net 24,68,535.75 alone does not say which side is short, and the obvious next thought —
   * "sync them" — has no button, which reads as a missing feature until the row says why.
   */
  it('shows both openings, which way the gap leans, and why it cannot be synced', async () => {
    getRun.mockImplementation(async (id: number) => ({
      run_id: id,
      run_uuid: null,
      cmp_id: 1,
      fy_id: 3,
      bo_id: 0,
      as_of_date: '2026-09-23',
      inventory_closing_value: 3949461.64,
      inventory_closing_qty: 461228.66,
      books_stock_ledger_balance: 2141860.48,
      difference: 1807601.16,
      status: 'COMPLETED',
      requested_by: 'cli:inventory-reconcile',
      created_at: '2026-09-23 08:35:00',
      breakdown: {
        as_of: '2026-09-23',
        sign_convention: 'amount = contribution to (inventory - books)',
        explained_total: 2477517.04,
        residual: -669915.88,
        books: { available: true, status: 200, error: null },
        buckets: {
          opening_difference: {
            amount: 2468535.75,
            count: 1,
            inventory_opening_value: 9087528.5,
            books_opening_balance: 6618992.75,
            books_reported: true,
          },
        },
        diagnostics: {},
      },
      document_status: null,
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Run #87/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Opening difference/i }))

    await waitFor(() => expect(screen.getByText(/Why this cannot be synced across/)).toBeTruthy())
    // Both sides named, not just the net.
    expect(document.body.textContent).toContain('66,18,992.75')
    expect(document.body.textContent).toContain('90,87,528.50')
    expect(document.body.textContent).toContain('Inventory holds more')
    expect(document.body.textContent).toContain('one amount on the Stock-in-Hand ledger')
    // And an action for each way the truth could lie.
    expect(document.body.textContent).toContain('If Inventory is right')
    expect(document.body.textContent).toContain('If Books is right')
    expect(screen.getByRole('link', { name: /Open the Opening Stock report/ })).toBeTruthy()
  })

  /** Books unreachable is not "Books opens at nil" — there is nothing to compare. */
  it('does not present a comparison when Books never answered', async () => {
    getRun.mockImplementation(async (id: number) => ({
      run_id: id,
      run_uuid: null,
      cmp_id: 1,
      fy_id: 3,
      bo_id: 0,
      as_of_date: '2026-09-23',
      inventory_closing_value: 3949461.64,
      inventory_closing_qty: 461228.66,
      books_stock_ledger_balance: null,
      difference: null,
      status: 'BOOKS_UNAVAILABLE',
      requested_by: 'asha',
      created_at: '2026-09-23 08:35:00',
      breakdown: {
        as_of: '2026-09-23',
        sign_convention: 'amount = contribution to (inventory - books)',
        explained_total: 0,
        residual: null,
        books: { available: false, status: 0, error: 'unreachable' },
        buckets: {
          opening_difference: {
            amount: 0,
            count: 1,
            inventory_opening_value: 9087528.5,
            books_opening_balance: null,
            books_reported: false,
          },
        },
        diagnostics: {},
      },
      document_status: null,
    }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/Run #87/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Opening difference/i }))

    await waitFor(() => expect(screen.getByText(/Books did not answer on this run/)).toBeTruthy())
    expect(screen.queryByText(/Why this cannot be synced across/)).toBeNull()
  })
})
