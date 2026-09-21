import { beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { exportTabularExcel, exportTabularPdf, exportDocumentPdf } from './documentExport'
import type { TabularExportPayload } from './documentExport'
import type { ExportColumn, ExportRow } from './exportColumns'

/**
 * The writers end in `XLSX.writeFile` and `doc.save`, which in the browser hand
 * a Blob to the user and in node write to disk. Pointing them at a temp
 * directory is what makes the whole pipeline — payload, styling, fonts,
 * pagination — assertable without a browser, and it is the only test that would
 * catch a corrupt workbook or a zero-page PDF.
 */
const OUT = mkdtempSync(join(tmpdir(), 'aicountly-export-'))

/**
 * Pin the fallback font path, and keep this file off the network.
 *
 * `pdfFonts.ts` fetches Nunito and Noto Sans from a CDN at export time. That is
 * right in a browser and wrong in a test, for two reasons — and the second one
 * is why this file used to be green on one machine and red on CI.
 *
 * With the webfonts embedded, jsPDF writes text through an Identity-H CID font:
 * every string in the PDF becomes a run of glyph IDs, not characters. So an
 * assertion that reads the raw bytes and looks for "ORIGINAL FOR CONSIGNEE"
 * can only pass when the font fetch FAILED and jsPDF fell back to Helvetica.
 * The assertion was inverted — green exactly when font embedding was broken,
 * red as soon as it worked. On a sandboxed machine the CDN returns a stub the
 * loader rejects, so it passed locally; on CI the real font downloads, so it
 * failed there.
 *
 * Stubbing the fetch makes the fallback deterministic on every machine, which
 * is the path whose text is readable and therefore the only one these caption
 * assertions can honestly be written against. Nothing here covers the embedded
 * font path; asserting glyph IDs would test jsPDF's CMap, not our export.
 */
beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('webfonts are stubbed out in tests')))
})

afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(OUT, { recursive: true, force: true })
})

