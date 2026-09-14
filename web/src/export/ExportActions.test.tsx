import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ExportableColumn } from '../registers/registerCells'

interface CapturedPayload {
  rows: unknown[]
  metaLines: string[]
  columns: { key: string; label: string }[]
  totalsRow: Record<string, { text: string }> | null
  companyName?: string
  warningNote?: string
}

const exportTabularExcel = vi.fn(async (_payload: CapturedPayload) => {})
const exportTabularPdf = vi.fn(async (_payload: CapturedPayload) => {})
const printTabular = vi.fn((_payload: CapturedPayload) => true)
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('./documentExport', () => ({
  exportTabularExcel: (payload: CapturedPayload) => exportTabularExcel(payload),
  exportTabularPdf: (payload: CapturedPayload) => exportTabularPdf(payload),
  printTabular: (payload: CapturedPayload) => printTabular(payload),
}))

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>()
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv) }
})

const { ExportActions } = await import('./ExportActions')

interface Row {
  item_name: string
  out_qty: number
  value: number
}

const COLUMNS: ExportableColumn<Row>[] = [
  { key: 'item_name', header: 'Item' },
  { key: 'out_qty', header: 'Out qty', align: 'right', format: 'qty' },
  { key: 'value', header: 'Value', align: 'right', format: 'amount' },
]

const ROWS: Row[] = [
  { item_name: 'Widget A', out_qty: 10, value: 1200 },
  { item_name: 'Widget B', out_qty: 4, value: 200 },
]

function renderActions(props: Partial<Parameters<typeof ExportActions<Row>>[0]> = {}) {
  return render(
    <ExportActions<Row>
      columns={COLUMNS}
      rows={ROWS}
      filename="stock-movement-register"
      identity={{ companyName: 'Acme Ltd', scopeLabel: 'Acme Ltd · FY 2026-27' }}
      title="Stock movement register"
      {...props}
    />,
  )
}

beforeEach(() => {
  exportTabularExcel.mockClear()
  exportTabularPdf.mockClear()
  printTabular.mockClear()
  downloadCsv.mockClear()
})

describe('ExportActions', () => {
  it('shows Export and Print, and opens the menu on click', () => {
    renderActions()
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /print/i })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  /** Nobody should have to hunt for the export they already had. */
  it('lists CSV first, then Excel, then PDF', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
    expect(labels[0]).toContain('CSV')
    expect(labels[1]).toContain('Excel')
    expect(labels[2]).toContain('PDF')
  })

  it('writes a CSV of the rows on screen when no pager is supplied', async () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    const [filename, csv] = downloadCsv.mock.calls[0]
    expect(filename).toBe('stock-movement-register.csv')
    expect(csv).toContain('Item,Out qty,Value')
    expect(csv).toContain('Widget A,10,1200')
  })

  it('walks every page when a pager is supplied, and exports what it returns', async () => {
    const fetchAll = vi.fn(async () => ({
      rows: [...ROWS, { item_name: 'Widget C', out_qty: 1, value: 50 }],
      total: 3,
      truncated: false,
    }))
    renderActions({ fetchAll })
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Excel/ }))
    await waitFor(() => expect(exportTabularExcel).toHaveBeenCalledOnce())
    expect(fetchAll).toHaveBeenCalledOnce()
    const payload = exportTabularExcel.mock.calls[0][0]
    expect(payload.rows).toHaveLength(3)
    expect(payload.metaLines).toContain('Rows: 3')
  })

  it('carries the visible columns and the server totals into the PDF', async () => {
    renderActions({ totalsText: ['Total (412 movements)', '1,204', '4,18,200.00'] })
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /PDF/ }))
    await waitFor(() => expect(exportTabularPdf).toHaveBeenCalledOnce())
    const payload = exportTabularPdf.mock.calls[0][0]
    expect(payload.columns.map((c) => c.key)).toEqual(['item_name', 'out_qty', 'value'])
    expect(payload.totalsRow?.value.text).toBe('4,18,200.00')
    expect(payload.companyName).toBe('Acme Ltd')
  })

  it('prints the same payload it would export, not the app window', () => {
    renderActions({ totalsText: ['Total (412 movements)', '1,204', '4,18,200.00'] })
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    return waitFor(() => {
      expect(printTabular).toHaveBeenCalledOnce()
      const payload = printTabular.mock.calls[0][0]
      expect(payload.columns.map((c) => c.key)).toEqual(['item_name', 'out_qty', 'value'])
      expect(payload.rows).toHaveLength(2)
      expect(payload.totalsRow?.value.text).toBe('4,18,200.00')
      expect(payload.companyName).toBe('Acme Ltd')
    })
  })

  it('warns in the file when the pager capped the result', async () => {
    const fetchAll = vi.fn(async () => ({ rows: [...ROWS], total: 99_999, truncated: true }))
    renderActions({ fetchAll })
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Excel/ }))
    await waitFor(() => expect(exportTabularExcel).toHaveBeenCalledOnce())
    const payload = exportTabularExcel.mock.calls[0][0]
    expect(payload.warningNote).toContain('narrow the filters')
  })

  it('hides the formats a screen says it cannot support', () => {
    renderActions({ formats: ['csv', 'print'] })
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
    expect(labels).toHaveLength(1)
    expect(labels[0]).toContain('CSV')
  })

  it('closes the menu on Escape', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers Refresh only when the page supplies a handler', () => {
    const onRefresh = vi.fn()
    const { unmount } = renderActions({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalledOnce()
    unmount()
    renderActions()
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull()
  })
})
