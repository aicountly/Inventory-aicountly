import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReportsIndexPage } from './ReportsIndexPage'
import { REPORT_DIRECTORY } from '../../reports/directory/reportDirectory'

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const access = {
  can,
  loading: false,
  error: null as string | null,
  member: { uuid: 'user-a' },
  reload: vi.fn(),
}

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => access,
  useCan: () => true,
}))

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 7, warehouse_name: 'Main store', warehouse_code: 'MS', bo_id: 0, is_default: 1 },
      { warehouse_id: 9, warehouse_name: 'Cold room', warehouse_code: null, bo_id: 0, is_default: 0 },
    ],
  }),
}))

function renderPage(url = '/reports') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ReportsIndexPage />
    </MemoryRouter>,
  )
}

const cardLink = (name: string) => screen.getByRole('link', { name })

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  access.loading = false
  access.error = null
  window.localStorage.clear()
})

describe('ReportsIndexPage', () => {
  it('shows every report, each opening the route that report already had', () => {
    renderPage()
    expect(REPORT_DIRECTORY).toHaveLength(11)
    for (const report of REPORT_DIRECTORY) {
      expect(cardLink(report.title).getAttribute('href'), report.title).toBe(report.route)
    }
  })

  it('groups them onto the three shelves, with a count on each', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Stock & movement reports/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Ageing & expiry reports/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Valuation & ledger reports/i })).toBeTruthy()
    expect(screen.getByText('5 reports')).toBeTruthy()
    // Ageing & expiry and Valuation & ledger both hold three now — the opening
    // stock register joined the latter.
    expect(screen.getAllByText('3 reports')).toHaveLength(2)
  })

  it('filters as the reader types, without leaving the page', async () => {
    renderPage()
    fireEvent.change(screen.getByRole('searchbox', { name: /Search reports/i }), {
      target: { value: 'expiry' },
    })
    // The box holds the keystrokes and writes to the URL once typing settles.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeNull())
    expect(screen.queryByRole('link', { name: 'Near expiry' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Batch stock' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Replenishment' })).toBeNull()
  })

  it('keeps every character when the reader types quickly', async () => {
    renderPage()
    const box = screen.getByRole('searchbox', { name: /Search reports/i }) as HTMLInputElement
    for (const value of ['s', 'se', 'ser', 'seri', 'seria', 'serial']) {
      fireEvent.change(box, { target: { value } })
    }
    expect(box.value).toBe('serial')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeNull())
    expect(screen.queryByRole('link', { name: 'Serial numbers' })).toBeTruthy()
  })

  it('narrows to one shelf from the category control', () => {
    renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: /category/i }), {
      target: { value: 'valuation-ledger' },
    })
    expect(screen.queryByRole('link', { name: 'Stock ledger' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Warehouse stock' })).toBeNull()
  })

  it('restores the view held in the address bar', () => {
    renderPage('/reports?q=serial')
    expect(screen.queryByRole('link', { name: 'Serial numbers' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Stock ledger' })).toBeNull()
  })

  it('offers a way out when nothing matches', () => {
    renderPage('/reports?q=payroll')
    expect(screen.getByText('No reports found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Reset filters/i }))
    expect(screen.queryByText('No reports found')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeTruthy()
  })

  it('stars a report without opening it, and remembers the star', () => {
    const { unmount } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add Stock summary to favourites' }))
    expect(screen.getByRole('button', { name: 'Remove Stock summary from favourites' })).toBeTruthy()
    // The star lives inside the card, but it is not the card's link.
    expect(window.localStorage.getItem('inventory.reports.favorites.user-a')).toContain(
      'stock-summary',
    )
    unmount()
    renderPage()
    expect(screen.getByRole('button', { name: 'Remove Stock summary from favourites' })).toBeTruthy()
  })

  it('shows only the starred reports once favourites is pressed', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add Near expiry to favourites' }))
    const toggle = screen.getByRole('button', { name: /View favourites/i })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('link', { name: 'Near expiry' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeNull()
  })

  it('says so, rather than showing an empty page, when nothing is starred yet', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /View favourites/i }))
    expect(screen.getByText('No reports found')).toBeTruthy()
  })

  it('hands the chosen warehouse to the reports that take one', () => {
    renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: /warehouse/i }), {
      target: { value: '7' },
    })
    expect(cardLink('Warehouse stock').getAttribute('href')).toBe(
      '/reports/warehouse-stock?warehouse_id=7',
    )
  })

  it('jumps to a whole shelf from its View all', () => {
    renderPage()
    const heading = screen.getByRole('heading', { name: /Ageing & expiry reports/i })
    const section = heading.closest('section') as HTMLElement
    fireEvent.click(within(section).getByRole('button', { name: /View all/i }))
    expect(screen.queryByRole('link', { name: 'Stock ageing' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeNull()
  })

  it('removes a report the user may not read rather than teasing a locked card', () => {
    can.mockImplementation((key) => key !== 'reports.near_expiry.read')
    renderPage()
    expect(screen.queryByRole('link', { name: 'Near expiry' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Stock ageing' })).toBeTruthy()
    // The shelf's count follows what is actually on it.
    const ageing = screen
      .getByRole('heading', { name: /Ageing & expiry reports/i })
      .closest('section') as HTMLElement
    expect(within(ageing).getByText('2 reports')).toBeTruthy()
  })

  it('explains itself when the user may read nothing at all', () => {
    can.mockReturnValue(false)
    renderPage()
    expect(screen.getByText(/No reports are available for your access level/)).toBeTruthy()
  })

  it('holds the card layout while permissions load, instead of flashing "none"', () => {
    access.loading = true
    renderPage()
    expect(screen.queryByText('No reports found')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Stock summary' })).toBeNull()
  })

  it('offers a retry when permissions could not be loaded', () => {
    access.error = 'Network unreachable'
    renderPage()
    expect(screen.getByText('Unable to load reports')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    expect(access.reload).toHaveBeenCalled()
  })

  it('keeps the reader oriented with a breadcrumb home', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/dashboard')
  })
})
