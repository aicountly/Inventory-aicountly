import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AuditLogRow, AuditSummary } from '../../services/auditApi'

interface SheetPayload {
  title: string
  companyName?: string
  gstin?: string
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
    addressLines: ['12 Industrial Estate'],
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

const list = vi.fn()
const summary = vi.fn()
const entity = vi.fn()

vi.mock('../../services/auditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditApi')>()
  return {
    ...actual,
    auditApi: {
      ...actual.auditApi,
      list: (...args: unknown[]) => list(...args),
      summary: (...args: unknown[]) => summary(...args),
      entity: (...args: unknown[]) => entity(...args),
    },
  }
})

/** What the server counts over the whole filtered set. Never page-derived. */
const SUMMARY: AuditSummary = {
  total: 12482,
  previous_total: null,
  actors: 28,
  source_apps: 12,
  event_types: 9,
  entity_types: 14,
  first_at: '2026-01-02 08:00:00',
  last_at: '2026-09-16 10:15:42',
  retention_years: 8,
  may_purge: false,
  facets: {
    actions: [{ value: 'item.update', count: 30 }],
    actors: [{ value: '7', count: 21 }],
    source_apps: [{ value: 'books', count: 30 }],
    entity_types: [{ value: 'item', count: 30 }],
  },
}

const { AuditLogPage } = await import('./AuditLogPage')

function row(id: number): AuditLogRow {
  return {
    audit_id: id,
    cmp_id: 1,
    entity_type: 'item',
    entity_id: 12,
    entity_uuid: null,
    action: 'item.update',
    actor_uuid: null,
    source_app: 'books',
    source_document_type: 'books.sales',
    source_document_id: 44,
    source_document_uuid: null,
    reason: 'rate corrected',
    approval_ref: null,
    reversal_ref: null,
    before: { valuation_rate: 100 },
    after: { valuation_rate: 112.25 },
    meta: null,
    request_id: `req-${id}`,
    ip_address: '10.0.0.2',
    created_at: '2026-09-14 11:02:30',
  }
}

/** 30 entries: more than the 25 a page shows. */
const ALL = Array.from({ length: 30 }, (_, i) => row(i + 1))

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  summary.mockReset()
  summary.mockImplementation(async () => SUMMARY)
  entity.mockReset()
  entity.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
  list.mockReset()
  list.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

function renderPage(url = '/audit-log?limit=25') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AuditLogPage />
    </MemoryRouter>,
  )
}

describe('AuditLogPage exports', () => {
  /**
   * The audit CSV is what an auditor asks for. The before / after snapshots are
   * the reason it is worth having, so the upgrade from one CSV button to four
   * formats must not quietly narrow the file to what fits on the screen.
   */
  it('keeps the before and after snapshots, and every row, in the file', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /export/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const [filename, csv] = downloadCsv.mock.calls[0]
    const lines = csv.trim().split('\r\n')
    expect(filename).toContain('audit-log-acme-ltd')
    expect(lines[0]).toContain('Before')
    expect(lines[0]).toContain('After')
    expect(lines[0]).toContain('Request id')
    expect(lines[0]).toContain('IP')
    expect(lines).toHaveLength(31)
    expect(lines[1]).toContain('{""valuation_rate"":100}')
    expect(lines[1]).toContain('{""valuation_rate"":112.25}')
  })

  it('prints the audit trail on the company letterhead', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Audit log')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.gstin).toBe('27AAAAA0000A1Z5')
    expect(sheet.rows).toHaveLength(30)
    // A null actor is a system write, not a blank cell.
    expect(sheet.rows[0].actor_uuid.text).toBe('system')
    expect(sheet.rows[0].changed_fields.text).toBe('valuation_rate')
  })
})

