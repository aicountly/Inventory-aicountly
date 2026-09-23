import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { JobWorkSummary } from '../../services/jobWorkApi'
import type { PendingRow } from '../../services/stockApi'
import { specForCode } from '../registry'
import { JobWorkPage } from './JobWorkPage'

/*
 * The job-work screen is the one entry form in Inventory that has to answer a
 * question before it takes any input: what is already out with this worker.
 * These tests hold that promise end to end — the position is on screen, the
 * open dispatches are reachable, and picking one turns into the lines and the
 * settlements the server is actually sent.
 */

const summary: JobWorkSummary = {
  as_on: '2026-09-18',
  window: { from: '2026-09-01', to: '2026-09-18' },
  previous_window: { from: '2026-08-01', to: '2026-08-18' },
  open: { qty: 120, orders: 8, items: 5, workers: 3 },
  due: { qty: 75, orders: 4, items: 3, workers: 2 },
  overdue: { qty: 20, orders: 2, items: 1, workers: 1 },
  received: { qty: 350, value: 248500, documents: 12, lines: 30 },
  received_previous: { qty: 312, value: 210000, documents: 10, lines: 26 },
  sent: { qty: 400, value: 310000, documents: 9, lines: 22 },
  sent_previous: { qty: 380, value: 300000, documents: 8, lines: 20 },
  turnaround: { days: 6.2, samples: 14 },
  turnaround_previous: { days: 7.6, samples: 11 },
}

const pendingRow: PendingRow = {
  pending_id: 11,
  cmp_id: 1,
  fy_id: 7,
  document_id: 41,
  line_id: 91,
  pending_kind: 'job_work',
  direction: 'out',
  item_id: 90,
  item_name: 'Gear housing',
  item_sku: 'FG-001',
  hsn_sac: null,
  unit_id: 3,
  unit_symbol: 'Pcs',
  warehouse_id: 2,
  warehouse_name: 'Main',
  party_ref: 501,
  party_name: 'Shree Finishers',
  qty_original: 100,
  qty_settled: 40,
  qty_open: 60,
  unit_cost: 250,
  pending_value: 15000,
  document_no: 'JW-OUT-2026-0041',
  document_date: '2026-09-08',
  document_type: 'JOB_WORK_OUT',
  document_status: 'POSTED',
  // Promised back on the 14th and it is the 18th: the register calls this late,
  // and the drawer has to say the same thing.
  expected_return_date: '2026-09-14',
  due_date: '2026-09-14',
  has_expected_date: true,
  ageing_days: 10,
  days_overdue: 4,
  is_overdue: true,
  settlement_status: 'partial',
  status: 'overdue',
  priority: 'high',
  last_activity_at: null,
}

const summaryFn = vi.fn(async () => summary)
const pendingFn = vi.fn(async () => ({ data: [pendingRow], meta: { total: 1, limit: 500, offset: 0 } }))
const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'u' }, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 7, bo_id: 0 }, fy: null }),
}))

vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 2, warehouse_name: 'Main', warehouse_code: 'MN', is_default: 1, bo_id: 0 }],
    units: [],
    defaultWarehouseId: 2,
    warehouseName: () => 'Main',
    unitSymbol: () => 'Pcs',
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('../../services/jobWorkApi', () => ({
  jobWorkApi: {
    summary: (...args: unknown[]) => summaryFn(...(args as [])),
    workers: async () => ({ data: [], meta: { total: 0, limit: 20, offset: 0 } }),
  },
}))

vi.mock('../../services/stockApi', () => ({
  pendingApi: { list: (...args: unknown[]) => pendingFn(...(args as [])) },
  availabilityApi: { check: async () => ({ ok: true, lines: [] }) },
  shortBy: (r: { short_by?: number }) => Number(r.short_by ?? 0),
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    searchItems: async () => [],
    itemsByIds: async () => [],
    itemByBarcode: async () => null,
    batches: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
    serials: async () => ({ data: [], meta: { total: 0, limit: 0, offset: 0 } }),
  },
}))

const create = vi.fn()
vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    create: (...args: unknown[]) => create(...(args as [])),
    update: vi.fn(),
    post: vi.fn(),
    cancel: vi.fn(),
  },
  newIdempotencyKey: () => 'k',
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), notify: vi.fn() }),
}))

