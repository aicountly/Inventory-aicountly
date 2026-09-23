import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AckResult, RevisionSummary, ValuationRevision } from '../../services/valuationApi'
import { pickExport, clickPrint } from '../../test/exportMenu'

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  footerNotes?: string[]
  metaLines?: string[]
}

const printTabular = vi.fn((_p: SheetPayload) => true)
const exportTabularExcel = vi.fn(async (_p: SheetPayload) => {})
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})
const toastSuccess = vi.fn()
const toastError = vi.fn()

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
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 4, warehouse_name: 'Main store', bo_id: 0, is_default: 1 }],
    units: [],
    defaultWarehouseId: 4,
    warehouseName: () => 'Main store',
    unitSymbol: () => 'KG',
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    get: async () => ({ base_currency_code: 'INR' }),
    documentTypes: async () => [
      { code: 'purchase', label: 'Purchase', line_mode: 'in', valuation: true, cogs: false, native: true, legacy_vch_type: null },
    ],
  },
}))

const revisions = vi.fn()
const revisionsSummary = vi.fn()
const ackRevisions = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return {
    ...actual,
    valuationApi: {
      ...actual.valuationApi,
      revisions: (...args: unknown[]) => revisions(...args),
      revisionsSummary: (...args: unknown[]) => revisionsSummary(...args),
      ackRevisions: (...args: unknown[]) => ackRevisions(...args),
    },
  }
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

/** 30 revisions: more than one page of 25. #2 has already been applied in Books. */
const ALL = Array.from({ length: 30 }, (_, i) => {
  const r = revision(i + 1)
  if (r.revision_id === 2) {
    return { ...r, acknowledged: true, acknowledged_at: '2026-09-01 12:00:00', acknowledged_by_app: 'books' }
  }
  return r
})

function summary(over: Partial<RevisionSummary> = {}): RevisionSummary {
  const totals = {
    revisions: 30,
    net_delta: 3525,
    abs_delta: 3525,
    increased: 30,
    decreased: 0,
    unchanged: 0,
    items_affected: 1,
    items_increased: 1,
    items_decreased: 0,
    jobs: 1,
    acknowledged: 1,
    published_unacknowledged: 29,
    awaiting_publish: 0,
  }
  return {
    window: { from: '2026-08-23', to: '2026-09-01', days: 10, explicit_range: false, previous_from: '2026-08-13', previous_to: '2026-08-22' },
    filtered: totals,
    previous: { ...totals, revisions: 10 },
    company: {
      revisions: 40,
      acknowledged: 28,
      pending: 12,
      pending_delta: 4800,
      awaiting_publish: 0,
      published_unacknowledged: 12,
      created_last_7d: 9,
      created_prev_7d: 6,
      acknowledged_today: 28,
      acknowledged_yesterday: 16,
    },
    jobs: { queued: 2, running: 1, failed: 0 },
    timeline: [{ day: '2026-09-01', revisions: 30, increased: 30, decreased: 0, net_delta: 3525 }],
    by_source: [{ document_type: 'delivery_note', revisions: 30, net_delta: 3525, abs_delta: 3525 }],
    top_items: [
      {
        item_id: 12,
        item_name: 'Widget A',
        item_sku: 'W-A',
        revisions: 30,
        net_delta: 3525,
        abs_delta: 3525,
        peak_change_pct: 11,
        baseline_pct: 10,
        baseline_samples: 12,
      },
    ],
    baseline_days: 30,
    triggers: [{ trigger_kind: 'backdated_document', jobs: 1, revisions: 30, net_delta: 3525, abs_delta: 3525 }],
    ...over,
  }
}

const ACK_OK: AckResult = {
  acknowledged: 1,
  already_acknowledged: 0,
  unknown_revision_ids: [],
  acknowledged_by_app: 'inventory',
  acknowledged_at: '2026-09-01 13:00:00',
}

beforeEach(() => {
  printTabular.mockClear()
  exportTabularExcel.mockClear()
  downloadCsv.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
  revisions.mockReset()
  revisionsSummary.mockReset()
  ackRevisions.mockReset()
  revisions.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: ALL.slice(offset, offset + limit), meta: { total: ALL.length, limit, offset } }
  })
  revisionsSummary.mockImplementation(async () => summary())
  ackRevisions.mockResolvedValue(ACK_OK)
})

