import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, useLocation } from 'react-router-dom'

/**
 * Following a Books link must open the record Books meant.
 *
 * Books links into Inventory from the "Managed in Inventory" master badges, the
 * historical-register notices, the command palette and the mobile hand-off, and
 * the web ones carry the scope as `cmp_id` / `fy_id` / `bo_id`. This provider
 * used to ignore them and scope itself from localStorage, so a tab last used in
 * company B opened company B's #42 under a screen that promised the link's #42.
 *
 * What is asserted here is the part a type-checker cannot see: which company
 * the API would be called with (`getActiveScope`), what the next visit will
 * remember, and that a scope the user cannot open stops the screen instead of
 * being quietly swapped for the one they were already on.
 */

const manage = vi.hoisted(() => ({
  companies: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../services/manage', () => ({
  fetchAllCompanies: () => manage.companies(),
  fetchCompanyInfo: (cmpId: number) => manage.info(cmpId),
  fetchCompanyLogo: () => Promise.resolve(null),
}))

const { CompanyProvider, useCompany } = await import('./CompanyContext')
const { getActiveScope, setActiveScope } = await import('../services/api')
const { readSelection, writeSelection } = await import('./companyStorage')

function company(cmpId: number, name: string) {
  return { cmpId, name, shortName: null, ownership: 'owner' as const, acsType: 1 as const, status: 1 }
}

function fy(fyId: number, year: number) {
  return {
    fyId,
    start: `${year}-04-01`,
    end: `${year + 1}-03-31`,
    label: `FY ${year}-${String(year + 1).slice(-2)}`,
    defaultValuationMethod: null,
  }
}

function info(name: string, fyList: ReturnType<typeof fy>[], branches: { boId: number; name: string; isHeadOffice: boolean }[]) {
  return { cmpId: null, name, fyList, branches, hoId: null, addressLines: [], gstin: '' }
}

/** Beta Traders is the company the tab was last in; Acme Ltd is the one the link names. */
const BETA = company(4, 'Beta Traders')
const ACME = company(7, 'Acme Ltd')
const INFO: Record<number, ReturnType<typeof info>> = {
  4: info('Beta Traders', [fy(20, 2025)], [{ boId: 5, name: 'Beta HO', isHeadOffice: true }]),
  7: info('Acme Ltd', [fy(31, 2025), fy(30, 2024)], [{ boId: 2, name: 'Acme Depot', isHeadOffice: false }]),
}

function Probe() {
  const c = useCompany()
  const { pathname } = useLocation()
  return (
    <div>
      <div data-testid="status">{c.status}</div>
      <div data-testid="scope">{`${c.cmpId ?? '-'}/${c.fyId ?? '-'}/${c.boId}`}</div>
      <div data-testid="error">{c.error ?? ''}</div>
      <div data-testid="warning">{c.warning ?? ''}</div>
      <div data-testid="path">{pathname}</div>
      <button type="button" onClick={() => c.selectCompany(4)}>
        Open Beta Traders
      </button>
    </div>
  )
}

/** Arrive on `url`, exactly as a browser following a link from Books would. */
function visit(url: string) {
  window.history.replaceState(null, '', url)
  render(
    <BrowserRouter>
      <CompanyProvider>
        <Probe />
      </CompanyProvider>
    </BrowserRouter>,
  )
}

async function settled(status: 'ready' | 'error'): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe(status))
}

const scopeText = () => screen.getByTestId('scope').textContent
const errorText = () => screen.getByTestId('error').textContent ?? ''
const warningText = () => screen.getByTestId('warning').textContent ?? ''

