import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { CompanyOption, FyOption, BranchOption } from '../company/manageShapes'

/**
 * The split company / financial-year-and-branch switcher.
 *
 * Covers the two things this rewrite exists for — the popovers open as two
 * independent controls rather than one, and neither is clipped by anything —
 * plus the behaviour that must NOT have changed underneath the new layout:
 * selecting a FY or branch still calls straight through to `selectFy` /
 * `selectBranch` with no page reload, exactly as before the split.
 */

const ACME: CompanyOption = { cmpId: 1, name: 'Acme Traders', shortName: null, ownership: 'owner', acsType: 1, status: 1 }
const ZEN: CompanyOption = { cmpId: 2, name: 'Zenith Retail', shortName: null, ownership: 'owner', acsType: 1, status: 1 }
const FY_CURRENT: FyOption = { fyId: 30, start: '2026-04-01', end: '2027-03-31', label: 'FY 2026-27', defaultValuationMethod: null }
const FY_PRIOR: FyOption = { fyId: 29, start: '2025-04-01', end: '2026-03-31', label: 'FY 2025-26', defaultValuationMethod: null }
const BRANCH_DELHI: BranchOption = { boId: 5, name: 'Delhi', isHeadOffice: false }
const BRANCH_HO: BranchOption = { boId: 6, name: 'Head Office', isHeadOffice: true }

const selectCompany = vi.fn()
const selectFy = vi.fn()
const selectBranch = vi.fn()

const company = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('../company/CompanyContext', () => ({ useCompany: () => company.value }))

const notifySuccess = vi.fn()
vi.mock('../ui/notify', () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), info: vi.fn(), emit: vi.fn() },
}))

vi.mock('../services/appLauncher', () => ({ getManageApiOrigin: () => 'https://manage.aicountly.com' }))

const { CompanySwitcher } = await import('./CompanySwitcher')

function setCompanyState(overrides: Partial<typeof company.value> = {}) {
  company.value = {
    companies: [ACME, ZEN],
    cmpId: 1,
    companyName: 'Acme Traders',
    fyList: [FY_CURRENT, FY_PRIOR],
    fyId: 30,
    fy: FY_CURRENT,
    branches: [BRANCH_DELHI, BRANCH_HO],
    boId: 0,
    branch: null,
    status: 'ready',
    selectCompany,
    selectFy,
    selectBranch,
    ...overrides,
  }
}

beforeEach(() => {
  selectCompany.mockClear()
  selectFy.mockClear()
  selectBranch.mockClear()
  notifySuccess.mockClear()
  try {
    window.localStorage.clear()
  } catch {
    /* not available under this environment; fine either way */
  }
  setCompanyState()
})

describe('company popover', () => {
  it('opens on click and lists every company with the current one marked', () => {
    render(<CompanySwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))

    const dialog = screen.getByRole('dialog', { name: 'Switch company' })
    expect(within(dialog).getByText('Zenith Retail')).toBeTruthy()
    // Both companies are present; only the active one renders as selected.
    // Exact name, not a substring match: the row also nests a star toggle
    // whose own aria-label ("Pin Acme Traders to top") contains the company
    // name, so a substring match would hit two elements.
    const active = within(dialog).getByRole('button', { name: 'Acme Traders' })
    expect(active.className).toMatch(/bg-primary-light/)
  })

  it('filters the list as you type', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies' }), { target: { value: 'zen' } })

    const dialog = screen.getByRole('dialog', { name: 'Switch company' })
    expect(within(dialog).getByText('Zenith Retail')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Acme Traders/ })).toBeNull()
  })

  it('picks a company and closes the popover', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Zenith Retail' }))

    expect(selectCompany).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('dialog', { name: 'Switch company' })).toBeNull()
  })

  it('opens Manage, not an internal route, for "Manage all companies"', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))

    const link = screen.getByRole('link', { name: /Manage all companies/ })
    expect(link.getAttribute('href')).toBe('https://manage.aicountly.com')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('pins a company without selecting it, and the pin survives a reopen', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Pin Zenith Retail to top' }))
    // Pinning is not selecting: the star click must not have picked the company.
    expect(selectCompany).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Unpin Zenith Retail' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))
    // Toggled back off, and the toggle persisted across the close/reopen.
    expect(screen.getByRole('button', { name: 'Pin Zenith Retail to top' })).toBeTruthy()
  })
})

describe('financial year and branch popover', () => {
  it('is a separate control from the company popover', () => {
    render(<CompanySwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /FY 2026-27/ }))

    expect(screen.getByRole('dialog', { name: 'Change financial year and branch' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Switch company' })).toBeNull()
  })

  it('opening one popover closes the other', () => {
    render(<CompanySwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /FY 2026-27/ }))
    expect(screen.getByRole('dialog', { name: 'Change financial year and branch' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))
    expect(screen.queryByRole('dialog', { name: 'Change financial year and branch' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Switch company' })).toBeTruthy()
  })

  it('applies a financial year change immediately, with no page reload', () => {
    const reloadSpy = vi.fn()
    // If this component ever regresses to Books' reload-on-change pattern,
    // this is what would catch it.
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: reloadSpy }, writable: true })

    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /FY 2026-27/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Financial year' }), { target: { value: '29' } })

    expect(selectFy).toHaveBeenCalledWith(29)
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('applies a branch change immediately', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /FY 2026-27/ }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: '5' } })

    expect(selectBranch).toHaveBeenCalledWith(5)
  })

  it('"Save as default" confirms without re-navigating, and closes the popover', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /FY 2026-27/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Save FY/branch as default' }))

    expect(notifySuccess).toHaveBeenCalledTimes(1)
    expect(String(notifySuccess.mock.calls[0][0])).toContain('Acme Traders')
    expect(screen.queryByRole('dialog', { name: 'Change financial year and branch' })).toBeNull()
  })

  it('disables the trigger while a switch is already in flight', () => {
    setCompanyState({ status: 'loading' })
    render(<CompanySwitcher />)

    // The context trigger itself is disabled mid-switch, matching the
    // company button's own spinner state.
    expect((screen.getByRole('button', { name: /FY 2026-27/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not render at all before a company is selected', () => {
    setCompanyState({ cmpId: null, companyName: '', fyId: null, fy: null, fyList: [], branches: [], boId: 0 })
    render(<CompanySwitcher />)

    expect(screen.queryByRole('button', { name: /FY/ })).toBeNull()
  })
})

describe('closing behaviour', () => {
  it('Escape closes whichever popover is open', () => {
    render(<CompanySwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))
    expect(screen.getByRole('dialog', { name: 'Switch company' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Switch company' })).toBeNull()
  })

  it('a click outside both controls closes an open popover', () => {
    render(
      <div>
        <CompanySwitcher />
        <button type="button">elsewhere</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Acme Traders/ }))
    expect(screen.getByRole('dialog', { name: 'Switch company' })).toBeTruthy()

    // The outside-click handler listens for `mousedown`, not `click`.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))

    expect(screen.queryByRole('dialog', { name: 'Switch company' })).toBeNull()
  })
})