function renderPage(entry = '/valuation/revisions?limit=25') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <RevisionsPage />
    </MemoryRouter>,
  )
}

const ready = () => waitFor(() => expect(screen.getByText('DN-1')).toBeTruthy())

describe('RevisionsPage exports', () => {
  /**
   * Books owns the commercial rate and amount; Inventory owns the valuation.
   * On this screen every figure is a valuation figure, and a sheet that headed
   * one of them "Old rate" invites a reader to take it for a price.
   */
  it('names every money column as a valuation figure, on screen and in the file', async () => {
    renderPage()
    await ready()
    for (const header of ['Old valuation rate', 'New valuation rate', 'Old valuation amount', 'New valuation amount', 'Valuation delta']) {
      expect(screen.getByRole('columnheader', { name: header }), header).toBeTruthy()
    }

    await pickExport(/CSV/)
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

  /**
   * The revision number is the reference an operator quotes back to Books when a COGS
   * re-posting is queried. It was on the screen this one replaced, and a rebuild that
   * quietly dropped it would make that conversation impossible from the grid.
   */
  it('keeps the revision number on the grid, sortable, and opens the row from it', async () => {
    renderPage()
    await ready()
    const header = screen.getByRole('columnheader', { name: '#' })
    expect(header).toBeTruthy()
    expect(within(header).getByRole('button')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open revision 1' }))
    await waitFor(() => expect(screen.getByText('Revision #1')).toBeTruthy())
  })

  it('writes every matching revision, not the page on screen, and says so on paper', async () => {
    renderPage()
    await ready()
    expect(screen.queryByText('DN-30')).toBeNull()

    await pickExport(/Excel/)
    await waitFor(() => expect(exportTabularExcel).toHaveBeenCalledOnce())
    const payload = exportTabularExcel.mock.calls[0][0]
    expect(payload.rows).toHaveLength(30)
    expect(payload.footerNotes?.join(' ')).toContain('valuation figure')
  })

  it('prints the letterheaded sheet from the Print button', async () => {
    renderPage()
    await ready()
    await clickPrint()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Valuation revisions')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.rows).toHaveLength(30)
    // "Awaiting Books" is what the badge says; the sheet must not print `false`.
    expect(sheet.rows[0].books_state.text).toBe('Published to Books')
  })

  it('prints the filters the figures were read under', async () => {
    renderPage()
    await ready()
    await clickPrint()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    expect(printTabular.mock.calls[0][0].metaLines).toContain('Books: Awaiting Books')
  })
})

describe('RevisionsPage summary', () => {
  it('reads its KPIs from the server aggregate, not from the rows on screen', async () => {
    renderPage()
    await ready()
    // 12 company-wide pending, though only 25 rows were fetched and 30 match. Scoped to the
    // KPI strip, because "12" is also a revision number down in the grid.
    const kpis = screen.getByRole('region', { name: 'Valuation revision summary' })
    expect(within(kpis).getByText('Pending revisions')).toBeTruthy()
    expect(within(kpis).getByText('12')).toBeTruthy()
    expect(within(kpis).getByText('Acknowledged today')).toBeTruthy()
    const [call] = revisionsSummary.mock.calls[0] as [Record<string, unknown>]
    // A summary of "page 2" is not a summary.
    expect(call.page).toBeUndefined()
    expect(call.limit).toBeUndefined()
  })

  it('keeps the table usable when the summary fails', async () => {
    revisionsSummary.mockRejectedValue(new Error('boom'))
    renderPage()
    await ready()
    expect(screen.getByText(/summary figures could not be loaded/i)).toBeTruthy()
    // The rows are unaffected.
    expect(screen.getByText('DN-3')).toBeTruthy()
  })

  it('never claims a trend it cannot measure', async () => {
    renderPage()
    await ready()
    // With no explicit date range the net-impact card states the gross movement instead of
    // comparing two periods that are not comparable.
    expect(screen.getByText('3,525.00 gross movement')).toBeTruthy()
  })
})

describe('RevisionsPage acknowledgement', () => {
  it('offers no checkbox for a revision Books has already applied', async () => {
    renderPage()
    await ready()
    expect(screen.getByLabelText('Select revision 1')).toBeTruthy()
    expect(screen.queryByLabelText('Select revision 2')).toBeNull()
  })

  it('counts only eligible rows when everything on the page is selected', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText(/Select every revision on this page/))
    // 25 rows on the page, one of them already applied.
    expect(screen.getByRole('button', { name: 'Acknowledge selected (24)' })).toBeTruthy()
  })

  it('confirms before acknowledging, and posts only the eligible ids', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge selected (1)' }))

    await waitFor(() => expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy())
    expect(ackRevisions).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge 1 revision$/ }))
    await waitFor(() => expect(ackRevisions).toHaveBeenCalledWith([1]))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('reports a partial acknowledgement as a failure rather than a success', async () => {
    ackRevisions.mockResolvedValue({ ...ACK_OK, acknowledged: 0, unknown_revision_ids: [1] })
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge selected (1)' }))
    await waitFor(() => expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge 1 revision$/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(String(toastError.mock.calls[0][0])).toContain('could not be found')
    // The row is still on screen: nothing is hidden on the strength of a half-known outcome.
    expect(screen.getByText('DN-1')).toBeTruthy()
  })

  it('keeps the dialog open and says why when the API refuses', async () => {
    ackRevisions.mockRejectedValue(new Error('Period is locked'))
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge selected (1)' }))
    await waitFor(() => expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge 1 revision$/ }))

    await waitFor(() => expect(screen.getByText('Period is locked')).toBeTruthy())
    expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy()
  })

  it('cannot post the same acknowledgement twice', async () => {
    let release: (v: AckResult) => void = () => {}
    ackRevisions.mockImplementation(() => new Promise<AckResult>((resolve) => {
      release = resolve
    }))
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge selected (1)' }))
    await waitFor(() => expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy())

    const confirm = screen.getByRole('button', { name: /Acknowledge 1 revision/ })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(ackRevisions).toHaveBeenCalledTimes(1)
    release(ACK_OK)
  })

  it('acknowledging one row from its detail panel leaves the rest of the selection alone', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 3'))
    expect(screen.getByRole('button', { name: 'Acknowledge selected (1)' })).toBeTruthy()

    const row = screen.getByText('DN-1').closest('tr')
    expect(row).toBeTruthy()
    fireEvent.doubleClick(row as HTMLElement)
    await waitFor(() => expect(screen.getByText('Revision #1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge revision' }))
    await waitFor(() => expect(screen.getByText('Acknowledge selected revisions?')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Acknowledge 1 revision$/ }))

    await waitFor(() => expect(ackRevisions).toHaveBeenCalledWith([1]))
    // Revision 3 was never part of this acknowledgement and is still ticked.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acknowledge selected (1)' })).toBeTruthy())
  })

  it('warns when a selected revision has never been published to Books', async () => {
    revisions.mockImplementation(async () => ({
      data: [{ ...revision(1), published_at: null }],
      meta: { total: 1, limit: 25, offset: 0 },
    }))
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge selected (1)' }))
    await waitFor(() => expect(screen.getByText(/have never been sent|has never been sent/i)).toBeTruthy())
  })
})

