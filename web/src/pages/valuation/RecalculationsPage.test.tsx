import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RecalcJob, RecalcSummary } from '../../services/valuationApi'

/*
 * The register's behaviour, not its pixels: what it shows for each status, what
 * it refuses to show when the server has not measured it yet, which actions it
 * offers, and that starting a recalculation sends exactly one job with an
 * idempotency key.
 */

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: null,
    logo: null,
    fy: { fyId: 3, label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

let canRecalculate = true
vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null }),
  useCan: () => canRecalculate,
}))

vi.mock('../../ui/ToastContext', () => ({ useToast: () => toast }))

// The warehouse list behind the advanced filters; not the subject of these tests.
vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 4, warehouse_name: 'Mumbai', warehouse_code: 'MUM', bo_id: 0, is_default: 0 }],
    units: [],
    defaultWarehouseId: null,
    warehouseName: (id: number) => (id === 4 ? 'Mumbai' : `Warehouse #${id}`),
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

const settingsGet = vi.fn()
vi.mock('../../services/settingsApi', () => ({
  settingsApi: { get: (...a: unknown[]) => settingsGet(...a) },
}))

const recalcJobs = vi.fn()
const recalcSummary = vi.fn()
const recalcJob = vi.fn()
const enqueueRecalc = vi.fn()
const runRecalc = vi.fn()
const cancelRecalc = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return {
    ...actual,
    valuationApi: {
      ...actual.valuationApi,
      recalcJobs: (...a: unknown[]) => recalcJobs(...a),
      recalcSummary: (...a: unknown[]) => recalcSummary(...a),
      recalcJob: (...a: unknown[]) => recalcJob(...a),
      enqueueRecalc: (...a: unknown[]) => enqueueRecalc(...a),
      runRecalc: (...a: unknown[]) => runRecalc(...a),
      cancelRecalc: (...a: unknown[]) => cancelRecalc(...a),
    },
  }
})

const { RecalculationsPage } = await import('./RecalculationsPage')

function job(over: Partial<RecalcJob> = {}): RecalcJob {
  return {
    job_id: 11,
    job_uuid: 'uuid-11',
    cmp_id: 1,
    fy_id: 3,
    item_id: null,
    warehouse_id: null,
    from_date: '2026-07-01',
    to_date: null,
    trigger_kind: 'backdated_document',
    trigger_document_id: null,
    status: 'COMPLETED',
    dry_run: false,
    affected_line_count: 318,
    revised_line_count: 306,
    cogs_delta: 48620,
    failure_reason: null,
    remarks: null,
    requested_by: 'user-a',
    cancelled_by: null,
    created_at: '2026-09-18 14:00:00',
    started_at: '2026-09-18 14:30:00',
    finished_at: '2026-09-18 14:32:00',
    item_name: null,
    item_sku: null,
    warehouse_name: null,
    trigger_document_no: null,
    trigger_document_type: null,
    affected_document_ids: [],
    ...over,
  }
}

const SUMMARY: RecalcSummary = {
  total: 12,
  by_status: { QUEUED: 1, RUNNING: 0, COMPLETED: 10, FAILED: 1, CANCELLED: 0 },
  in_progress: 1,
  cogs_delta: 248320,
  queued_this_month: 3,
  queued_prev_month: 2,
  cogs_delta_this_month: 60000,
  cogs_delta_prev_month: 53000,
  month_start: '2026-09-01',
  ignores_status_filter: true,
}

function list(rows: RecalcJob[], total = rows.length) {
  return { data: rows, meta: { total, limit: 50, offset: 0 } }
}

function mount(initialPath = '/valuation/recalculations') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RecalculationsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  canRecalculate = true
  settingsGet.mockResolvedValue({ base_currency_code: 'INR', default_valuation_method: 'FIFO', cogs_revision_mode: 'inline' })
  recalcSummary.mockResolvedValue(SUMMARY)
  recalcJobs.mockResolvedValue(list([job()]))
  recalcJob.mockImplementation(async (id: number) => job({ job_id: id }))
})

