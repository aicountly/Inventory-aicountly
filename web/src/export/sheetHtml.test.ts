import { describe, expect, it } from 'vitest'
import { buildDocumentPrintHtml, buildTabularPrintHtml, escapeHtml, nameColumnIndex } from './sheetHtml'
import type { ExportColumn, ExportRow } from './exportColumns'

const COLUMNS: ExportColumn[] = [
  { key: 'movement_date', label: 'Date', format: 'date', align: 'left', excelWidth: 13, pdfWeight: 11 },
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 34, pdfWeight: 26 },
  { key: 'out_qty', label: 'Out qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10, tone: 'credit' },
  { key: 'value', label: 'Value', format: 'amount', align: 'right', excelWidth: 16, pdfWeight: 12 },
]

function row(date: string, item: string, qty: number, value: number): ExportRow {
  return {
    movement_date: { value: date, text: date },
    item_name: { value: item, text: item },
    out_qty: { value: qty, text: String(qty) },
    value: { value, text: value.toFixed(2) },
  }
}

const ROWS = [row('18 Apr 2026', 'Widget A', 10, 1200), row('19 Apr 2026', 'Widget B', 4, 200)]

const BASE = {
  title: 'Stock movement register',
  description: 'Every movement in the period',
  companyName: 'Acme Ltd',
  scopeLabel: 'Acme Ltd · FY 2026-27 · Head office',
  metaLines: ['Period: 01 Apr 2026 to 14 Sep 2026', 'Rows: 412'],
  columns: COLUMNS,
  rows: ROWS,
  generatedAt: '14 Sep 2026, 18:30',
}

describe('escapeHtml', () => {
  it('escapes everything that could close a tag or an attribute', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    )
  })

  it('renders null and undefined as empty but keeps a zero', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(0)).toBe('0')
  })
})

describe('buildTabularPrintHtml', () => {
  it('is a complete standalone document that needs no app stylesheet', () => {
    const html = buildTabularPrintHtml(BASE)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Stock movement register</title>')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
    expect(html).not.toContain('<link')
  })

  it('carries the company, the scope line and every meta pill', () => {
    const html = buildTabularPrintHtml(BASE)
    expect(html).toContain('Acme Ltd')
    expect(html).toContain('Acme Ltd · FY 2026-27 · Head office')
    expect(html).toContain('Period: 01 Apr 2026 to 14 Sep 2026')
    expect(html).toContain('Rows: 412')
    expect(html).toContain('Generated 14 Sep 2026, 18:30')
  })

  it('renders one header and one body cell per column, right-aligning numbers', () => {
    const html = buildTabularPrintHtml(BASE)
    expect(html).toContain('<th>Date</th>')
    expect(html).toContain('<th class="num">Value</th>')
    expect(html).toContain('<td class="num">1200.00</td>')
    expect((html.match(/<tr>/g) ?? []).length).toBe(3)
  })

  it('prints outward quantities red, the way the screen shows them', () => {
    expect(buildTabularPrintHtml(BASE)).toContain('<td class="num credit">10</td>')
  })

  it('emits proportional column widths for every column', () => {
    const html = buildTabularPrintHtml(BASE)
    const widths = [...html.matchAll(/<col style="width:([\d.]+)%">/g)].map((m) => Number(m[1]))
    expect(widths).toHaveLength(4)
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1)
  })

  it('pins the totals row, and fills the label column when the row leaves it blank', () => {
    const totals: ExportRow = {
      movement_date: { value: '', text: '' },
      item_name: { value: '', text: '' },
      out_qty: { value: 14, text: '14' },
      value: { value: 1400, text: '1,400.00' },
    }
    const html = buildTabularPrintHtml({ ...BASE, totalsRow: totals, totalsLabel: 'Total (412 movements)' })
    expect(html).toContain('<tfoot>')
    expect(html).toContain('Total (412 movements)')
    expect(html).toContain('<td class="num">1,400.00</td>')
  })

  it('omits the foot entirely when there are no totals', () => {
    expect(buildTabularPrintHtml(BASE)).not.toContain('<tfoot>')
  })

  it('prints headed paper with a message when nothing matched', () => {
    const html = buildTabularPrintHtml({ ...BASE, rows: [] })
    expect(html).toContain('Acme Ltd')
    expect(html).toContain('No rows match these filters.')
    expect(html).toContain('colspan="4"')
  })

  it('shows summary cards and a truncation warning', () => {
    const html = buildTabularPrintHtml({
      ...BASE,
      summaryCards: [{ label: 'Closing value', value: '₹ 12,40,000', hint: '412 items' }],
      warningNote: 'Only the first 10,000 rows are included.',
    })
    expect(html).toContain('Closing value')
    expect(html).toContain('412 items')
    expect(html).toContain('class="warn"')
    expect(html).toContain('Only the first 10,000 rows are included.')
  })

  it('escapes every piece of caller data', () => {
    const html = buildTabularPrintHtml({
      ...BASE,
      companyName: 'Acme <b>Ltd</b>',
      title: 'Register & Co',
      columns: [{ key: 'a', label: '<Item>', format: 'text', align: 'left', excelWidth: 10, pdfWeight: 10 }],
      rows: [{ a: { value: '<script>alert(1)</script>', text: '<script>alert(1)</script>' } }],
    })
    expect(html).not.toContain('<b>Ltd</b>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Register &amp; Co')
  })

  it('defaults to A4 landscape and honours an override', () => {
    expect(buildTabularPrintHtml(BASE)).toContain('@page { size: A4 landscape;')
    expect(buildTabularPrintHtml({ ...BASE, orientation: 'portrait', paperSize: 'Letter' })).toContain(
      '@page { size: Letter portrait;',
    )
  })

  it('repeats the table head and foot across printed pages', () => {
    const css = buildTabularPrintHtml(BASE)
    expect(css).toContain('thead { display: table-header-group; }')
    expect(css).toContain('tfoot { display: table-footer-group; }')
  })

  it('forces colour printing so the accent survives the driver', () => {
    expect(buildTabularPrintHtml(BASE)).toContain('print-color-adjust: exact')
  })
})

