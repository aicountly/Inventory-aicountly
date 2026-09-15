import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FetchAllResult } from '../services/listAll'

/*
 * The short-export hole, on the three stock screens that still use this button
 * (StockMovementsPage, StockLedgerPage, StockBalancesPage).
 *
 * `fetchAllRows` returns rows, total AND truncated. Reading only `truncated`
 * misses the case that actually happens on a live system: an endpoint clamps
 * the limit the walk asked for, `services/listAll.ts` exits on the short page
 * with `truncated: false`, and `meta.total` is far larger. The file then goes
 * out as a plain success, gets summed in a spreadsheet and filed.
 */

const downloadCsv = vi.fn((_filename: string, _csv: string) => {})
const toasts: { kind: string; message: string }[] = []

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>()
  return { ...actual, downloadCsv: (f: string, c: string) => downloadCsv(f, c) }
})

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({
    success: (message: string) => toasts.push({ kind: 'success', message }),
    info: (message: string) => toasts.push({ kind: 'info', message }),
    error: (message: string) => toasts.push({ kind: 'error', message }),
  }),
}))

const { ExportCsvButton } = await import('./ExportCsvButton')

interface Row {
  movement_id: number
  qty: number
}

const COLUMNS = [
  { header: 'Movement', value: (r: Row) => r.movement_id },
  { header: 'Qty', value: (r: Row) => r.qty },
]

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ movement_id: i + 1, qty: 1 }))
}

function renderButton(fetchAll?: () => Promise<FetchAllResult<Row>>) {
  render(
    <ExportCsvButton<Row>
      filename="stock-movements-acme-ltd-2026-09-15.csv"
      columns={COLUMNS}
      rows={rows(2)}
      fetchAll={fetchAll}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
}

beforeEach(() => {
  downloadCsv.mockClear()
  toasts.length = 0
})

describe('ExportCsvButton', () => {
  it('writes a plain success and an unmarked name when the file holds everything', async () => {
    renderButton(async () => ({ rows: rows(200), total: 200, truncated: false }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    expect(downloadCsv.mock.calls[0][0]).toBe('stock-movements-acme-ltd-2026-09-15.csv')
    expect(toasts[0].kind).toBe('success')
    expect(toasts[0].message).toBe('Exported 200 rows.')
  })

  it('names the file for its shortfall when the pager stopped below the server total', async () => {
    // truncated:false, and 200 of 4,182 rows. This is the case the old
    // `truncated`-only check could not see at all.
    renderButton(async () => ({ rows: rows(200), total: 4182, truncated: false }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    expect(downloadCsv.mock.calls[0][0]).toBe(
      'stock-movements-acme-ltd-2026-09-15-partial-200-of-4182.csv',
    )
    expect(toasts[0].kind).not.toBe('success')
    expect(toasts[0].message).toContain('200 of the 4,182 rows')
  })

  it('names the file for its shortfall when the walk hit its cap', async () => {
    renderButton(async () => ({ rows: rows(300), total: 12_431, truncated: true }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    expect(downloadCsv.mock.calls[0][0]).toContain('-partial-300-of-12431.csv')
    expect(toasts[0].kind).not.toBe('success')
  })

  it('says nothing to export rather than writing a header-only file', async () => {
    renderButton(async () => ({ rows: [], total: 0, truncated: false }))
    await waitFor(() => expect(toasts).toHaveLength(1))
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(toasts[0].message).toBe('Nothing to export.')
  })
})
