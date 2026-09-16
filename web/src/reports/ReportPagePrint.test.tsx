import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { defineRegister } from '../registers/RegisterConfig'
import { buildTotalsRow, totalsLabel } from '../registers/registerTotals'
import { pageHint, summaryOverRows, withPageSummary } from '../registers/configs/pageSummary'
import type { PageSummary } from '../registers/configs/pageSummary'
import type { ReportResponse } from '../services/reportsApi'

/**
 * What a register puts on paper.
 *
 * The register engine builds the printed sheet, so everything a reader is
 * entitled to see on it is a property of this page: the letterhead, the scope
 * the figures belong to, the emphasis the alarming figure carries, a footer
 * that speaks for what the sheet actually contains, and Ctrl+P reaching the
 * sheet at all rather than the browser's own print of the app.
 */

interface CapturedSheet {
  companyName?: string
  gstin?: string
  addressLines?: string[]
  logo?: string | null
  scopeLabel?: string
  generatedAt?: string
  metaLines?: string[]
  summaryCards?: { label: string; value: string; hint?: string; tone?: string }[]
  totalsRow?: Record<string, { text: string }> | null
  rows: unknown[]
}

const printTabular = vi.fn((_payload: CapturedSheet) => true)

vi.mock('../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: (payload: CapturedSheet) => printTabular(payload),
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 3 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    fy: { label: 'FY 2026-27' },
    branch: { boId: 3, name: 'North branch', isHeadOffice: false },
    addressLines: ['12 MG Road', 'Bengaluru 560038'],
    gstin: '29AABCU9603R1ZJ',
    logo: 'data:image/png;base64,AAAA',
  }),
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [],
    units: [],
    defaultWarehouseId: null,
    warehouseName: () => '',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: () => {} }),
}))

vi.mock('../registers/useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({ options: [], loading: false }),
}))

const { ReportPage } = await import('./ReportPage')

interface Row {
  movement_id: number
  item_name: string
  qty: number
}

const SUM_KEYS = ['qty'] as const

/** 2 rows served, 6 matching — the shape every page-summary register is in. */
const PAGE: Row[] = [
  { movement_id: 1, item_name: 'Widget A', qty: 10 },
  { movement_id: 2, item_name: 'Widget B', qty: 20 },
]
const EVERYTHING: Row[] = [
  ...PAGE,
  { movement_id: 3, item_name: 'Widget C', qty: 30 },
  { movement_id: 4, item_name: 'Widget D', qty: 40 },
  { movement_id: 5, item_name: 'Widget E', qty: 50 },
  { movement_id: 6, item_name: 'Widget F', qty: 60 },
]

function response(rows: Row[]): ReportResponse<Row, PageSummary> {
  return withPageSummary({ data: rows, meta: { total: EVERYTHING.length, limit: 2, offset: 0 } }, 'demo', SUM_KEYS)
}

const pageRegister = defineRegister<Row, PageSummary>({
  slug: 'demo_page',
  path: 'demo_page',
  title: 'Movement demo register',
  description: 'Every posted movement in the period',
  defaultSort: 'movement_id',
  defaultLimit: 2,
  filters: [],
  columns: [
    { key: 'item_name', header: 'Item', alwaysVisible: true },
    { key: 'qty', header: 'Qty', align: 'right', format: 'qty' },
  ],
  rowKey: (r) => r.movement_id,
  summaryForRows: (s, rows) => summaryOverRows(s, rows, SUM_KEYS),
  totals: (s) =>
    buildTotalsRow([{ key: 'item_name' }, { key: 'qty', align: 'right' }], { qty: String(s.sums.qty) }, {
      label: `${totalsLabel(s.pageRows, 'movement')} — ${pageHint(s)}`,
      labelKey: 'item_name',
    }),
  summary: (s) => [
    { label: 'Net qty', value: String(s.sums.qty), hint: pageHint(s), tone: 'critical' },
    { label: 'Rows', value: String(s.pageRows) },
  ],
})

/**
 * A register whose query does not constrain the financial year. The scope line
 * is the only record on paper of what was asked for, so it may not claim one.
 */
const unscopedRegister = defineRegister<Row, PageSummary>({
  ...pageRegister,
  slug: 'demo_unscoped',
  path: 'demo_unscoped',
  scopePeriod: 'All financial years',
})

const fetchSpy = vi.fn()

// The reader is in India; the stamp on the paper has to be their clock.
const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata'
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