beforeEach(() => {
  // Acme is first in the list on purpose: nothing may pass by falling through
  // to `companies[0]`, which is what the app opens when it remembers nothing.
  manage.companies.mockResolvedValue([ACME, BETA])
  manage.info.mockImplementation((cmpId: number) => Promise.resolve(INFO[cmpId]))
  localStorage.clear()
  // The tab was last used in Beta Traders — the company that used to win.
  writeSelection({ cmpId: 4, fyId: 20, boId: 0 })
  setActiveScope(null)
})

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('company scope from the URL', () => {
  it('opens the company, year and branch the link names, over the remembered one', async () => {
    visit('/masters/bill-of-materials/42?cmp_id=7&fy_id=31&bo_id=2')

    await settled('ready')
    expect(scopeText()).toBe('7/31/2')
    // What the API would be called with — the record that actually gets fetched.
    expect(getActiveScope()).toEqual({ cmp_id: 7, fy_id: 31, bo_id: 2, acs_type: 1 })
    expect(manage.info).toHaveBeenCalledWith(7)
  })

  it('is sticky: the next visit remembers the link’s scope, and the URL is tidied', async () => {
    visit('/masters/bill-of-materials/42?cmp_id=7&fy_id=31&bo_id=2&document_type=STOCK_TRANSFER')

    await settled('ready')
    // Sticky, deliberately: a reload of the shortened URL, a bookmark and the
    // next visit all stay on company 7 instead of snapping back to Beta Traders.
    expect(readSelection()).toEqual({ cmpId: 7, fyId: 31, boId: 2 })
    expect(window.location.search).toBe('?document_type=STOCK_TRANSFER')
    expect(window.location.pathname).toBe('/masters/bill-of-materials/42')
  })

  it('keeps today’s behaviour when the link carries no scope', async () => {
    visit('/masters/bill-of-materials/42')

    await settled('ready')
    expect(scopeText()).toBe('4/20/0')
    expect(getActiveScope()?.cmp_id).toBe(4)
    expect(readSelection()).toEqual({ cmpId: 4, fyId: 20, boId: 0 })
  })

  it('refuses a company the user cannot open instead of answering with theirs', async () => {
    visit('/masters/bill-of-materials/42?cmp_id=99&fy_id=31&bo_id=0')

    await settled('error')
    // Says what was asked for and why nothing opened. AppShell banners `error`
    // and only mounts the outlet on `status === 'ready'`, so this is the screen
    // staying empty rather than filling with the wrong company's #42.
    expect(errorText()).toContain('company #99')
    expect(errorText()).toContain('Nothing was opened')
    // Nothing is scoped, so no request can go out in the company they were on —
    // which is what would have put a different record under #42.
    expect(getActiveScope()).toBeNull()
    expect(scopeText()).toBe('-/-/0')
    expect(manage.info).not.toHaveBeenCalled()
    // The remembered selection is untouched, and the request stays in the URL
    // so a reload refuses again rather than quietly showing Beta Traders' #42.
    expect(readSelection()).toEqual({ cmpId: 4, fyId: 20, boId: 0 })
    expect(window.location.search).toContain('cmp_id=99')
  })

  it('refuses a scope parameter that is not an id', async () => {
    visit('/masters/bill-of-materials/42?cmp_id=7&fy_id=abc')

    await settled('error')
    expect(errorText()).toContain('“abc”')
    expect(getActiveScope()).toBeNull()
    expect(readSelection()).toEqual({ cmpId: 4, fyId: 20, boId: 0 })
  })

  it('refuses a financial year the named company does not have', async () => {
    visit('/registers/stock-ledger?cmp_id=7&fy_id=99&bo_id=0')

    await settled('error')
    expect(errorText()).toContain('financial year #99')
    expect(errorText()).toContain('Acme Ltd')
    // The year is what the figures on the page mean, so nothing is rendered and
    // nothing is remembered until the reader picks one.
    expect(getActiveScope()).toBeNull()
    expect(readSelection()).toEqual({ cmpId: 4, fyId: 20, boId: 0 })
  })

  it('refuses a branch that belongs to another company', async () => {
    visit('/registers/stock-balances?cmp_id=7&fy_id=31&bo_id=5')

    await settled('error')
    expect(errorText()).toContain('branch #5')
    expect(getActiveScope()).toBeNull()
  })

  it('uses the year the link asked for when Manage cannot confirm it', async () => {
    manage.info.mockRejectedValue(new Error('Manage timed out'))

    visit('/documents?cmp_id=7&fy_id=31&bo_id=2')

    await settled('ready')
    // Degraded, but nothing is swapped: the company came from the companies
    // list, and the year and branch are the ones asked for, said out loud.
    expect(scopeText()).toBe('7/31/2')
    expect(warningText()).toContain('Manage timed out')
    expect(warningText()).toContain('the link asked for')
    // Written through, so the reload after Manage comes back is not on company 4.
    expect(readSelection()).toEqual({ cmpId: 7, fyId: 31, boId: 2 })
  })

  it('leaves the refused record behind when the user picks a company instead', async () => {
    visit('/masters/bill-of-materials/42?cmp_id=99&fy_id=31&bo_id=0')
    await settled('error')

    fireEvent.click(screen.getByRole('button', { name: 'Open Beta Traders' }))

    await settled('ready')
    // #42 was company 99's; under Beta Traders it is a different record, so the
    // recovery must not leave the reader on that URL reading someone else's row.
    expect(screen.getByTestId('path').textContent).toBe('/dashboard')
    expect(scopeText()).toBe('4/20/0')
    expect(window.location.search).toBe('')
  })
})
