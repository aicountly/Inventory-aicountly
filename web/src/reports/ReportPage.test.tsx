import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ReportPage } from './ReportPage'
import { MoreVertical } from 'lucide-react'
import { defineRegister } from '../registers/RegisterConfig'
import { MenuButton } from '../ui/MenuButton'
import { useAccess } from '../access/AccessContext'
import { buildTotalsRow, totalsLabel } from '../registers/registerTotals'
import type { ReportResponse } from '../services/reportsApi'

/*
 * End-to-end cover for the register engine: one declarative config in, a full
 * Books-language register out. Everything the engine leans on that talks to the
 * network or to a provider is stubbed; the engine's own behaviour is the
 * subject.
 */

// Typed with the key it really receives, so a test can answer differently per
// permission rather than only flipping the whole gate.
const can = vi.fn((_key?: string | readonly string[]) => true)

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [{ warehouse_id: 3, warehouse_name: 'Main store' }],
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main store',
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

interface Row {
  movement_id: number
  document_id: number | null
  document_no: string | null
  qty: number
  value: number
}

interface Summary {
  rows: number
  qty: number
  value: number
}

const ROWS: Row[] = [
  { movement_id: 1, document_id: 44, document_no: 'GRN-001', qty: 10, value: 1000 },
  { movement_id: 2, document_id: null, document_no: null, qty: -4, value: -400 },
]

const fetchSpy = vi.fn()

