import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../services/api'
import type { InventoryDocument, PrintSnapshot } from './types'

/*
 * The fallback order, asserted on the screen that shows it.
 *
 * `/documents/:id/print` and the register's bulk print must produce the SAME
 * piece of paper for the same document, so both go through the one rule in
 * `printDocument.ts`. printDocument.test.ts drives that rule directly; this
 * file drives it through the page, because the page is where it used to live in
 * a second copy — and a second copy is how one screen ends up printing a
 * statutory challan from live masters while the other prints the frozen record.
 */

const printSnapshot = vi.fn<(id: number, signal?: AbortSignal) => Promise<PrintSnapshot>>()
const get = vi.fn<(id: number, signal?: AbortSignal) => Promise<InventoryDocument>>()

vi.mock('../services/documentsApi', () => ({
  documentsApi: {
    printSnapshot: (id: number, signal?: AbortSignal) => printSnapshot(id, signal),
    get: (id: number, signal?: AbortSignal) => get(id, signal),
  },
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 54, fy_id: 2, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))

vi.mock('../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd · FY 2026-27' }))

vi.mock('./useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [],
    units: [],
    defaultWarehouseId: null,
    warehouseName: (id: number | null) => (id ? 'Main store' : ''),
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../export/documentExport', () => ({
  printDocumentSheet: vi.fn(() => true),
  exportDocumentPdf: vi.fn(async () => {}),
}))

const { DocumentPrintPage } = await import('./DocumentPrintPage')

function snapshot(): PrintSnapshot {
  return {
    snap_id: 900,
    document_id: 90,
    document_variant: 'DELIVERY_CHALLAN',
    document_no: 'DC-0090',
    document_date: '2026-07-04',
    currency_code: 'INR',
    header_snapshot: { title: 'Delivery Challan' },
    source_dest_snapshot: { party_name: 'Snapshot Party Pvt Ltd' },
    item_lines_snapshot: [{ item_name: 'Hex bolt M8', qty: 5, unit_symbol: 'Nos', valuation_amount: 500 }],
    transport_snapshot: null,
    variant_extras_snapshot: null,
    footer_snapshot: null,
    template_version: 'v3',
    status: 'POSTED',
    created_at: '2026-07-04 10:00:00',
  }
}

function liveDocument(): InventoryDocument {
  return {
    document_id: 90,
    document_type: 'STOCK_TRANSFER',
    document_no: 'ST-0090',
    document_date: '2026-07-05',
    status: 'POSTED',
    party_name: 'Live Party Ltd',
    lines: [{ item_name: 'Live widget', qty: 2, unit_symbol: 'Nos', valuation_amount: 200 }],
  } as unknown as InventoryDocument
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/documents/90/print']}>
      <Routes>
        <Route path="/documents/:id/print" element={<DocumentPrintPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  printSnapshot.mockReset()
  get.mockReset()
})

describe('/documents/:id/print follows the one snapshot-first rule', () => {
  it('prints the captured snapshot and never reads the live document', async () => {
    printSnapshot.mockResolvedValue(snapshot())

    renderPage()

    expect(await screen.findByText('Snapshot')).toBeTruthy()
    // The frozen party, not whatever the master says today.
    expect(screen.getByText(/Snapshot Party Pvt Ltd/)).toBeTruthy()
    expect(get).not.toHaveBeenCalled()
  })

  it('falls through to the live document only when no snapshot was ever captured', async () => {
    printSnapshot.mockRejectedValue(new ApiError(404, 'not_found', 'No print snapshot'))
    get.mockResolvedValue(liveDocument())

    renderPage()

    expect(await screen.findByText('Live document')).toBeTruthy()
    expect(screen.getByText(/Live Party Ltd/)).toBeTruthy()
    expect(get).toHaveBeenCalledWith(90, expect.anything())
  })

  it.each([403, 500])(
    'reports a %s instead of quietly rendering live data as the record',
    async (status) => {
      printSnapshot.mockRejectedValue(new ApiError(status, 'refused', 'Snapshot store unavailable'))
      get.mockResolvedValue(liveDocument())

      renderPage()

      expect(await screen.findByText('This document could not be loaded')).toBeTruthy()
      // The live document is the one thing that must NOT appear here: it would
      // look exactly like the record and would not be it.
      expect(get).not.toHaveBeenCalled()
      expect(screen.queryByText(/Live Party Ltd/)).toBeNull()
      expect(screen.queryByText('Live document')).toBeNull()
    },
  )
})
