import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AuditLogRow } from '../../services/auditApi'

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

vi.mock('../../services/auditApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditApi')>()
  return { ...actual, auditApi: { ...actual.auditApi, list: (...args: unknown[]) => list(...args) } }
})

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
  list.mockReset()
  list.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
})

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/audit-log?limit=25']}>
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
