import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ValuationRevision } from '../../services/valuationApi'

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  footerNotes?: string[]
}

const printTabular = vi.fn((_p: SheetPayload) => true)
const exportTabularExcel = vi.fn(async (_p: SheetPayload) => {})
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('../../export/documentExport', () => ({
  exportTabularExcel: (p: SheetPayload) => exportTabularExcel(p),
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
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const revisions = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return { ...actual, valuationApi: { ...actual.valuationApi, revisions: (...args: unknown[]) => revisions(...args) } }
})

const { RevisionsPage } = await import('./RevisionsPage')

function revision(id: number): ValuationRevision {
  return {
    revision_id: id,
    revision_uuid: `uuid-${id}`,
    job_id: 4,
    document_id: 500 + id,
    line_id: 1,
    source_app: 'books',
    source_document_type: 'books.sales',
    source_document_id: 700 + id,
    source_document_uuid: null,
    old_valuation_rate: 100.5,
    new_valuation_rate: 112.25,
    old_valuation_amount: 1005,
    new_valuation_amount: 1122.5,
    delta_amount: 117.5,
    published_at: '2026-09-01 09:00:00',
    acknowledged_at: null,
    acknowledged_by_app: null,
    created_at: '2026-09-01 08:59:00',
    document_no: `DN-${id}`,
    document_type: 'delivery_note',
    document_date: '2026-08-11',
    document_status: 'POSTED',
    source_document_no: `SI-${id}`,
    item_id: 12,
    direction: 'OUT',
    base_qty: 10,
    item_name: 'Widget A',
    item_sku: 'W-A',
    acknowledged: false,
  }
}

/** 30 revisions: more than one page of 25. */
const ALL = Array.from({ length: 30 }, (_, i) => revision(i + 1))

beforeEach(() => {
  printTabular.mockClear()
  exportTabularExcel.mockClear()
  downloadCsv.mockClear()
  revisions.mockReset()
  revisions.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/valuation/revisions?limit=25']}>
      <RevisionsPage />
    </MemoryRouter>,
  )
}

describe('RevisionsPage exports', () => {
  /**
   * Books owns the commercial rate and amount; Inventory owns the valuation.
   * On this screen every figure is a valuation figure, and a sheet that headed
   * one of them "Old rate" invites a reader to take it for a price.
   */
  it('names every money column as a valuation figure, on screen and in the file', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('DN-1')).toBeTruthy())
    for (const header of ['Old valuation rate', 'New valuation rate', 'Old valuation amount', 'New valuation amount', 'Valuation delta']) {
      expect(screen.getByRole('columnheader', { name: header }), header).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    const header = (downloadCsv.mock.calls[0][1].split('\r\n')[0] ?? '').split(',')
    expect(header).toContain('Old valuation rate')
    expect(header).toContain('New valuation rate')
    expect(header).toContain('Old valuation amount')
    expect(header).toContain('New valuation amount')
    expect(header).toContain('Valuation delta (new − old)')
    // Nothing on this sheet may read as a price agreed with a party.
    expect(header).not.toContain('Rate')
    expect(header).not.toContain('Amount')
  })

  it('writes every matching revision, not the page on screen, and says so on paper', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('DN-1')).toBeTruthy())
    expect(screen.queryByText('DN-30')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Excel/ }))
    await waitFor(() => expect(exportTabularExcel).toHaveBeenCalledOnce())
    const payload = exportTabularExcel.mock.calls[0][0]
    expect(payload.rows).toHaveLength(30)
    expect(payload.footerNotes?.join(' ')).toContain('valuation figure')
  })

  it('prints the letterheaded sheet from the Print button', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('DN-1')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Valuation revisions')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.rows).toHaveLength(30)
    // "Awaiting Books" is what the badge says; the sheet must not print `false`.
    expect(sheet.rows[0].books_state.text).toBe('Published to Books')
  })
})
