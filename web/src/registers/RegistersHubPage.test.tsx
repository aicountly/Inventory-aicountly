import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RegistersHubPage } from './RegistersHubPage'
import { REGISTER_CONFIGS } from './configs'
import { registerPermission, registerRoute } from './RegisterConfig'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

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
