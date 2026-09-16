import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RegistersHubPage } from './RegistersHubPage'
import { REGISTER_CONFIGS } from './configs'
import { registerPermission, registerRoute } from './RegisterConfig'
import type { RegistersSummary } from '../services/registersApi'
import { formatDate } from '../utils/format'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 9, bo_id: 0, acs_type: null } }),
}))

const fetchRegistersSummary = vi.fn<(signal?: AbortSignal) => Promise<RegistersSummary>>()
vi.mock('../services/registersApi', () => ({
  fetchRegistersSummary: (signal?: AbortSignal) => fetchRegistersSummary(signal),
}))

const SUMMARY: RegistersSummary = {
  as_on: '2026-09-16',
  fy: { from: '2026-04-01', to: '2027-03-31' },
  currency: 'INR',
  items: { total: 124580, active: 120004 },
  warehouses: { total: 12, active: 12 },
  locations: { total: 48, active: 48 },
  movements: { count: 8912, from: '2026-09-01', to: '2026-09-16' },
  stock_value: { amount: 24800000, as_of: '2026-09-15', source: 'reconciliation' },
}

function renderHub() {
  render(
    <MemoryRouter>
      <RegistersHubPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  fetchRegistersSummary.mockReset()
  fetchRegistersSummary.mockResolvedValue(SUMMARY)
})

describe('RegistersHubPage', () => {
  it('lists every register, each linking to its own route', () => {
    renderHub()
    for (const config of REGISTER_CONFIGS) {
      const link = screen.getByRole('link', { name: new RegExp(config.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      expect(link.getAttribute('href'), config.title).toBe(registerRoute(config))
    }
  })

  it('groups them under headings a reader recognises', () => {
    renderHub()
    for (const heading of ['Movement', 'Stock position', 'Valuation', 'Analysis', 'Commitments and control']) {
      expect(screen.getByRole('heading', { name: heading }), heading).toBeTruthy()
    }
  })

  it('names the company and year the registers will be run for', () => {
    renderHub()
    expect(screen.getByText(/Acme Ltd · FY 2026-27 · All branches/)).toBeTruthy()
  })

  it('places the hub under Inventory in the breadcrumb trail', () => {
    renderHub()
    expect(screen.getByRole('link', { name: 'Inventory' }).getAttribute('href')).toBe('/dashboard')
  })

  it('removes a register the user may not read, rather than teasing a dead tile', () => {
    const ledger = REGISTER_CONFIGS.find((c) => c.path === 'stock-ledger')!
    const ledgerPermission = registerPermission(ledger)
    can.mockImplementation((key) => {
      const asked = Array.isArray(key) ? key : [key as string]
      const denied = Array.isArray(ledgerPermission) ? ledgerPermission : [ledgerPermission]
      return !asked.some((k) => denied.includes(k))
    })
    renderHub()
    expect(screen.queryByRole('link', { name: /Stock ledger/ })).toBeNull()
    // Its neighbours are untouched.
    expect(screen.getByRole('link', { name: /Valuation register/ })).toBeTruthy()
  })

  it('drops a whole section when nothing in it is readable, and says why when nothing is', () => {
    can.mockReturnValue(false)
    renderHub()
    expect(screen.queryByRole('heading', { name: 'Movement' })).toBeNull()
    expect(screen.getByText(/No registers are available for your access level/)).toBeTruthy()
  })
})

describe('RegistersHubPage counters', () => {
  it('reads the whole strip in one request and formats it for the company currency', async () => {
    renderHub()
    expect(await screen.findByText('1,24,580')).toBeTruthy()
    expect(screen.getByText('8,912')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('48')).toBeTruthy()
    expect(screen.getByText('₹ 2.48 Cr')).toBeTruthy()
    // Through the app's own date formatter, not a second spelling of a date:
    // every other screen in Inventory writes it exactly this way.
    expect(screen.getByText(formatDate('2026-09-16'))).toBeTruthy()
    expect(fetchRegistersSummary).toHaveBeenCalledTimes(1)
  })

  it('dates the stock value it prints, because it is the last reconciliation and not today', async () => {
    renderHub()
    expect(
      await screen.findByText(`Stock value · ${formatDate('2026-09-15')}`),
    ).toBeTruthy()
  })

  it('prints an em dash for a figure the reader may not see, and keeps the rest', async () => {
    fetchRegistersSummary.mockResolvedValue({ ...SUMMARY, items: null, stock_value: null })
    renderHub()
    expect(await screen.findByText('8,912')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBe(2)
    // A missing value never turns into a promise the data cannot keep.
    expect(screen.queryByText(/reconciled/)).toBeNull()
  })

  it('never blocks a register on its counters: the strip goes, the doors stay', async () => {
    fetchRegistersSummary.mockRejectedValue(new Error('500'))
    renderHub()
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Register counters' })).toBeNull())
    expect(screen.getByRole('link', { name: /Stock ledger/ }).getAttribute('href')).toBe(
      '/registers/stock-ledger',
    )
    expect(screen.getByRole('link', { name: /Valuation register/ })).toBeTruthy()
  })
})
