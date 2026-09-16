import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ListResponse } from '../services/api'
import type { DocumentListRow } from './types'

/*
 * `/documents` is where Books hands a register over
 * (inventoryHistoricalRegisters.js links `/documents?document_type=<CODE>`).
 * Before this change the screen a user landed on had no export, no print, no
 * KPI strip, no totals and no column configuration — strictly less than the
 * Books register they had just left. These tests hold every one of those.
 */

const can = vi.fn<(key: string | readonly string[]) => boolean>(() => true)
const list = vi.fn<(query: Record<string, unknown>) => Promise<ListResponse<DocumentListRow>>>()
const bulkPrintDocuments = vi.fn(async (_ids: readonly number[]) => ({
  printed: _ids.length,
  failures: [] as { documentId: number; reason: string }[],
  opened: true,
}))
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
    fy: { label: 'FY 2026-27' },
    branch: null,
  }),
}))

vi.mock('../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can,
    loading: false,
    member: { uuid: 'user-a' },
    profile: { profile_name: 'Owner', template_key: 'owner' },
  }),
  useCan: () => true,
}))

vi.mock('../services/documentsApi', () => ({
  documentsApi: { list: (query: Record<string, unknown>) => list(query) },
}))

vi.mock('./useReferenceData', () => ({
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
  useDocumentTypeOptions: () => ({
    options: [
      { value: 'STOCK_TRANSFER', label: 'Stock Transfer' },
      { value: 'DELIVERY_CHALLAN', label: 'Delivery Challan / Dispatch' },
    ],
    loading: false,
  }),
}))

vi.mock('./printDocument', () => ({
  bulkPrintDocuments: (ids: readonly number[]) => bulkPrintDocuments(ids),
}))

const exportTabularPdf = vi.fn(async (_payload: unknown) => {})

vi.mock('../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: (payload: unknown) => exportTabularPdf(payload),
  printTabular: vi.fn(() => true),
  printHtmlDocument: vi.fn(() => true),
}))

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>()
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv) }
})

const { DocumentsListPage } = await import('./DocumentsListPage')

function row(overrides: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    document_id: 101,
    document_uuid: 'uuid-101',
    document_type: 'STOCK_TRANSFER',
    document_type_label: 'Stock Transfer',
    document_no: 'ST-0101',
    document_date: '2026-06-01',
    status: 'POSTED',
    source_app: 'inventory',
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: null,
    party_name: null,
    from_warehouse_id: 3,
    to_warehouse_id: 4,
    narration: null,
    posted_at: '2026-06-01 09:00:00',
    created_at: '2026-06-01 08:00:00',
    fy_id: 2,
    bo_id: 0,
    line_count: 3,
    valuation_total: 1500,
    ...overrides,
  }
}

const ROWS = [
  row(),
  row({ document_id: 102, document_no: 'ST-0102', line_count: 2, valuation_total: 500 }),
]

function listResponse(rows = ROWS, total = rows.length): ListResponse<DocumentListRow> {
  return { data: rows, meta: { total, limit: 50, offset: 0 } }
}

