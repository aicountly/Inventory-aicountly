import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ValuationSnapshotResponse } from '../../services/valuationApi'
import { pickExport, clickPrint } from '../../test/exportMenu'

interface SheetPayload {
  title: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  summaryCards?: { label: string; value: string }[]
  metaLines?: string[]
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
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: { warehouses: [{ warehouse_id: 4, warehouse_name: 'Main store', warehouse_code: 'MS' }], units: [] },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: vi.fn(),
}))

const snapshot = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return { ...actual, valuationApi: { ...actual.valuationApi, snapshot: (...args: unknown[]) => snapshot(...args) } }
})

const { MethodComparisonPage } = await import('./MethodComparisonPage')

/** The spread from the approved design: the basis, and three around it. */
const VALUES: Record<string, number> = {
  AS_PER_MASTER: 8465220,
  FIFO: 8512940,
  LIFO: 8378600,
  WAC: 8459410,
}

type Query = Record<string, unknown>

function response(method: string, value: number, items = 248, qty = 18420): ValuationSnapshotResponse {
  return {
    data: [],
    meta: { total: items, limit: 1, offset: 0 },
    summary: { as_of: '2026-09-19', method, total_qty: qty, total_value: value, item_count: items },
  }
}

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  snapshot.mockReset()
  snapshot.mockImplementation(async (query: Query = {}) => {
    const method = String(query.method ?? 'AS_PER_MASTER')
    return response(method, VALUES[method] ?? 0)
  })
})

function renderPage(url = '/valuation/method-comparison?as_of=2026-09-19') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <MethodComparisonPage />
    </MemoryRouter>,
  )
}

/** The <tr> a method's name sits in. */
async function methodRow(name: string): Promise<HTMLElement> {
  const cell = await screen.findByRole('rowheader', { name: new RegExp(name, 'i') })
  return cell.closest('tr') as HTMLElement
}