describe('the recalculation register', () => {
  it('shows the server’s figures on the cards, not the page’s', async () => {
    mount()
    // 10 completed of 11 that reached an outcome — the queued job is not counted
    // against the rate, and none of this is derived from the single row served.
    expect(await screen.findByText('91% success rate')).toBeTruthy()
    // Whole rupees on the card — the paise are noise at that size — and the
    // month's own figure beside it rather than a coloured up/down chip, which
    // would read as "a bigger COGS delta is good news".
    expect(screen.getByText('₹ 2,48,320')).toBeTruthy()
    expect(screen.getByText('₹ 60,000 this month')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })

  it('prints a job the way the export does — padded reference, signed delta', async () => {
    mount()
    expect(await screen.findByText('RC-00011')).toBeTruthy()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Completed')).toBeTruthy()
    expect(table.getByText('Live run')).toBeTruthy()
    expect(table.getByText('All items')).toBeTruthy()
    expect(table.getByText('Back-dated document')).toBeTruthy()
    expect(table.getByText('₹ 48,620.00')).toBeTruthy()
  })

  it('refuses to print counts for a job that has not measured any', async () => {
    recalcJobs.mockResolvedValue(
      list([job({ job_id: 12, status: 'RUNNING', affected_line_count: 0, revised_line_count: 0, cogs_delta: 0, finished_at: null })]),
    )
    mount()
    expect(await screen.findByText('RC-00012')).toBeTruthy()
    // Neither a zero nor an invented percentage: a running job has reported
    // nothing, so the counts, the delta and any "62%" are all absent from the row.
    const table = within(screen.getByRole('table'))
    expect(table.queryByText('₹ 0.00')).toBeNull()
    expect(table.queryByText(/\d%/)).toBeNull()
    expect(table.getByText('Running')).toBeTruthy()
    // An indeterminate bar — it reports that work is happening, not how far along.
    const bar = screen.getByRole('progressbar', { name: 'Recalculation in progress' })
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
  })

  it('offers cancel only on a queued job and retry only on a failed one', async () => {
    recalcJobs.mockResolvedValue(
      list([
        job({ job_id: 20, status: 'QUEUED', finished_at: null }),
        job({ job_id: 21, status: 'FAILED', failure_reason: 'Refusing to recalculate: 2 inward line(s) carry no cost to replay.' }),
        job({ job_id: 22, status: 'COMPLETED' }),
      ]),
    )
    mount()
    await screen.findByText('RC-00020')

    fireEvent.click(screen.getByRole('button', { name: 'More actions for RC-00020' }))
    expect(screen.getByRole('menuitem', { name: 'Run now' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Cancel job' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Retry recalculation' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'More actions for RC-00021' }))
    expect(screen.getByRole('menuitem', { name: 'Retry recalculation' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Cancel job' })).toBeNull()
  })

  it('shortens a failure without hiding that it failed', async () => {
    recalcJobs.mockResolvedValue(
      list([job({ status: 'FAILED', failure_reason: 'Refusing to recalculate: 2 inward line(s) carry no cost to replay (line_id 4, 5).' })]),
    )
    mount()
    expect(await screen.findByText('Unpriced inward lines')).toBeTruthy()
  })

  it('hides every data-changing action from a reader who may not recalculate', async () => {
    canRecalculate = false
    recalcJobs.mockResolvedValue(list([job({ job_id: 20, status: 'QUEUED', finished_at: null })]))
    mount()
    await screen.findByText('RC-00020')
    expect(screen.queryByRole('button', { name: /New recalculation/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions for RC-00020' })).toBeNull()
  })

  it('separates “nothing here yet” from “nothing matches your filters”', async () => {
    recalcJobs.mockResolvedValue(list([], 0))
    const { unmount } = mount()
    expect(await screen.findByText('No recalculation jobs yet')).toBeTruthy()
    unmount()

    mount('/valuation/recalculations?status=FAILED')
    expect(await screen.findByText('No recalculations match your filters.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('keeps the register readable when the jobs call fails', async () => {
    recalcJobs.mockRejectedValue(new Error('Gateway timeout'))
    mount()
    expect(await screen.findByText('Unable to load valuation recalculations.')).toBeTruthy()
    // The page shell survives — this is not a whole-app error screen.
    expect(screen.getByRole('heading', { name: 'Valuation recalculations' })).toBeTruthy()
  })

  it('shows the jobs even when the summary endpoint is the thing that broke', async () => {
    recalcSummary.mockRejectedValue(new Error('nope'))
    mount()
    expect(await screen.findByText('RC-00011')).toBeTruthy()
    // No zero is printed for a count that could not be fetched.
    expect(screen.getAllByText('Figure unavailable').length).toBeGreaterThan(0)
  })

  it('applies the status filter the dashboard links to', async () => {
    mount('/valuation/recalculations?status=QUEUED,RUNNING')
    await screen.findByText('RC-00011')
    const [, filters] = recalcJobs.mock.calls[0] as [unknown, unknown]
    void filters
    expect((recalcJobs.mock.calls[0][0] as Record<string, unknown>).status).toBe('QUEUED,RUNNING')
  })
})

describe('starting a recalculation', () => {
  it('will not submit a live run without a reason, and sends one idempotency key when it does', async () => {
    enqueueRecalc.mockResolvedValue(job({ job_id: 13, status: 'QUEUED', dry_run: false, finished_at: null }))
    mount()
    await screen.findByText('RC-00011')

    fireEvent.click(screen.getByRole('button', { name: /New recalculation/ }))
    expect(await screen.findByText('New valuation recalculation')).toBeTruthy()

    // Switch to a live run: the reason becomes required and the whole-company
    // acknowledgement appears.
    fireEvent.click(screen.getByRole('tab', { name: 'Live run' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start recalculation' }))
    expect(await screen.findByText(/Give the reason for this restatement/)).toBeTruthy()
    expect(enqueueRecalc).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'Supplier revised the July invoice.' },
    })
    fireEvent.click(screen.getByLabelText(/I understand this live run covers/))
    fireEvent.click(screen.getByRole('button', { name: 'Start recalculation' }))

    await waitFor(() => expect(enqueueRecalc).toHaveBeenCalledTimes(1))
    const [payload, key] = enqueueRecalc.mock.calls[0] as [Record<string, unknown>, string]
    expect(payload.dry_run).toBe(false)
    expect(payload.item_id).toBeNull()
    expect(payload.remarks).toBe('Supplier revised the July invoice.')
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(8)
  })

  it('defaults to the dry run, which needs no reason', async () => {
    enqueueRecalc.mockResolvedValue(job({ job_id: 14, status: 'COMPLETED', dry_run: true }))
    mount()
    await screen.findByText('RC-00011')

    fireEvent.click(screen.getByRole('button', { name: /New recalculation/ }))
    await screen.findByText('New valuation recalculation')
    fireEvent.click(screen.getByRole('button', { name: 'Start dry run' }))

    await waitFor(() => expect(enqueueRecalc).toHaveBeenCalledTimes(1))
    expect((enqueueRecalc.mock.calls[0][0] as Record<string, unknown>).dry_run).toBe(true)
  })
})

describe('cancelling a job', () => {
  it('asks first, then calls the endpoint that only accepts a queued job', async () => {
    recalcJobs.mockResolvedValue(list([job({ job_id: 20, status: 'QUEUED', finished_at: null })]))
    cancelRecalc.mockResolvedValue(job({ job_id: 20, status: 'CANCELLED' }))
    mount()
    await screen.findByText('RC-00020')

    fireEvent.click(screen.getByRole('button', { name: 'More actions for RC-00020' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel job' }))
    expect(await screen.findByText('Cancel RC-00020?')).toBeTruthy()
    expect(cancelRecalc).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }))
    await waitFor(() => expect(cancelRecalc).toHaveBeenCalledWith(20))
  })
})
