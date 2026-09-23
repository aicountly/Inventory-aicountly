import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReconciliationAlert } from './ReconciliationAlert'

/*
 * The banner's whole job is to be trusted, which means two things: it must never cost a
 * reconciliation to paint (it reads the last stored verdict), and its loudness must follow who
 * owns the figure. Under "Inventory Real Data" a difference is a defect and cannot be waved away;
 * under "Manual Stock-in-Hand" it is a figure somebody chose, and a banner that nagged on every
 * page load would train people to ignore the one that matters.
 */

const api = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('../services/reconciliationApi', () => ({ reconciliationApi: api }))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 2, bo_id: 0 } }),
}))

const access = vi.hoisted(() => ({ allowed: true }))
vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => access.allowed }),
  useCan: () => access.allowed,
}))

const base = {
  has_run: true,
  as_of_date: '2026-08-31',
  ran_at: '2026-09-22 09:00:00',
  status: 'COMPLETED',
  difference: -2270000,
  stock_source: 'manual' as const,
}

function renderAlert() {
  return render(
    <MemoryRouter>
      <ReconciliationAlert />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  access.allowed = true
  api.status.mockReset()
})

describe('the company-load reconciliation banner', () => {
  it('reads the stored verdict and never reconciles to paint', async () => {
    api.status.mockResolvedValue(base)
    renderAlert()
    await screen.findByText(/stock ledger/)
    expect(api.status).toHaveBeenCalledTimes(1)
  })

  it('says nothing at all when the two systems agree', async () => {
    api.status.mockResolvedValue({ ...base, difference: 0.4 })
    const { container } = renderAlert()
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('stays quiet and dismissible while the figure is a person’s to choose', async () => {
    api.status.mockResolvedValue(base)
    renderAlert()
    await screen.findByText(/hold different stock values/)
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
  })

  it('offers no way to dismiss when Inventory owns the figure — a defect gets no "not now"', async () => {
    api.status.mockResolvedValue({ ...base, stock_source: 'inventory' })
    renderAlert()
    await screen.findByText(/should not/)
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
    expect(screen.getByText(/not meant to differ at all/)).toBeTruthy()
  })

  it('draws nothing for a company that has never been reconciled', async () => {
    api.status.mockResolvedValue({ has_run: false, stock_source: null })
    const { container } = renderAlert()
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('does not even ask when the reader may not read reconciliation', async () => {
    access.allowed = false
    renderAlert()
    await waitFor(() => expect(api.status).not.toHaveBeenCalled())
  })
})