function renderPage(url = '/documents') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/documents" element={<DocumentsListPage />} />
        <Route path="/documents/:id" element={<p>Document screen</p>} />
        <Route path="/documents/new" element={<p>Entry hub</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  can.mockReset()
  can.mockReturnValue(true)
  list.mockReset()
  list.mockResolvedValue(listResponse())
  bulkPrintDocuments.mockClear()
  downloadCsv.mockClear()
  exportTabularPdf.mockClear()
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('the documents register matches what Books offered', () => {
  it('renders every export format, print and column configuration', async () => {
    renderPage()
    await screen.findByText('ST-0101')

    // Two doors to one dialog: the toolbar's counted button and "Customize
    // columns" over the table. Name them separately rather than matching
    // "columns" loosely and finding both.
    expect(screen.getByRole('button', { name: /^Columns/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Customize columns' })).toBeTruthy()
    // Print is its own button; CSV / Excel / PDF live behind Export.
    expect(screen.getByRole('button', { name: /^Print/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const menu = await screen.findByRole('menu', { name: /Export/ })
    expect(within(menu).getByText('CSV (.csv)')).toBeTruthy()
    expect(within(menu).getByText('Excel (.xlsx)')).toBeTruthy()
    expect(within(menu).getByText('PDF (.pdf)')).toBeTruthy()
  })

  it('shows a KPI strip and a totals row instead of a bare table', async () => {
    list.mockResolvedValue(listResponse(ROWS, 4182))
    const { container } = renderPage()
    await screen.findByText('ST-0101')

    // The count is the whole filtered set, not the page.
    expect(screen.getByText('4,182')).toBeTruthy()
    const tfoot = container.querySelector('tfoot')
    expect(tfoot).toBeTruthy()
    // `/v1/inventory-documents` sends no aggregate, so the footer totals the
    // served page. It is the figure a reader trusts most, so it has to say so —
    // exactly as the movement and reservation registers on this engine do.
    expect(within(tfoot as HTMLElement).getByText(/Total \(2 documents\)/)).toBeTruthy()
    expect(within(tfoot as HTMLElement).getByText(/this page only/)).toBeTruthy()
    // 1500 + 500 over the two page rows — a page sum under a caveat, never a
    // bare "Total" beside a currency figure that covers 2 of 4,182 documents.
    expect(within(tfoot as HTMLElement).getByText('2,000.00')).toBeTruthy()
  })

  it('drops the page caveat from the footer once the page IS the whole result', async () => {
    list.mockResolvedValue(listResponse(ROWS, 2))
    const { container } = renderPage()
    await screen.findByText('ST-0101')

    const tfoot = container.querySelector('tfoot') as HTMLElement
    expect(within(tfoot).getByText(/Total \(2 documents\)/)).toBeTruthy()
    expect(within(tfoot).queryByText(/this page only/)).toBeNull()
  })

  it('labels the page-derived figures as such, so nobody reads them as the total', async () => {
    list.mockResolvedValue(listResponse(ROWS, 4182))
    renderPage()
    await screen.findByText('ST-0101')
    expect(screen.getAllByText(/this page only/).length).toBeGreaterThan(0)
  })

  it('names the valuation column valuation, never the commercial value', async () => {
    renderPage()
    await screen.findByText('ST-0101')
    const header = screen.getByRole('columnheader', { name: /Valuation/ })
    expect(header).toBeTruthy()
    // "Value" alone reads as the price agreed with the party, which Books owns.
    expect(screen.queryByRole('columnheader', { name: /^Value$/ })).toBeNull()
  })

  it('offers a sort control only where the server actually sorts', async () => {
    renderPage()
    await screen.findByText('ST-0101')
    // SmartTable renders a button inside the header cell of a sortable column.
    for (const name of [/^Date$/, /^Type$/, /^Number$/, /^Status$/]) {
      const th = screen.getByRole('columnheader', { name })
      expect(within(th).queryByRole('button'), String(name)).not.toBeNull()
    }
    // Party, Lines and Valuation are NOT in DocumentsController's sort
    // whitelist: a control there would move the arrow and return the same rows.
    for (const name of [/^Party$/, /^Lines$/, /^Valuation$/]) {
      const th = screen.getByRole('columnheader', { name })
      expect(within(th).queryByRole('button'), String(name)).toBeNull()
    }
  })

  it('walks the whole filtered result into an export, not the page on screen', async () => {
    /*
     * Two real pages, not one.
     *
     * `fetchAllRows` stops as soon as a page comes back shorter than the limit
     * it asked for, so a fixture of two rows exercises nothing: the walk would
     * still pass if it were deleted. This serves a FULL page of 500 and then a
     * short second page, so the assertion below can only hold if every page was
     * fetched and concatenated.
     */
    const PAGE_ONE = Array.from({ length: 500 }, (_, i) =>
      row({ document_id: 1000 + i, document_no: `BULK-${i}`, line_count: 1, valuation_total: 10 }),
    )
    const PAGE_TWO = [row({ document_id: 2000, document_no: 'LAST-ROW', line_count: 1, valuation_total: 10 })]
    list.mockImplementation(async (query: Record<string, unknown>) => {
      if (query.limit !== 500) return listResponse(ROWS, 501)
      return query.page === 1 ? listResponse(PAGE_ONE, 501) : listResponse(PAGE_TWO, 501)
    })

    renderPage()
    await screen.findByText('ST-0101')
    list.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(await screen.findByText('CSV (.csv)'))

    await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
    // The export's own request asks for a full page of rows, not the 50 on screen.
    expect(list.mock.calls[0][0].limit).toBe(500)
    // ...and it kept asking until the result ran out.
    expect(list.mock.calls.map((c) => c[0].page)).toEqual([1, 2])

    const csv = downloadCsv.mock.calls[0][1]
    expect(csv).toContain('BULK-0')
    // The row that exists only on page 2. A walk that stops after page 1 loses
    // it, and the file goes out short with an internally consistent footer.
    expect(csv).toContain('LAST-ROW')
    expect(csv.trim().split('\n')).toHaveLength(502) // header + 501 rows
  })

  it('re-totals an exported sheet over every row it wrote, caveat and all', async () => {
    list.mockResolvedValue(listResponse(ROWS, 2))
    renderPage()
    await screen.findByText('ST-0101')

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(await screen.findByText('PDF (.pdf)'))

    await waitFor(() => expect(exportTabularPdf).toHaveBeenCalled())
    const payload = exportTabularPdf.mock.calls[0][0] as {
      rows: unknown[]
      totalsRow?: Record<string, { text?: string }> | null
      summaryCards?: { label: string; value: string; hint?: string }[]
    }
    expect(payload.rows).toHaveLength(2)
    const totalsText = Object.values(payload.totalsRow ?? {})
      .map((c) => c?.text ?? '')
      .join(' ')
    // The whole result is on the sheet, so the caveat is gone rather than
    // printed over a document that carries every row.
    expect(totalsText).toContain('Total (2 documents)')
    expect(totalsText).not.toContain('this page only')
  })

  it('drills through to the document behind the row', async () => {
    renderPage()
    const cell = await screen.findByText('ST-0101')
    const tr = cell.closest('tr') as HTMLElement
    fireEvent.keyDown(tr, { key: 'Enter' })
    expect(await screen.findByText('Document screen')).toBeTruthy()
  })
})

describe('the hand-off URL Books links to', () => {
  it('names the document type in the heading and the breadcrumb', async () => {
    renderPage('/documents?document_type=STOCK_TRANSFER')
    await screen.findByText('ST-0101')

    // The register's heading IS its breadcrumb trail (BreadcrumbHeader compact).
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Stock Transfer register')).toBeTruthy()
    expect(within(breadcrumb).getByRole('link', { name: 'Documents' })).toBeTruthy()
  })

  /** InventoryBridgeService::DOCUMENT_TYPES, via inventoryHistoricalRegisters.js. */
  const BOOKS_HANDOFF_CODES = [
    'PACKING',
    'JOB_WORK_IN',
    'JOB_WORK_OUT',
    'PHYSICAL_ADJUSTMENT',
    'PRODUCTION',
    'STOCK_TRANSFER',
    'DELIVERY_CHALLAN',
    'INWARD_CHALLAN',
  ]

  it.each(BOOKS_HANDOFF_CODES)('names the register for %s rather than showing a raw code', async (code) => {
    renderPage(`/documents?document_type=${code}`)
    await screen.findByText('ST-0101')
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const crumb = within(breadcrumb).getByText(/register$/).textContent ?? ''
    // A real label, not the wire code echoed back at the reader.
    expect(crumb).not.toContain('_')
    expect(crumb.length).toBeGreaterThan('register'.length + 1)
  })

  it('narrows the rows by sending document_type to the API', async () => {
    renderPage('/documents?document_type=DELIVERY_CHALLAN')
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(list.mock.calls[0][0].document_type).toBe('DELIVERY_CHALLAN')
  })

  it('keeps the general heading for a multi-code filter it cannot name', async () => {
    renderPage('/documents?document_type=PRODUCTION,ASSEMBLY')
    await screen.findByText('ST-0101')
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Inventory documents')).toBeTruthy()
    expect(within(breadcrumb).queryByText(/register$/)).toBeNull()
  })

  it('shows no Valuation column or card on a type whose lines are never valued', async () => {
    /*
     * DELIVERY_CHALLAN is `valuation => false` on the server and is not in
     * VALUES_MOVED_STOCK, so `SUM(l.valuation_amount)` is 0 for every row. A
     * prominent card reading "Valuation 0.00 — what the stock cost" is read as
     * an answer: the dispatched stock is worth nothing, or Inventory has lost
     * the challan values. Neither is true, and the figure the reader wants is
     * the commercial one Books owns.
     */
    renderPage('/documents?document_type=DELIVERY_CHALLAN')
    await screen.findByText('ST-0101')

    expect(screen.queryByRole('columnheader', { name: /Valuation/ })).toBeNull()
    expect(screen.queryByText('what the stock cost')).toBeNull()
    expect(screen.queryByText(/· what the stock cost/)).toBeNull()
    // The register is not gutted: the rest of it is still there.
    expect(screen.getByRole('columnheader', { name: /^Lines$/ })).toBeTruthy()
    expect(screen.getByText('Documents')).toBeTruthy()
    // And the screen says why there is no valuation rather than leaving a hole.
    expect(screen.getByText(/carries no valuation/i)).toBeTruthy()
    expect(screen.getByText(/belongs to the Books voucher/i)).toBeTruthy()
  })

  it('keeps the Valuation column on a type that is valued', async () => {
    renderPage('/documents?document_type=STOCK_TRANSFER')
    await screen.findByText('ST-0101')
    expect(screen.getByRole('columnheader', { name: /Valuation/ })).toBeTruthy()
  })

  it('applies no default period, so a link with no dates hides nothing', async () => {
    renderPage('/documents?document_type=STOCK_TRANSFER')
    await waitFor(() => expect(list).toHaveBeenCalled())
    const query = list.mock.calls[0][0]
    expect(query.from).toBeUndefined()
    expect(query.to).toBeUndefined()
  })
})

describe('bulk print', () => {
  it('prints exactly the documents that were ticked', async () => {
    renderPage()
    await screen.findByText('ST-0101')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select document 101' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select document 102' }))

    const button = await screen.findByRole('button', { name: /Print 2 documents/ })
    fireEvent.click(button)

    await waitFor(() => expect(bulkPrintDocuments).toHaveBeenCalled())
    expect(bulkPrintDocuments.mock.calls[0][0]).toEqual([101, 102])
  })

  it('ticks every row on the page from the header checkbox', async () => {
    renderPage()
    await screen.findByText('ST-0101')
    fireEvent.click(screen.getByRole('checkbox', { name: /every row on this page/ }))
    expect(await screen.findByRole('button', { name: /Print 2 documents/ })).toBeTruthy()
  })

  it('offers nothing until something is selected', async () => {
    renderPage()
    await screen.findByText('ST-0101')
    expect(screen.queryByRole('button', { name: /Print \d+ document/ })).toBeNull()
  })
})