function renderRegister(config = pageRegister) {
  return render(
    <MemoryRouter initialEntries={['/registers/demo']}>
      <Routes>
        <Route path="/registers/demo" element={<ReportPage config={config} />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** The payload the print sheet was built from. */
async function printedSheet(): Promise<CapturedSheet> {
  await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
  return printTabular.mock.calls[0][0]
}

beforeEach(() => {
  printTabular.mockClear()
  fetchSpy.mockReset()
  // The page asks for 2 rows; the export pager asks for 500 and gets all six.
  fetchSpy.mockImplementation(({ query }: { query: { limit?: number } }) =>
    Promise.resolve(response(Number(query.limit) > PAGE.length ? EVERYTHING : PAGE)),
  )
  pageRegister.fetch = (args) => fetchSpy(args) as Promise<ReportResponse<Row, PageSummary>>
  unscopedRegister.fetch = pageRegister.fetch
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('Ctrl+P on a register', () => {
  it('prints the letterheaded sheet instead of the app it is looking at', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented, 'the browser must not take this one').toBe(true)
    const sheet = await printedSheet()
    expect(sheet.rows).toHaveLength(EVERYTHING.length)
  })

  it('is advertised because it is wired', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    // The shortcut is advertised on the control it belongs to, rather than in
    // a detached row of chips beside the page title.
    const print = screen.getByRole('button', { name: /^Print/ })
    expect(within(print).getByText('Ctrl P')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^Refresh/ })).getByText('Ctrl R')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^Search/ })).getByText('/')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /^Back/ })).getByText('Esc')).toBeTruthy()
  })

  it('does not fire on an empty register, exactly as the Print button does not', async () => {
    fetchSpy.mockResolvedValue(
      withPageSummary({ data: [], meta: { total: 0, limit: 2, offset: 0 } }, 'demo', SUM_KEYS),
    )
    renderRegister()
    await screen.findByText('No rows match these filters')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(printTabular).not.toHaveBeenCalled()
  })

  it('is not advertised on a screen that has no sheet to print', async () => {
    const { ReportCompactShell } = await import('../ui/shell/ReportCompactShell')
    render(
      <MemoryRouter>
        <ReportCompactShell title="A list" onRefresh={() => {}}>
          <p>rows</p>
        </ReportCompactShell>
      </MemoryRouter>,
    )
    // No print handler, so no Print button and therefore no Ctrl P chip: the
    // advertisement cannot outlive the wiring, because it is part of it.
    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull()
    expect(screen.queryAllByText('Ctrl P')).toHaveLength(0)
  })
})

describe('the printed register', () => {
  it('carries the company letterhead Manage holds', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    const sheet = await printedSheet()
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.addressLines).toEqual(['12 MG Road', 'Bengaluru 560038'])
    expect(sheet.gstin).toBe('29AABCU9603R1ZJ')
    expect(sheet.logo).toBe('data:image/png;base64,AAAA')
    expect(sheet.scopeLabel).toBe('Acme Ltd · FY 2026-27 · North branch')
  })

  it('stamps the local clock, not the UTC instant', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    const sheet = await printedSheet()
    const now = new Date()
    expect(sheet.generatedAt).toContain(String(now.getDate()).padStart(2, '0'))
    expect(sheet.generatedAt).toContain(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    )
  })

  it('keeps the emphasis a critical figure has on screen', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    const sheet = await printedSheet()
    const net = sheet.summaryCards?.find((c) => c.label === 'Net qty')
    expect(net?.tone, 'a critical KPI prints in ordinary black without this').toBe('credit')
    expect(sheet.summaryCards?.find((c) => c.label === 'Rows')?.tone).toBeUndefined()
  })

  it('totals what it actually contains, not the page that was on screen', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    // On screen: 2 of 6 rows, so the footer says so.
    expect(screen.getByText(/Total \(2 movements\) — this page only/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    const sheet = await printedSheet()
    expect(sheet.rows).toHaveLength(6)
    expect(sheet.metaLines).toContain('Rows: 6')
    const label = sheet.totalsRow?.item_name.text
    expect(label).toBe('Total (6 movements) — all rows')
    expect(sheet.totalsRow?.qty.text, 'the sum of every exported row').toBe('210')
    const card = sheet.summaryCards?.find((c) => c.label === 'Net qty')
    expect(card?.value).toBe('210')
    expect(card?.hint).toBe('all rows')
  })
})

describe('the register header', () => {
  it('says which company, year and branch the figures belong to', async () => {
    renderRegister()
    await screen.findByText('Widget A')
    expect(screen.getByText(/Acme Ltd · FY 2026-27 · North branch/)).toBeTruthy()
  })

  it('names the period a register actually covers instead of the selected year', async () => {
    renderRegister(unscopedRegister)
    await screen.findByText('Widget A')
    expect(screen.getByText(/Acme Ltd · All financial years · North branch/)).toBeTruthy()
    expect(screen.queryByText(/FY 2026-27/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    const sheet = await printedSheet()
    expect(sheet.scopeLabel).toBe('Acme Ltd · All financial years · North branch')
  })
})
