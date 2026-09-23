import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CrudApi } from '../services/masters'
import type { ListQuery } from '../services/api'
import type { MasterConfig } from './types'
import { pickExport, clickPrint } from '../test/exportMenu'

/**
 * Every master screen in Inventory renders through `MasterPage`, and until this
 * change not one of them could produce a file or a printed sheet. These tests
 * hold the two properties that make the new buttons worth having:
 *
 *  1. the export walks the WHOLE filtered result, not the page on screen;
 *  2. Ctrl+P and the Print button produce the letterheaded sheet — company,
 *     scope and all — rather than the browser's picture of the app.
 */

interface SheetPayload {
  title: string
  companyName?: string
  scopeLabel?: string
  gstin?: string
  rows: Record<string, { text: string; value: unknown }>[]
  columns: { key: string; label: string }[]
  metaLines?: string[]
}

const exportTabularExcel = vi.fn(async (_p: SheetPayload) => {})
const exportTabularPdf = vi.fn(async (_p: SheetPayload) => {})
const printTabular = vi.fn((_p: SheetPayload) => true)
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('../export/documentExport', () => ({
  exportTabularExcel: (p: SheetPayload) => exportTabularExcel(p),
  exportTabularPdf: (p: SheetPayload) => exportTabularPdf(p),
  printTabular: (p: SheetPayload) => printTabular(p),
}))

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>()
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv) }
})

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: ['12 Industrial Estate', 'Pune 411 019'],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))

vi.mock('../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const { MasterPage } = await import('./MasterPage')

interface Warehouse {
  warehouse_id: number
  warehouse_name: string
  warehouse_type: string
  is_active: number
  updated_at: string
}

/** 30 warehouses: more than the 25 the screen shows, so the two can differ. */
const ALL: Warehouse[] = Array.from({ length: 30 }, (_, i) => ({
  warehouse_id: i + 1,
  warehouse_name: `Warehouse ${String(i + 1).padStart(2, '0')}`,
  warehouse_type: i % 2 === 0 ? 'standard' : 'bonded',
  is_active: i === 29 ? 0 : 1,
  updated_at: '2026-09-14 11:02:30',
}))

const listCalls: ListQuery[] = []

const api: CrudApi<Warehouse> = {
  list: async (query = {}) => {
    listCalls.push(query)
    const limit = Number(query.limit ?? 50)
    const page = Number(query.page ?? 1)
    const type = query.warehouse_type ? String(query.warehouse_type) : ''
    const matching = type ? ALL.filter((w) => w.warehouse_type === type) : ALL
    const offset = (page - 1) * limit
    return { data: matching.slice(offset, offset + limit), meta: { total: matching.length, limit, offset } }
  },
  get: async () => ALL[0],
  create: async () => ALL[0],
  update: async () => ALL[0],
  remove: async () => {},
}

const config: MasterConfig<Warehouse> = {
  slug: 'warehouses',
  permissionSlug: 'warehouses',
  title: 'Warehouses',
  singular: 'Warehouse',
  idKey: 'warehouse_id',
  nameOf: (r) => r.warehouse_name,
  api,
  defaultSort: 'warehouse_name',
  needsFormOptions: false,
  filters: [
    {
      name: 'warehouse_type',
      label: 'Type',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'bonded', label: 'Bonded' },
      ],
    },
  ],
  columns: [
    { key: 'warehouse_name', header: 'Warehouse' },
    { key: 'warehouse_type', header: 'Type', exportValue: (r) => (r.warehouse_type === 'bonded' ? 'Bonded' : 'Standard') },
    { key: 'is_active', header: 'Status' },
    { key: 'updated_at', header: 'Updated' },
  ],
  fields: [],
}

function renderPage(url = '/masters/warehouses?limit=25') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MasterPage config={config} />
    </MemoryRouter>,
  )
}

/** The screen has finished its first load when the first row is on it. */
async function waitForRows() {
  await waitFor(() => expect(screen.getByText('Warehouse 01')).toBeTruthy())
}