describe('buildDocumentPrintHtml', () => {
  const DOC = {
    title: 'Delivery challan',
    documentNo: 'DC-000412',
    documentDate: '18 Apr 2026',
    companyName: 'Acme Ltd',
    headerPairs: [{ label: 'Status', value: 'Posted' }],
    blocks: [
      { label: 'Party', value: 'Northwind Traders', lines: ['GSTIN: 27AAAPL1234C1ZV'] },
      { label: 'From', value: 'Pune Central' },
    ],
    columns: COLUMNS,
    rows: ROWS,
    footerPairs: [{ label: 'Narration', value: 'Urgent despatch' }],
    provenance: 'Immutable print snapshot captured 18 Apr 2026 · template dc-v2',
    generatedAt: '14 Sep 2026, 18:30',
  }

  it('titles the browser tab with the document number', () => {
    expect(buildDocumentPrintHtml(DOC)).toContain('<title>Delivery challan DC-000412</title>')
  })

  it('puts the number, date and status beside the letterhead', () => {
    const html = buildDocumentPrintHtml(DOC)
    expect(html).toContain('No. DC-000412')
    expect(html).toContain('Date 18 Apr 2026')
    expect(html).toContain('Status: Posted')
  })

  it('renders the party and warehouse blocks', () => {
    const html = buildDocumentPrintHtml(DOC)
    expect(html).toContain('Northwind Traders')
    expect(html).toContain('GSTIN: 27AAAPL1234C1ZV')
    expect(html).toContain('Pune Central')
  })

  it('states on the page where the figures came from', () => {
    expect(buildDocumentPrintHtml(DOC)).toContain('Immutable print snapshot captured')
  })

  it('prints signature lines by default and none when asked', () => {
    expect(buildDocumentPrintHtml(DOC)).toContain('Authorised signatory')
    expect(buildDocumentPrintHtml({ ...DOC, signatures: [] })).not.toContain('class="sign"')
  })

  it('defaults to portrait — a challan is not a register', () => {
    expect(buildDocumentPrintHtml(DOC)).toContain('@page { size: A4 portrait;')
  })

  it('says so when a document has no lines', () => {
    expect(buildDocumentPrintHtml({ ...DOC, rows: [] })).toContain('This document has no lines.')
  })

  it('escapes document data too', () => {
    const html = buildDocumentPrintHtml({ ...DOC, documentNo: '<img src=x onerror=1>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=1&gt;')
  })
})

describe('nameColumnIndex', () => {
  it('finds the first text column, which carries the row’s name', () => {
    expect(nameColumnIndex(COLUMNS)).toBe(1)
  })

  it('falls back to the first column when every column is numeric', () => {
    expect(nameColumnIndex([COLUMNS[2], COLUMNS[3]])).toBe(0)
  })
})
