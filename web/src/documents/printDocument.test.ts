import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../services/api'
import type { InventoryDocument, PrintSnapshot } from './types'

/*
 * The rule under test is the one that makes a printed challan a record rather
 * than a view: ask for the immutable snapshot, and fall through to the live
 * document ONLY on a 404. A bulk print that re-derived its figures from live
 * masters would print the same statutory document differently the second time.
 */

const printSnapshot = vi.fn<(id: number, signal?: AbortSignal) => Promise<PrintSnapshot>>()
const get = vi.fn<(id: number, signal?: AbortSignal) => Promise<InventoryDocument>>()

vi.mock('../services/documentsApi', () => ({
  documentsApi: {
    printSnapshot: (id: number, signal?: AbortSignal) => printSnapshot(id, signal),
    get: (id: number, signal?: AbortSignal) => get(id, signal),
  },
}))

const {
  bulkPrintDocuments,
  loadDocumentSheet,
  mergeDocumentPrintHtml,
  sheetBodyOf,
  documentSheetOptions,
} = await import('./printDocument')
const { buildDocumentPrintHtml } = await import('../export/sheetHtml')

function snapshot(documentId: number, documentNo: string): PrintSnapshot {
  return {
    snap_id: documentId * 10,
    document_id: documentId,
    document_variant: 'DELIVERY_CHALLAN',
    document_no: documentNo,
    document_date: '2026-07-04',
    currency_code: 'INR',
    header_snapshot: { title: 'Delivery Challan' },
    source_dest_snapshot: { party_name: 'Snapshot Party Pvt Ltd' },
    item_lines_snapshot: [
      { item_name: 'Hex bolt M8', qty: 5, unit_symbol: 'Nos', valuation_amount: 500 },
    ],
    transport_snapshot: null,
    variant_extras_snapshot: null,
    footer_snapshot: null,
    template_version: 'v3',
    status: 'POSTED',
    created_at: '2026-07-04 10:00:00',
  }
}

function liveDocument(documentId: number, documentNo: string): InventoryDocument {
  return {
    document_id: documentId,
    document_type: 'STOCK_JOURNAL',
    document_no: documentNo,
    document_date: '2026-07-05',
    status: 'POSTED',
    party_name: 'Live Party Ltd',
    lines: [{ item_name: 'Live widget', qty: 2, unit_symbol: 'Nos', valuation_amount: 200 }],
  } as unknown as InventoryDocument
}

const identity = { companyName: 'Acme Ltd', scopeLabel: 'FY 2026-27', addressLines: [], logo: null }

beforeEach(() => {
  printSnapshot.mockReset()
  get.mockReset()
})