describe('RevisionsPage empty states', () => {
  it('distinguishes "nothing matches" from "nothing exists"', async () => {
    revisions.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    renderPage()
    await waitFor(() => expect(screen.getByText('No revisions match these filters')).toBeTruthy())
    expect(screen.getByText(/Try widening the Books status/)).toBeTruthy()
    expect(screen.queryByText('No valuation revisions yet')).toBeNull()
  })

  it('offers a recalculation when the company has no revisions at all', async () => {
    revisions.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 25, offset: 0 } }))
    revisionsSummary.mockImplementation(async () =>
      summary({
        company: { ...summary().company, revisions: 0, acknowledged: 0, pending: 0 },
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('No valuation revisions yet')).toBeTruthy())
    expect(screen.getByText(/generated by a back-dated recalculation/)).toBeTruthy()
    expect(screen.queryByText('No revisions match these filters')).toBeNull()
  })
})

describe('RevisionsPage filters', () => {
  it('asks the API for the books state the reader chose, with the legacy flag alongside', async () => {
    renderPage()
    await ready()
    const [first] = revisions.mock.calls[0] as [Record<string, unknown>]
    expect(first.books).toBe('unacknowledged')
    expect(first.acknowledged).toBe('0')
  })

  it('drops a selection when the filters change under it', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByLabelText('Select revision 1'))
    expect(screen.getByRole('button', { name: 'Acknowledge selected (1)' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Movement'), { target: { value: 'increase' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acknowledge selected (0)' })).toBeTruthy())
  })
})