function renderJobWork(code: 'JOB_WORK_IN' | 'JOB_WORK_OUT' = 'JOB_WORK_IN') {
  return render(
    <MemoryRouter>
      <JobWorkPage spec={specForCode(code)!} onSaved={vi.fn()} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  create.mockReset()
  summaryFn.mockClear()
  pendingFn.mockClear()
})

describe('the job work screen says where it is', () => {
  it('names the direction in the trail, the heading and the subtitle', async () => {
    renderJobWork()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByText('Job Work')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: /New Job Work Inward/ })).toBeTruthy()
    expect(screen.getByText(/Receive finished goods from a job worker/)).toBeTruthy()
  })

  it('turns into the dispatch screen for the other type', () => {
    renderJobWork('JOB_WORK_OUT')
    expect(screen.getByRole('heading', { level: 1, name: /New Job Work Outward/ })).toBeTruthy()
    expect(screen.getByText(/Send material to a job worker/)).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /Available/ })).toBeTruthy()
  })
})

describe('the position above the form', () => {
  it('shows what is out and what came back this month', async () => {
    renderJobWork()
    expect(await screen.findByText('With job workers')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('8 job orders')).toBeTruthy()
    expect(screen.getByText('6.2 days')).toBeTruthy()
  })

  it('keeps the form usable when the position cannot be read', async () => {
    summaryFn.mockRejectedValueOnce(new Error('upstream is down'))
    renderJobWork()
    expect(await screen.findByText(/You can still enter and post this document/)).toBeTruthy()
    // The grid, and therefore data entry, is untouched by that failure.
    expect(screen.getByRole('columnheader', { name: /Receive qty/ })).toBeTruthy()
  })
})

describe('validation', () => {
  it('will not save a receipt with nobody holding the goods', async () => {
    renderJobWork()
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/ }))
    expect(await screen.findByText('Job worker is required.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('settling what is pending', () => {
  it('lists the open dispatch with how much of it is already back', async () => {
    renderJobWork()
    fireEvent.click(screen.getByRole('button', { name: /View pending/ }))
    const drawer = await screen.findByRole('dialog')
    const group = within(drawer).getByRole('link', { name: 'JW-OUT-2026-0041' }).closest('section')
    expect(group).not.toBeNull()
    // Late, and half back — both read off the dispatch, not off the row.
    expect(within(group as HTMLElement).getByText('Overdue')).toBeTruthy()
    expect(within(group as HTMLElement).getByText('40 of 100 back')).toBeTruthy()
  })

  it('turns a tick into a consumed line and a settlement on the document', async () => {
    renderJobWork()
    fireEvent.click(screen.getByRole('button', { name: /View pending/ }))
    const drawer = await screen.findByRole('dialog')
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /Settle Gear housing/ }))
    fireEvent.click(within(drawer).getByRole('button', { name: /Apply to document/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(/Settling 1 pending quantity/)).toBeTruthy()
    // 60 was still open, so 60 is what the receipt settles and consumes.
    expect(screen.getByText(/60 consumed/)).toBeTruthy()
    expect(screen.getByDisplayValue('60')).toBeTruthy()
  })

  it('offers the dispatch screen a read-only view of the same position', async () => {
    renderJobWork('JOB_WORK_OUT')
    // The header button and the assistant's quick action open the same panel.
    fireEvent.click(screen.getAllByRole('button', { name: /Open job orders/ })[0])
    const drawer = await screen.findByRole('dialog')
    // Awaited, not queried: findByRole resolves the moment the dialog EXISTS, which is before the
    // position inside it has finished rendering. On a loaded runner the synchronous lookup ran in
    // that gap and failed on an empty drawer.
    expect(await within(drawer).findByText('JW-OUT-2026-0041')).toBeTruthy()
    expect(within(drawer).queryByRole('checkbox')).toBeNull()
    expect(within(drawer).queryByRole('button', { name: /Apply to document/ })).toBeNull()
  })
})

describe('permissions', () => {
  it('hides Save & post from someone who may not post', () => {
    can.mockImplementation((key) => {
      const keys = Array.isArray(key) ? key : [key as string]
      return !keys.some((k) => k.includes('.post'))
    })
    renderJobWork()
    expect(screen.queryByRole('button', { name: /Save & post/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeTruthy()
  })
})
