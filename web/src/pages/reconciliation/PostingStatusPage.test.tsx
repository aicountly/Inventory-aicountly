import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PostingStatusEntry, PostingStatusResponse } from '../../services/reconciliationApi'

interface SheetPayload {
  title: string
  companyName?: string
  scopeLabel?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
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
    gstin: '27AAAAA0000A1Z5',
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

const postingStatus = vi.fn()

vi.mock('../../services/reconciliationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/reconciliationApi')>()
  return { ...actual, reconciliationApi: { ...actual.reconciliationApi, postingStatus: (...args: unknown[]) => postingStatus(...args) } }
})

const { PostingStatusPage } = await import('./PostingStatusPage')

function entry(id: number, sync: string): PostingStatusEntry {
  return {
    sync_status: sync,
    source: {
      source_app: 'books',
      source_document_type: 'books.sales',
      source_document_id: id,
      source_document_uuid: null,
      source_document_no: `SI-${id}`,
    },
    books: {
      source_document_id: id,
      source_document_uuid: null,
      source_document_type: 'books.sales',
      document_no: `SI-${id}`,
      document_date: '2026-08-11',
      status: 'POSTED',
      // What the customer was charged: Books' number.
      amount: 11800,
    },
    inventory: {
      document_id: 900 + id,
      document_uuid: null,
      document_type: 'delivery_note',
      document_no: `DN-${id}`,
      document_date: '2026-08-11',
      status: 'POSTED',
      posted_at: '2026-08-11 10:00:00',
      cancelled_at: null,
      failure_reason: null,
      // What the stock cost: Inventory's number.
      stock_effect: 7400,
      bo_id: 0,
    },
  }
}

/** 30 vouchers: more than the 25 a page shows, so "the file" and "the page" differ. */
const ALL = Array.from({ length: 30 }, (_, i) => entry(i + 1, i === 29 ? 'FAILED_INVENTORY' : 'IN_SYNC'))

const SUMMARY = { IN_SYNC: 118, FAILED_INVENTORY: 3, MISSING_IN_BOOKS: 2 }

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  postingStatus.mockReset()
  postingStatus.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    const response: PostingStatusResponse = {
      data: ALL.slice(offset, offset + limit),
      meta: { total: ALL.length, limit, offset },
      summary: SUMMARY,
      books_available: true,
      books_error: null,
    }
    return response
  })
})

function renderPage(url = '/reconciliation/posting-status?limit=25') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <PostingStatusPage />
    </MemoryRouter>,
  )
}

describe('PostingStatusPage', () => {
  it('explains, on the screen, what it reconciles and what a difference means', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/What posting status shows/)).toBeTruthy())
    const text = document.body.textContent ?? ''
    expect(text).toContain('document by document')
    expect(text).toContain('posting is not one transaction')
    expect(text).toContain('no background job')
  })

  /** The drill-down rule: the card's link must reproduce the card's number. */
  it('renders the server summary as cards that link to exactly the rows they counted', async () => {
    renderPage()
    const inSync = await screen.findByRole('link', { name: /In sync/ })
    expect(inSync.getAttribute('href')).toBe('/reconciliation/posting-status?sync_status=IN_SYNC')
    expect(inSync.textContent).toContain('118')
    // ... and the meaning travels with the number.
    expect(inSync.textContent).toContain('Inventory has posted it and Books reports the same')

    const failed = screen.getByRole('link', { name: /Failed inventory/ })
    expect(failed.getAttribute('href')).toBe('/reconciliation/posting-status?sync_status=FAILED_INVENTORY')
    expect(failed.textContent).toContain('3')
  })

  it('says the cards count the whole year when a filter has narrowed the table', async () => {
    renderPage('/reconciliation/posting-status?limit=25&source_document_type=books.sales')
    await waitFor(() => expect(screen.getByRole('link', { name: /In sync/ })).toBeTruthy())
    expect(document.body.textContent).toContain('filters narrow the table below them')
  })

  it('exports every matching row, naming the Books figure and the Inventory figure apart', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const csv = downloadCsv.mock.calls[0][1]
    const [header, ...rows] = csv.trim().split('\r\n')
    // Books owns the commercial value; Inventory owns the valuation. A sheet
    // that called either one "Amount" would hand the reader the wrong figure.
    expect(header).toContain('Books amount (voucher value)')
    expect(header).toContain('Stock effect (valuation)')
    // The table holds 25 of the 30; the file holds all 30.
    expect(screen.queryByText('DN-30')).toBeNull()
    expect(rows).toHaveLength(30)
    expect(rows[0]).toContain('11800')
    expect(rows[0]).toContain('7400')
  })

  it('prints the letterheaded sheet, not the page', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Posting status')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.rows).toHaveLength(30)
    expect(sheet.rows[0].sync_status.text).toBe('In sync')
  })
})