beforeEach(() => {
  listCalls.length = 0
  exportTabularExcel.mockClear()
  exportTabularPdf.mockClear()
  printTabular.mockClear()
  downloadCsv.mockClear()
})

describe('MasterPage exports', () => {
  it('offers the register export menu and a print button on a master screen', async () => {
    renderPage()
    await waitForRows()
    const exportButton = screen.getByRole('button', { name: /export/i })
    expect(exportButton).toBeTruthy()
    expect(screen.getByRole('button', { name: /print/i })).toBeTruthy()
    fireEvent.click(exportButton)
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
    expect(labels[0]).toContain('CSV')
    expect(labels[1]).toContain('Excel')
    expect(labels[2]).toContain('PDF')
  })

  it('writes every matching row, not the page on screen', async () => {
    renderPage()
    await waitForRows()
    // The table holds 25 of the 30; the file must hold all 30.
    expect(screen.queryByText('Warehouse 30')).toBeNull()

    await pickExport(/CSV/)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const [filename, csv] = downloadCsv.mock.calls[0]
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(31)
    expect(lines[0]).toBe('Warehouse,Type,Status,Updated')
    expect(lines[30]).toContain('Warehouse 30')
    expect(filename).toBe('warehouses-acme-ltd-' + new Date().toISOString().slice(0, 10) + '.csv')
  })

  it('exports what the filters select, and says which filters made the file', async () => {
    renderPage('/masters/warehouses?limit=25&warehouse_type=bonded')
    await waitFor(() => expect(screen.getByText('Warehouse 02')).toBeTruthy())

    await pickExport(/Excel/)
    await waitFor(() => expect(exportTabularExcel).toHaveBeenCalledOnce())

    const payload = exportTabularExcel.mock.calls[0][0]
    expect(payload.rows).toHaveLength(15)
    expect(payload.metaLines).toContain('Type: Bonded')
    expect(payload.metaLines).toContain('Rows: 15')
    // Every request the export made carried the filter.
    const exportRequests = listCalls.filter((q) => Number(q.limit) > 25)
    expect(exportRequests.length).toBeGreaterThan(0)
    for (const request of exportRequests) expect(request.warehouse_type).toBe('bonded')
  })

  it('prints a letterheaded sheet from Ctrl+P, not the browser view of the page', async () => {
    renderPage()
    await waitForRows()

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.title).toBe('Warehouses')
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.scopeLabel).toBe('Acme Ltd · FY 2026-27 · All branches')
    expect(sheet.gstin).toBe('27AAAAA0000A1Z5')
    expect(sheet.rows).toHaveLength(30)
    expect(sheet.columns.map((c) => c.label)).toEqual(['Warehouse', 'Type', 'Status', 'Updated'])
  })

  it('prints the same sheet from the Print button', async () => {
    renderPage()
    await waitForRows()
    await clickPrint()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
    expect(printTabular.mock.calls[0][0].rows).toHaveLength(30)
  })

  it('resolves cells the way the table renders them, never the raw field', async () => {
    renderPage()
    await waitForRows()
    await pickExport(/PDF/)
    await waitFor(() => expect(exportTabularPdf).toHaveBeenCalledOnce())

    const rows = exportTabularPdf.mock.calls[0][0].rows
    expect(rows[0].warehouse_name.text).toBe('Warehouse 01')
    expect(rows[0].warehouse_type.text).toBe('Standard')
    // `is_active` is 1 / 0 in the API. A sheet that printed the digit would be
    // a column the reader has to decode.
    expect(rows[0].is_active.text).toBe('Active')
    expect(rows[29].is_active.text).toBe('Inactive')
    // ... and the timestamp is formatted, not the raw `2026-09-14 11:02:30`.
    expect(rows[0].updated_at.text).toMatch(/^14 \w+\.? 2026, 11:02$/)
  })
})
