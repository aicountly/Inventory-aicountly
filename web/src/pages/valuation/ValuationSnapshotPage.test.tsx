import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ValuationSnapshotResponse, ValuationSnapshotRow } from '../../services/valuationApi'

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  totalsRow: Record<string, { text: string; value: unknown }> | null
  summaryCards?: { label: string; value: string }[]
  metaLines?: string[]
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
  useFormOptions: () => ({ options: { warehouses: [], units: [] }, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const snapshot = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return { ...actual, valuationApi: { ...actual.valuationApi, snapshot: (...args: unknown[]) => snapshot(...args) } }
})

const { ValuationSnapshotPage } = await import('./ValuationSnapshotPage')

function item(id: number): ValuationSnapshotRow {
  return {
    item_id: id,
    item_name: `Widget ${id}`,
    item_alias: null,
    item_sku: `W-${id}`,
    unit_id: 1,
    unit_symbol: 'Pcs',
    valuation_method: 'FIFO',
    closing_qty: 10,
    unit_cost: 25,
    stock_value: 250,
    valuation_method_applied: 'FIFO',
  }
}

const ALL = Array.from({ length: 30 }, (_, i) => item(i + 1))

/** The server's own figures for this query — 30 items, 300 units, ₹7,500. */
const SUMMARY = { as_of: '2026-09-15', method: 'FIFO', total_qty: 300, total_value: 7500, item_count: 30 }

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  snapshot.mockReset()
  snapshot.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    const response: ValuationSnapshotResponse = {
      data: ALL.slice(offset, offset + limit),
      meta: { total: ALL.length, limit, offset },
      summary: SUMMARY,
    }
    return response
  })
})

function renderPage(url = '/valuation?limit=25&method=FIFO&as_of=2026-09-15') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ValuationSnapshotPage />
    </MemoryRouter>,
  )
}

describe('ValuationSnapshotPage exports', () => {
  it('puts the totals under the columns they belong to, and nowhere else', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    const totals = sheet.totalsRow
    expect(totals).not.toBeNull()
    // A totals row is positional: one cell out of step prints a stock value
    // under "Unit cost", which is a wrong number on a signed sheet.
    expect(totals?.item_name.text).toBe('Total (30 items)')
    expect(totals?.closing_qty.text).toBe('300')
    expect(totals?.stock_value.text).toBe('7,500.00')
    expect(totals?.unit_cost.text).toBe('')
    expect(totals?.unit_symbol.text).toBe('')
    expect(totals?.valuation_method_applied.text).toBe('')
  })

  it('carries the server summary and the query onto the sheet', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.summaryCards?.map((c) => `${c.label}: ${c.value}`)).toEqual([
      'Items: 30',
      'Total qty: 300',
      'Total value: 7,500.00',
    ])
    expect(sheet.metaLines).toContain('As at: 2026-09-15')
    expect(sheet.metaLines).toContain('Method: FIFO')
    expect(sheet.rows).toHaveLength(30)
  })

  it('names the file for the date the stock is valued at, not the day it was made', async () => {
    // An as-at date that is NOT today, so the two dates in the name are
    // distinguishable and the assertion cannot pass by coincidence.
    renderPage('/valuation?limit=25&method=FIFO&as_of=2026-03-31')
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const filename = downloadCsv.mock.calls[0][0]
    // Two exports on the same afternoon, one as at 31-Mar and one as at 30-Jun,
    // must not land in the downloads folder under the same name.
    expect(filename).toContain('2026-03-31')
    expect(filename).toMatch(/^valuation-fifo-2026-03-31-acme-ltd-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('names the cost columns as valuation, not as a price', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const header = downloadCsv.mock.calls[0][1].split('\r\n')[0]
    expect(header).toContain('Unit cost (valuation)')
    expect(header).toContain('Stock value (valuation)')
  })
})