describe('AuditLogPage figures', () => {
  /**
   * The cards must carry the server's count for the whole filtered set. The
   * page holds 25 rows of 30; a card that read "25" or "30" would be answering
   * a question nobody asked.
   */
  it('shows the server summary, not a figure derived from the rows on screen', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('12,482')).toBeTruthy())
    expect(screen.getByText('28')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    // Retention is read from the policy, not written into the markup.
    expect(screen.getByText('8 yrs')).toBeTruthy()
    expect(screen.getByText(/never purged/i)).toBeTruthy()
  })

  /** Paging must not re-count the set, nor move the figures above the table. */
  it('does not refetch the summary when the reader turns the page', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('12,482')).toBeTruthy())
    const before = summary.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1))
    expect(summary).toHaveBeenCalledTimes(before)
  })

  it('never sends paging parameters with the summary request', async () => {
    renderPage()
    await waitFor(() => expect(summary).toHaveBeenCalled())
    const sent = summary.mock.calls[0][0] as Record<string, unknown>
    expect(sent.page).toBeUndefined()
    expect(sent.limit).toBeUndefined()
    expect(sent.sort).toBeUndefined()
  })

  /**
   * The totals are a convenience; the entries are the record. Losing the first
   * must not take the second off the screen.
   */
  it('keeps the entries when only the summary fails', async () => {
    summary.mockImplementation(async () => {
      throw new Error('aggregate timed out')
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Totals unavailable/i)).toBeTruthy())
    expect(screen.getAllByText('Item #12').length).toBeGreaterThan(0)
  })
})

describe('AuditLogPage inspector', () => {
  it('opens the entry from its timestamp and shows what changed', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('14 Sept 2026').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('14 Sept 2026')[0])

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Audit event details')).toBeTruthy()
    // Twice over: once in the changed-field list, once as the path of the diff.
    expect(within(drawer).getAllByText('valuation_rate').length).toBeGreaterThan(0)
    expect(within(drawer).getByText('100')).toBeTruthy()
    expect(within(drawer).getByText('112.25')).toBeTruthy()
  })

  it('closes on Escape', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('14 Sept 2026').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('14 Sept 2026')[0])
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  /**
   * Audit entries are evidence. The inspector is the one screen that shows a
   * whole record, so it is the one place a mutation control could plausibly be
   * added by accident.
   */
  it('offers no way to change the record', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('14 Sept 2026').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('14 Sept 2026')[0])
    const drawer = await screen.findByRole('dialog')

    expect(within(drawer).queryByRole('textbox')).toBeNull()
    for (const name of [/save/i, /edit/i, /delete/i, /remove/i]) {
      expect(within(drawer).queryByRole('button', { name })).toBeNull()
    }
  })
})

describe('AuditLogPage filters', () => {
  /**
   * The dropdowns are populated from the server's own distinct values. Before
   * the summary lands they must still be usable, and afterwards they must show
   * what the data actually contains rather than a guessed list.
   */
  it('fills the pickers from the server facets', async () => {
    renderPage()
    const actions = await screen.findByLabelText('Filter by action')
    await waitFor(() => expect(within(actions).getByText(/item\.update/)).toBeTruthy())
    expect(within(actions).getByText('All actions')).toBeTruthy()
  })

  /** A filter in the URL is a shareable audit query, and must survive a reload. */
  it('reads its filters from the URL and shows them as removable chips', async () => {
    renderPage('/audit-log?limit=25&entity_type=item&actor_uuid=7')
    await waitFor(() => expect(list).toHaveBeenCalled())
    const sent = list.mock.calls[0][0] as Record<string, unknown>
    expect(sent.entity_type).toBe('item')
    expect(sent.actor_uuid).toBe('7')

    expect(screen.getByText('Entity: Item')).toBeTruthy()
    expect(screen.getByText('Actor: User #7')).toBeTruthy()
  })

  it('stages the pickers until Apply, then sends them in one request', async () => {
    renderPage()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    fireEvent.change(await screen.findByLabelText('Filter by action'), {
      target: { value: 'item.update' },
    })
    // Still one request: changing a picker must not fire a query on its own.
    expect(list).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect((list.mock.calls[1][0] as Record<string, unknown>).action).toBe('item.update')
  })

  it('offers a way out of an over-narrow filter when nothing matches', async () => {
    list.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    renderPage('/audit-log?limit=25&entity_type=bom')
    await waitFor(() => expect(screen.getByText('No audit events found')).toBeTruthy())
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeTruthy()
  })
})