describe('one document, snapshot first', () => {
  it('prints the captured snapshot and never touches the live document', async () => {
    printSnapshot.mockResolvedValue(snapshot(41, 'DC-0041'))
    const sheet = await loadDocumentSheet(41)
    expect(sheet?.source).toBe('snapshot')
    expect(sheet?.documentNo).toBe('DC-0041')
    expect(get).not.toHaveBeenCalled()
  })

  it('falls through to the live document only when no snapshot was ever captured', async () => {
    printSnapshot.mockRejectedValue(new ApiError(404, 'not_found', 'No print snapshot'))
    get.mockResolvedValue(liveDocument(42, 'SJ-0042'))
    const sheet = await loadDocumentSheet(42)
    expect(sheet?.source).toBe('live')
    expect(get).toHaveBeenCalledWith(42, undefined)
  })

  it('reports a 403 or a 500 instead of quietly rendering live data as the record', async () => {
    printSnapshot.mockRejectedValue(new ApiError(500, 'server_error', 'Snapshot store unavailable'))
    await expect(loadDocumentSheet(43)).rejects.toThrow('Snapshot store unavailable')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('several documents in one print job', () => {
  function html(documentNo: string): string {
    return buildDocumentPrintHtml({
      ...identity,
      title: 'Delivery Challan',
      documentNo,
      columns: [
        { key: 'item', label: 'Item', format: 'text', align: 'left', excelWidth: 30, pdfWeight: 3 },
      ],
      rows: [{ item: { value: 'Hex bolt M8', text: 'Hex bolt M8' } }],
    })
  }

  it('produces ONE document containing every sheet, page-broken between them', () => {
    const merged = mergeDocumentPrintHtml([html('DC-1'), html('DC-2'), html('DC-3')], '3 documents')!
    expect(merged).toBeTruthy()
    // One document, not three concatenated ones.
    expect(merged.match(/<!doctype html>/gi)?.length).toBe(1)
    expect(merged.match(/<\/body>/gi)?.length).toBe(1)
    // Every document is in it.
    for (const no of ['DC-1', 'DC-2', 'DC-3']) expect(merged).toContain(no)
    // n - 1 explicit breaks between n sheets (each source here is one copy, so
    // it carries no break of its own).
    const BREAK = '<div class="page-break"></div>'
    expect((html('DC-1').split(BREAK).length - 1)).toBe(0)
    expect(merged.split(BREAK).length - 1).toBe(2)
    expect(merged).toContain('<title>3 documents</title>')
  })

  it('refuses to merge anything it did not generate, rather than dropping it', () => {
    expect(sheetBodyOf('<html><body>not ours</body></html>')).toBeNull()
    expect(mergeDocumentPrintHtml([html('DC-1'), '<p>not ours</p>'])).toBeNull()
    expect(mergeDocumentPrintHtml([])).toBeNull()
  })
})

describe('bulk print', () => {
  it('prints one sheet per selected document, each snapshot-first', async () => {
    printSnapshot.mockImplementation(async (id) => {
      if (id === 8) throw new ApiError(404, 'not_found', 'No print snapshot')
      return snapshot(id, `DC-${id}`)
    })
    get.mockResolvedValue(liveDocument(8, 'SJ-0008'))
    const print = vi.fn(() => true)

    const result = await bulkPrintDocuments([7, 8], { identity, print, generatedAt: '2026-07-06' })

    expect(result).toEqual({ printed: 2, failures: [], opened: true })
    expect(print).toHaveBeenCalledTimes(1)
    const [merged] = print.mock.calls[0] as unknown as [string]
    expect(merged).toContain('DC-7')
    expect(merged).toContain('SJ-0008')
    // Document 7's figures came off the snapshot, so its snapshot party is on
    // the paper — not whatever the master says today.
    expect(merged).toContain('Snapshot Party Pvt Ltd')
  })

  it('names the documents it could not print instead of printing a short batch silently', async () => {
    printSnapshot.mockImplementation(async (id) => {
      if (id === 9) throw new ApiError(500, 'server_error', 'Snapshot store unavailable')
      return snapshot(id, `DC-${id}`)
    })
    const print = vi.fn(() => true)

    const result = await bulkPrintDocuments([7, 9], { identity, print })

    expect(result.printed).toBe(1)
    expect(result.failures).toEqual([{ documentId: 9, reason: 'Snapshot store unavailable' }])
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('opens no print dialog when nothing could be loaded', async () => {
    printSnapshot.mockRejectedValue(new ApiError(500, 'server_error', 'down'))
    const print = vi.fn(() => true)

    const result = await bulkPrintDocuments([7, 9], { identity, print })

    expect(result).toMatchObject({ printed: 0, opened: false })
    expect(result.failures).toHaveLength(2)
    expect(print).not.toHaveBeenCalled()
  })

  it('reports a blocked print window rather than claiming the batch was printed', async () => {
    printSnapshot.mockResolvedValue(snapshot(7, 'DC-7'))
    const result = await bulkPrintDocuments([7], { identity, print: () => false })
    expect(result).toMatchObject({ printed: 1, opened: false })
  })
})

describe('a single print and a bulk print are the same document', () => {
  it('builds both from one options helper, including the copy set', async () => {
    printSnapshot.mockResolvedValue(snapshot(7, 'DC-7'))
    const sheet = (await loadDocumentSheet(7))!
    const options = documentSheetOptions(sheet, identity)
    // A delivery challan travels with three captioned copies.
    expect(options.copies).toEqual(['Original for Consignee', 'Duplicate for Transporter', 'Triplicate for Consignor'])
    expect(options.orientation).toBe('portrait')
    expect(options.paperSize).toBe('A4')
    expect(options.provenance).toContain('snapshot')
  })
})