describe('MethodComparisonPage', () => {
  it('asks the valuation engine for each method at one date, and never re-costs anything itself', async () => {
    renderPage()
    await waitFor(() => expect(snapshot).toHaveBeenCalled())

    const methods = snapshot.mock.calls
      .map((c) => (c[0] as Query).method)
      .filter((m) => (snapshot.mock.calls.find((x) => (x[0] as Query).method === m)?.[0] as Query).as_of === '2026-09-19')
    expect(new Set(methods)).toEqual(new Set(['AS_PER_MASTER', 'FIFO', 'LIFO', 'WAC']))
    // One row is enough: the summary is computed over the whole filtered set.
    expect((snapshot.mock.calls[0][0] as Query).limit).toBe(1)
  })

  it('measures every method from the item-master basis, with the sign in the digits', async () => {
    renderPage()

    const basis = await methodRow('As per item master')
    expect(within(basis).getByText(/books basis/i)).toBeTruthy()
    expect(within(basis).getByText('84,65,220.00')).toBeTruthy()

    const fifo = await methodRow('FIFO')
    expect(within(fifo).getByText('+47,720.00')).toBeTruthy()
    expect(within(fifo).getByText('+0.56%')).toBeTruthy()

    const lifo = await methodRow('LIFO')
    expect(within(lifo).getByText('-86,620.00')).toBeTruthy()
    expect(within(lifo).getByText('-1.02%')).toBeTruthy()
  })

  it('states the closest and the widest method above the table', async () => {
    renderPage()
    const strip = await screen.findByLabelText('Smart insight')

    expect(strip.textContent).toContain('Weighted average is closest')
    expect(strip.textContent).toContain('LIFO differs most')
  })

  it('shows a method that could not be valued as unavailable, not as zero', async () => {
    snapshot.mockImplementation(async (query: Query = {}) => {
      const method = String(query.method ?? 'AS_PER_MASTER')
      if (method === 'LIFO') throw new Error('valuation service timed out')
      return response(method, VALUES[method] ?? 0)
    })
    renderPage()

    const lifo = await methodRow('LIFO')
    expect(within(lifo).getByText(/could not be valued at this date/i)).toBeTruthy()
    expect(lifo.textContent).not.toContain('0.00')
    expect(await screen.findByText(/1 of 4 methods could not be valued/i)).toBeTruthy()
  })

  it('shows an error with a retry when nothing answered at all', async () => {
    snapshot.mockImplementation(async () => {
      throw new Error('valuation service unreachable')
    })
    renderPage()

    expect(await screen.findByText(/unable to load valuation comparison/i)).toBeTruthy()
    expect(screen.getByText(/nothing in your inventory data has been changed/i)).toBeTruthy()

    snapshot.mockImplementation(async (query: Query = {}) =>
      response(String(query.method ?? 'AS_PER_MASTER'), VALUES[String(query.method)] ?? 0),
    )
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await methodRow('FIFO')).toBeTruthy()
  })

  it('shows an empty state rather than four rows of zeroes when nothing is in stock', async () => {
    snapshot.mockImplementation(async (query: Query = {}) =>
      response(String(query.method ?? 'AS_PER_MASTER'), 0, 0, 0),
    )
    renderPage()

    expect(await screen.findByText(/no stock available for comparison/i)).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: /^FIFO$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /change date/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /change warehouse/i })).toBeTruthy()
  })

  it('sends the compare scope to the server, so the totals speak for the subset', async () => {
    renderPage('/valuation/method-comparison?as_of=2026-09-19&qty_sign=negative')
    await waitFor(() => expect(snapshot).toHaveBeenCalled())

    expect(snapshot.mock.calls.every((c) => (c[0] as Query).qty_sign === 'negative')).toBe(true)
    const select = (await screen.findByLabelText('Compare scope')) as HTMLSelectElement
    expect(select.value).toBe('negative')
  })

  it('compares the KPI cards against a real reading a month back, and names its date', async () => {
    snapshot.mockImplementation(async (query: Query = {}) => {
      const method = String(query.method ?? 'AS_PER_MASTER')
      if (query.as_of === '2026-08-19') return response(method, 8292610, 242, 17780)
      return response(method, VALUES[method] ?? 0)
    })
    renderPage()

    expect(await screen.findByText(/vs 19 Aug 2026 \(242\)/)).toBeTruthy()
    // The prior period is fetched, not derived: one extra call, at that date.
    await waitFor(() =>
      expect(snapshot.mock.calls.some((c) => (c[0] as Query).as_of === '2026-08-19')).toBe(true),
    )
  })

  it('leaves the delta off entirely when the month back falls before the financial year', async () => {
    renderPage('/valuation/method-comparison?as_of=2026-04-15')
    await waitFor(() => expect(snapshot).toHaveBeenCalled())

    // 15 Mar 2026 is in the previous year: a comparative there would be
    // measured against different opening balances.
    expect(snapshot.mock.calls.every((c) => (c[0] as Query).as_of === '2026-04-15')).toBe(true)
    expect(screen.queryByText(/^vs \d/)).toBeNull()
  })

  it('exports the comparison with raw numbers, not formatted strings', async () => {
    renderPage()
    await pickExport(/CSV/)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const [filename, csv] = downloadCsv.mock.calls[0]
    expect(filename).toContain('method-comparison')
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('Difference vs item master')
    expect(lines[0]).toContain('Variance %')
    // A spreadsheet has to be able to add these up.
    expect(lines.find((l) => l.startsWith('FIFO'))).toContain('47720')
    expect(csv).not.toContain('+47,720.00')
  })

  it('carries the scope and the basis caveat onto the printed sheet', async () => {
    renderPage()
    await clickPrint()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    // `Sep` or `Sept` depending on the ICU build under the test runner.
    expect(sheet.metaLines?.join(' | ')).toMatch(/As at 19 Sept? 2026/)
    expect(sheet.summaryCards?.map((c) => c.label)).toContain('Max variance')
    expect(sheet.footerNotes?.join(' ')).toMatch(/simulations/i)
    expect(sheet.rows).toHaveLength(4)
  })

  it('opens the per-item breakdown from a method, and never from the basis', async () => {
    renderPage()
    const fifo = await methodRow('FIFO')

    // The basis has nothing to be measured against, so it is not a button.
    const basis = await methodRow('As per item master')
    expect(within(basis).queryByRole('button')).toBeNull()

    fireEvent.click(within(fifo).getByRole('button', { name: /FIFO/i }))
    expect(await screen.findByRole('dialog', { name: /what drives the difference/i })).toBeTruthy()
  })

  it('never offers to save, apply or default a simulated method', async () => {
    renderPage()
    await methodRow('FIFO')

    const body = document.body.textContent ?? ''
    expect(body).toMatch(/posts, revalues or saves anything/i)
    expect(screen.queryByRole('button', { name: /save method|make default|apply method/i })).toBeNull()
  })
})