const demoRegister = defineRegister<Row, Summary>({
  slug: 'demo',
  path: 'demo',
  title: 'Demo register',
  description: 'A register built only from configuration',
  defaultSort: 'movement_id',
  filters: [
    { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period', defaultValue: (c) => c.fyFrom },
    { key: 'to', kind: 'date', label: 'To', hidden: true, defaultValue: (c) => c.fyTo },
    { key: 'q', kind: 'text', label: 'Search' },
  ],
  columns: [
    { key: 'document_no', header: 'Document', alwaysVisible: true },
    { key: 'qty', header: 'Qty', align: 'right', sortKey: 'qty', format: 'qty' },
    { key: 'value', header: 'Value', align: 'right', format: 'amount', amount: true },
  ],
  rowKey: (r) => r.movement_id,
  drillTo: (r) => (r.document_id ? `/documents/${r.document_id}` : null),
  totals: (s) =>
    buildTotalsRow(
      [{ key: 'document_no' }, { key: 'qty', align: 'right' }, { key: 'value', align: 'right' }],
      { qty: '6', value: '600.00' },
      { label: totalsLabel(s.rows, 'movement'), labelKey: 'document_no' },
    ),
  summary: (s) => [
    { label: 'Movements', value: String(s.rows) },
    { label: 'Net value', value: String(s.value), tone: 'good' },
  ],
})

function response(rows: Row[] = ROWS, total = rows.length): ReportResponse<Row, Summary> {
  return {
    data: rows,
    meta: { total, limit: 100, offset: 0 },
    summary: { rows: total, qty: 6, value: 600 },
    report: 'demo',
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderRegister(initial = '/registers/demo') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <LocationProbe />
      <Routes>
        <Route path="/registers/demo" element={<ReportPage config={demoRegister} />} />
        <Route path="/documents/:id" element={<p>Document screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReturnValue(true)
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(response())
  demoRegister.fetch = (args) => fetchSpy(args) as Promise<ReportResponse<Row, Summary>>
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('the register engine renders a config', () => {
  it('shows the title, the breadcrumb back to the hub and the rows', async () => {
    renderRegister()
    expect(await screen.findByText('GRN-001')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Registers' })).toBeTruthy()
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByText('Demo register')).toBeTruthy()
  })

  it('pins a totals row built from the server summary, not the page', async () => {
    // 2 rows on screen, 40 matching: the footer must speak for all 40.
    fetchSpy.mockResolvedValue(response(ROWS, 40))
    const { container } = renderRegister()
    await screen.findByText('GRN-001')
    const tfoot = container.querySelector('tfoot')
    expect(tfoot).toBeTruthy()
    expect(within(tfoot as HTMLElement).getByText('Total (40 movements)')).toBeTruthy()
    expect(within(tfoot as HTMLElement).getByText('600.00')).toBeTruthy()
  })

  it('turns the declared summary into KPI cards when the config names no kpis', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    expect(screen.getByText('Movements')).toBeTruthy()
    expect(screen.getByText('Net value')).toBeTruthy()
  })

  it('sends the resolved filter defaults to the API', async () => {
    renderRegister()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const { query } = fetchSpy.mock.calls[0][0]
    expect(query.from).toBe('2026-04-01')
    expect(query.to).toBe('2027-03-31')
    expect(query.page).toBe(1)
    expect(query.sort).toBe('movement_id')
  })

  it('reads its filters out of the URL, so a link restores the view', async () => {
    renderRegister('/registers/demo?from=2026-06-01&to=2026-06-30&q=bolt')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const { query } = fetchSpy.mock.calls[0][0]
    expect(query.from).toBe('2026-06-01')
    expect(query.to).toBe('2026-06-30')
    expect(query.q).toBe('bolt')
  })

  it('drills through to the document behind the row', async () => {
    renderRegister()
    const cell = await screen.findByText('GRN-001')
    const row = cell.closest('tr') as HTMLElement
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByText('Document screen')).toBeTruthy()
  })

  it('leaves a row with nothing to open alone', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    const rows = screen.getAllByRole('row')
    // The second data row has no document; activating it must not navigate.
    const orphan = rows[rows.length - 2]
    fireEvent.click(orphan)
    fireEvent.keyDown(orphan, { key: 'Enter' })
    expect(screen.queryByText('Document screen')).toBeNull()
  })

  it('sorts through the API and records it in the URL', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    fireEvent.click(screen.getByRole('button', { name: /Qty/ }))
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('sort=qty')
    })
  })

  it('writes both ends of the period in one navigation when a preset is picked', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    fireEvent.change(screen.getByLabelText('Period preset'), { target: { value: 'this_month' } })
    await waitFor(() => {
      const url = screen.getByTestId('location').textContent ?? ''
      // The bug this guards: two separate writes drop the "from" date.
      expect(url).toContain('from=')
      expect(url).toContain('to=')
    })
  })

  it('hides a column everywhere at once when the reader switches it off', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Value/ })).toBeNull()
    })
    // …and out of the footer with it, so the two cannot disagree.
    expect(screen.queryByText('600.00')).toBeNull()
  })

  it('offers CSV, Excel, PDF and print over the whole filtered result', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('CSV (.csv)')).toBeTruthy()
    expect(within(menu).getByText('Excel (.xlsx)')).toBeTruthy()
    expect(within(menu).getByText('PDF (.pdf)')).toBeTruthy()
  })

  it('disables export and print when there is nothing to write', async () => {
    fetchSpy.mockResolvedValue(response([], 0))
    renderRegister()
    await screen.findByText('No rows match these filters')
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so when nothing matches, rather than showing an empty grid', async () => {
    fetchSpy.mockResolvedValue(response([], 0))
    renderRegister()
    expect(await screen.findByText('No rows match these filters')).toBeTruthy()
  })

  it('does not fetch at all without the permission', async () => {
    can.mockReturnValue(false)
    renderRegister()
    expect(await screen.findByText(/do not have permission/)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('a register that needs a filter before it means anything', () => {
  const gated = defineRegister<Row, Summary>({
    ...demoRegister,
    path: 'gated',
    requireFilters: ['item_id'],
    requireFiltersMessage: 'Pick an item to run its ledger',
    filters: [{ key: 'item_id', kind: 'item', label: 'Item' }],
  })

  it('asks for it instead of running an unbounded query', async () => {
    const spy = vi.fn().mockResolvedValue(response())
    gated.fetch = (args) => spy(args) as Promise<ReportResponse<Row, Summary>>
    render(
      <MemoryRouter initialEntries={['/r']}>
        <Routes>
          <Route path="/r" element={<ReportPage config={gated} />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Pick an item to run its ledger')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('runs once the filter is supplied', async () => {
    const spy = vi.fn().mockResolvedValue(response())
    gated.fetch = (args) => spy(args) as Promise<ReportResponse<Row, Summary>>
    render(
      <MemoryRouter initialEntries={['/r?item_id=12']}>
        <Routes>
          <Route path="/r" element={<ReportPage config={gated} />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0].query.item_id).toBe('12')
  })
})

/**
 * The kebab at the end of a row.
 *
 * Its job is to make the drill-through a mouse can already do visible, so the
 * things that matter are that it lists only what the member may open and that
 * it never leaks into a file.
 */
describe('row actions', () => {
  function RowMenu() {
    const access = useAccess()
    const actions = [
      { key: 'open', label: 'Open document', onSelect: () => {} },
      ...(access.can('reports.stock_ledger.read')
        ? [{ key: 'ledger', label: 'View ledger', onSelect: () => {} }]
        : []),
    ]
    return <MenuButton actions={actions} label="Row actions" icon={MoreVertical} />
  }

  const withActions = defineRegister<Row, Summary>({
    ...demoRegister,
    rowActions: () => <RowMenu />,
  })

  function renderWithActions() {
    withActions.fetch = (args) => fetchSpy(args) as Promise<ReportResponse<Row, Summary>>
    return render(
      <MemoryRouter initialEntries={['/registers/demo']}>
        <Routes>
          <Route path="/registers/demo" element={<ReportPage config={withActions} />} />
          <Route path="/documents/:id" element={<p>Document screen</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('offers the row its actions without opening the row', async () => {
    renderWithActions()
    await screen.findByText('GRN-001')
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0])
    const menu = await screen.findByRole('menu', { name: 'Row actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Open document' })).toBeTruthy()
    // The row opens on click; the kebab must not take the reader with it.
    expect(screen.queryByText('Document screen')).toBeNull()
  })

  it('drops an action the member has no permission for', async () => {
    can.mockImplementation((key?: string | readonly string[]) => {
      const keys = typeof key === 'string' ? [key] : (key ?? [])
      return !keys.includes('reports.stock_ledger.read')
    })
    renderWithActions()
    await screen.findByText('GRN-001')
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0])
    const menu = await screen.findByRole('menu', { name: 'Row actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Open document' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitem', { name: 'View ledger' })).toBeNull()
  })

  it('keeps the kebab out of the export, which writes data and not chrome', async () => {
    renderWithActions()
    await screen.findByText('GRN-001')
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toContain('Actions')
    // Configure Columns lists what the file can carry; the kebab is not a column.
    fireEvent.click(screen.getByRole('button', { name: /^Columns/ }))
    expect(screen.queryByRole('checkbox', { name: 'Row actions' })).toBeNull()
  })

  it('adds no column at all to a register that declares none', async () => {
    renderRegister()
    await screen.findByText('GRN-001')
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull()
  })
})