const COLUMNS: ExportColumn[] = [
  { key: 'movement_date', label: 'Date', format: 'date', align: 'left', excelWidth: 13, pdfWeight: 11 },
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 34, pdfWeight: 26 },
  { key: 'warehouse', label: 'Warehouse', format: 'text', align: 'left', excelWidth: 20, pdfWeight: 16 },
  { key: 'in_qty', label: 'In qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10 },
  { key: 'out_qty', label: 'Out qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10, tone: 'credit' },
  { key: 'value', label: 'Value (₹)', format: 'amount', align: 'right', excelWidth: 16, pdfWeight: 13 },
]

function mkRow(i: number): ExportRow {
  const value = 1000 + i * 37.5
  return {
    movement_date: { value: '18 Apr 2026', text: '18 Apr 2026' },
    item_name: { value: `Widget ${i}`, text: `Widget ${i}` },
    warehouse: { value: 'Pune Central', text: 'Pune Central' },
    in_qty: { value: i % 2 ? i : '', text: i % 2 ? String(i) : '' },
    out_qty: { value: i % 2 ? '' : i, text: i % 2 ? '' : String(i) },
    value: { value, text: value.toFixed(2) },
  }
}

const ROWS = Array.from({ length: 60 }, (_, i) => mkRow(i + 1))

const PAYLOAD: TabularExportPayload = {
  title: 'Stock movement register',
  description: 'Every movement in the selected period',
  companyName: 'Acme Manufacturing Ltd',
  scopeLabel: 'Acme Manufacturing Ltd · FY 2026-27 · Head office',
  metaLines: ['Period: 01 Apr 2026 to 14 Sep 2026', 'Rows: 60'],
  summaryCards: [
    { label: 'Opening value', value: '₹ 12,40,000' },
    { label: 'Inward', value: '₹ 3,10,500' },
    { label: 'Outward', value: '₹ 2,05,000', tone: 'credit' },
    { label: 'Closing value', value: '₹ 13,45,500' },
  ],
  columns: COLUMNS,
  rows: ROWS,
  totalsRow: {
    movement_date: { value: '', text: '' },
    item_name: { value: '', text: '' },
    warehouse: { value: '', text: '' },
    in_qty: { value: 930, text: '930' },
    out_qty: { value: 900, text: '900' },
    value: { value: 128175, text: '1,28,175.00' },
  },
  totalsLabel: 'Total (60 movements)',
  generatedAt: '14 Sep 2026, 18:30',
  filenameBase: `${OUT}/register`,
  excelNotes: ['Figures are for the whole filtered result, not the page on screen.'],
}

describe('exported files are real and readable', () => {
  it('writes a readable .xlsx with numbers, formats and a totals row', async () => {
    await exportTabularExcel(PAYLOAD)
    expect(existsSync(`${OUT}/register.xlsx`)).toBe(true)

    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.readFile(`${OUT}/register.xlsx`, { cellStyles: true })
    const ws = wb.Sheets[wb.SheetNames[0]] as Record<string, { v?: unknown; t?: string; z?: string; s?: unknown }>
    expect(wb.SheetNames[0]).toBe('Stock movement register')
    expect(ws.A1.v).toBe('Acme Manufacturing Ltd')
    expect(ws.A2.v).toBe('Stock movement register')
    // company, title, 2 meta lines, a spacer, then the column headers
    expect(ws.A6.v).toBe('Date')
    expect(ws.F6.v).toBe('Value (₹)')
    // first data row
    expect(ws.B7.v).toBe('Widget 1')
    expect(ws.F7.t).toBe('n')
    expect(ws.F7.v).toBeCloseTo(1037.5)
    expect(ws.F7.z).toBe('"₹ "#,##0.00')
    // totals row sits under the 60 data rows
    expect(ws.A67.v).toBe('Total (60 movements)')
    expect(ws.F67.t).toBe('n')
    expect(ws.F67.v).toBe(128175)
    expect(ws.F67.z).toBe('"₹ "#,##0.00')
    expect(ws.F67.s).toBeTruthy()
    // The filter range stops above the totals row, so filtering can never hide it.
    const filter = (ws as unknown as { '!autofilter'?: { ref: string } })['!autofilter']
    expect(filter?.ref).toBe('A6:F66')
  }, 30_000)

  it('writes a multi-page .pdf', async () => {
    await exportTabularPdf(PAYLOAD)
    const path = `${OUT}/register.pdf`
    expect(existsSync(path)).toBe(true)
    const buf = readFileSync(path)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(5_000)
    const text = buf.toString('latin1')
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pageCount).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('writes one captioned page per copy', async () => {
    await exportDocumentPdf({
      title: 'Delivery challan',
      documentNo: 'DC-000412',
      companyName: 'Acme Manufacturing Ltd',
      columns: COLUMNS.slice(1),
      rows: ROWS.slice(0, 3),
      copies: ['Original for Consignee', 'Duplicate for Transporter', 'Triplicate for Consignor'],
      filenameBase: `${OUT}/challan-copies`,
    })
    const text = readFileSync(`${OUT}/challan-copies.pdf`).toString('latin1')
    expect((text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(3)
    // The guard for the assertions below: if the webfont stub ever stops
    // working, jsPDF embeds Noto Sans, every string becomes glyph IDs, and the
    // caption checks start failing for a reason that looks nothing like the
    // cause. Fail here instead, where the message says what actually happened.
    expect(
      text,
      'a webfont was embedded, so PDF text is glyph-encoded and unreadable — the fetch stub is not taking effect',
    ).not.toContain('/BaseFont /NotoSans')

    for (const caption of ['ORIGINAL FOR CONSIGNEE', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR CONSIGNOR']) {
      expect(text).toContain(caption)
    }
  }, 60_000)

  it('writes a document .pdf in portrait', async () => {
    await exportDocumentPdf({
      title: 'Delivery challan',
      documentNo: 'DC-000412',
      documentDate: '18 Apr 2026',
      companyName: 'Acme Manufacturing Ltd',
      headerPairs: [{ label: 'Status', value: 'Posted' }],
      blocks: [
        { label: 'Party', value: 'Northwind Traders', lines: ['GSTIN: 27AAAPL1234C1ZV'] },
        { label: 'From', value: 'Pune Central' },
      ],
      columns: COLUMNS.slice(1),
      rows: ROWS.slice(0, 6),
      totalsRow: PAYLOAD.totalsRow,
      totalsLabel: 'Total',
      footerPairs: [{ label: 'Narration', value: 'Urgent despatch' }],
      provenance: 'Immutable print snapshot captured 18 Apr 2026 · template dc-v2',
      generatedAt: '14 Sep 2026, 18:30',
      filenameBase: `${OUT}/challan`,
    })
    const buf = readFileSync(`${OUT}/challan.pdf`)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(3_000)
  }, 60_000)
})
