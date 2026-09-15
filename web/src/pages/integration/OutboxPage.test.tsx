import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OutboxEvent } from '../../services/integrationApi'

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
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

const outbox = vi.fn()

vi.mock('../../services/integrationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/integrationApi')>()
  return { ...actual, integrationApi: { ...actual.integrationApi, outbox: (...args: unknown[]) => outbox(...args) } }
})

const { OutboxPage } = await import('./OutboxPage')

function event(id: number, status: string): OutboxEvent {
  return {
    event_id: id,
    event_uuid: `uuid-${id}`,
    cmp_id: 1,
    target_app: 'books',
    event_type: 'inventory.document.posted',
    aggregate_type: 'document',
    aggregate_id: 900 + id,
    aggregate_uuid: null,
    status,
    attempts: status === 'DEAD' ? 5 : 1,
    next_attempt_at: '2026-09-15 09:00:00',
    last_error: status === 'DEAD' ? 'books refused: period locked' : null,
    sent_at: null,
    acked_at: null,
    created_at: '2026-09-14 11:02:30',
  }
}

const ALL = Array.from({ length: 30 }, (_, i) => event(i + 1, i === 29 ? 'DEAD' : 'PENDING'))

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  outbox.mockReset()
  outbox.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/integration/outbox?limit=25']}>
      <OutboxPage />
    </MemoryRouter>,
  )
}

describe('OutboxPage', () => {
  it('says what the queue is for and what a dead event costs', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/What the outbox holds/)).toBeTruthy())
    const text = document.body.textContent ?? ''
    expect(text).toContain('queue Inventory uses to tell Books')
    expect(text).toContain('used up its retries')
    // The reason nothing clears itself here.
    expect(text).toContain('no background job')
  })

  it('exports every queued event with the error that stopped it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const lines = downloadCsv.mock.calls[0][1].trim().split('\r\n')
    expect(lines[0]).toContain('Last error')
    expect(lines).toHaveLength(31)
    expect(lines[30]).toContain('books refused: period locked')
  })

  it('prints the letterheaded sheet and says nothing is dispatched on a timer', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Outbox events')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.rows).toHaveLength(30)
    expect(sheet.footerNotes?.join(' ')).toContain('Nothing is dispatched on a schedule')
    // "Next try" is only meaningful while an event is still going to be tried:
    // a dead event has a stored next_attempt_at that no longer means anything,
    // and printing it would promise a retry that never comes.
    expect(sheet.rows[0].next_attempt_at.text).not.toBe('')
    expect(sheet.rows[29].next_attempt_at.text).toBe('')
  })

  it('prints the status the screen shows, not the raw token', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    // The screen's StatusBadge reads "Pending", never `PENDING`.
    const table = document.querySelector('tbody') as HTMLElement
    expect(within(table).getAllByText('Pending').length).toBeGreaterThan(0)
    expect(within(table).queryByText('PENDING')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    // A letterheaded sheet a user works through on paper must read the way the
    // screen they were reading did.
    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.rows[0].status.text).toBe('Pending')
    expect(sheet.rows[29].status.text).toBe('Dead')
  })
})
