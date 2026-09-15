import { describe, expect, it } from 'vitest'
import { buildDocumentPrintHtml, buildTabularPrintHtml } from './sheetHtml'
import type { ExportColumn, ExportRow } from './exportColumns'

/**
 * String assertions catch a missing label; they do not catch a table whose
 * footer has one cell fewer than its header — which is how a printed register
 * silently shifts every total one column to the left. These tests parse the
 * generated document and check it as a document.
 *
 * Runs in the happy-dom project because it needs a real parser.
 */

const COLUMNS: ExportColumn[] = [
  { key: 'movement_date', label: 'Date', format: 'date', align: 'left', excelWidth: 13, pdfWeight: 11 },
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 34, pdfWeight: 26 },
  { key: 'warehouse', label: 'Warehouse', format: 'text', align: 'left', excelWidth: 20, pdfWeight: 16 },
  { key: 'in_qty', label: 'In qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10 },
  { key: 'out_qty', label: 'Out qty', format: 'qty', align: 'right', excelWidth: 13, pdfWeight: 10 },
  { key: 'value', label: 'Value', format: 'amount', align: 'right', excelWidth: 16, pdfWeight: 13 },
]

function mkRow(i: number): ExportRow {
  return {
    movement_date: { value: '18 Apr 2026', text: '18 Apr 2026' },
    item_name: { value: `Widget ${i}`, text: `Widget ${i}` },
    warehouse: { value: 'Pune Central', text: 'Pune Central' },
    in_qty: { value: i, text: String(i) },
    out_qty: { value: '', text: '' },
    value: { value: i * 100, text: (i * 100).toFixed(2) },
  }
}

const ROWS = Array.from({ length: 12 }, (_, i) => mkRow(i + 1))

const TOTALS: ExportRow = {
  movement_date: { value: '', text: '' },
  item_name: { value: '', text: '' },
  warehouse: { value: '', text: '' },
  in_qty: { value: 78, text: '78' },
  out_qty: { value: '', text: '' },
  value: { value: 7800, text: '7,800.00' },
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('printed register structure', () => {
  const doc = parse(
    buildTabularPrintHtml({
      title: 'Stock movement register',
      companyName: 'Acme Ltd',
      columns: COLUMNS,
      rows: ROWS,
      totalsRow: TOTALS,
      totalsLabel: 'Total (412 movements)',
      metaLines: ['Period: 01 Apr 2026 to 14 Sep 2026'],
      summaryCards: [{ label: 'Closing value', value: '₹ 7,800' }],
    }),
  )

  it('is one table with a head, a body and a foot', () => {
    expect(doc.querySelectorAll('table')).toHaveLength(1)
    expect(doc.querySelectorAll('thead tr')).toHaveLength(1)
    expect(doc.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(doc.querySelectorAll('tfoot tr')).toHaveLength(1)
  })

  /** The bug this exists to prevent: a footer that does not line up. */
  it('has the same number of cells in every row of the table', () => {
    const width = COLUMNS.length
    expect(doc.querySelectorAll('thead th')).toHaveLength(width)
    expect(doc.querySelectorAll('colgroup col')).toHaveLength(width)
    for (const tr of doc.querySelectorAll('tbody tr')) {
      expect(tr.querySelectorAll('td')).toHaveLength(width)
    }
    expect(doc.querySelectorAll('tfoot td')).toHaveLength(width)
  })

  it('puts the totals label in the same column the screen does', () => {
    const cells = [...doc.querySelectorAll('tfoot td')].map((td) => td.textContent)
    // registerTotals picks the first non-right-aligned column; here that is Date.
    expect(cells[0]).toBe('Total (412 movements)')
    expect(cells[5]).toBe('7,800.00')
  })

  it('right-aligns exactly the numeric columns, in head, body and foot', () => {
    const numeric = [3, 4, 5]
    const heads = [...doc.querySelectorAll('thead th')]
    heads.forEach((th, i) => {
      expect(th.classList.contains('num')).toBe(numeric.includes(i))
    })
    const firstBodyRow = [...doc.querySelectorAll('tbody tr')[0].querySelectorAll('td')]
    firstBodyRow.forEach((td, i) => {
      expect(td.classList.contains('num')).toBe(numeric.includes(i))
    })
  })

  it('carries the letterhead, the meta pill and the summary card', () => {
    expect(doc.querySelector('.company')?.textContent).toBe('Acme Ltd')
    expect(doc.querySelector('.title')?.textContent).toBe('Stock movement register')
    expect([...doc.querySelectorAll('.pill')].map((p) => p.textContent)).toEqual([
      'Period: 01 Apr 2026 to 14 Sep 2026',
    ])
    expect(doc.querySelector('.kpi .k')?.textContent).toBe('Closing value')
  })

  it('escapes injected markup into text rather than nodes', () => {
    const hostile = parse(
      buildTabularPrintHtml({
        title: 'Register',
        companyName: '<img src=x onerror=alert(1)>',
        columns: [COLUMNS[1]],
        rows: [{ item_name: { value: '<b>bold</b>', text: '<b>bold</b>' } }],
      }),
    )
    expect(hostile.querySelectorAll('img')).toHaveLength(0)
    expect(hostile.querySelectorAll('tbody b')).toHaveLength(0)
    expect(hostile.querySelector('tbody td')?.textContent).toBe('<b>bold</b>')
    expect(hostile.querySelector('.company')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('spans the empty message across every column', () => {
    const empty = parse(
      buildTabularPrintHtml({ title: 'R', columns: COLUMNS, rows: [] }),
    )
    expect(empty.querySelector('tbody td')?.getAttribute('colspan')).toBe(String(COLUMNS.length))
  })
})

describe('printed document structure', () => {
  const doc = parse(
    buildDocumentPrintHtml({
      title: 'Delivery challan',
      documentNo: 'DC-000412',
      documentDate: '18 Apr 2026',
      companyName: 'Acme Ltd',
      blocks: [
        { label: 'Party', value: 'Northwind Traders', lines: ['GSTIN: 27AAAPL1234C1ZV'] },
        { label: 'From', value: 'Pune Central' },
        { label: 'Empty', value: '', lines: [] },
      ],
      columns: COLUMNS.slice(1),
      rows: ROWS.slice(0, 3),
      totalsRow: TOTALS,
      provenance: 'Immutable print snapshot captured 18 Apr 2026 · template dc-v2',
    }),
  )

  it('renders one block per populated block, and drops the empty one', () => {
    const blocks = [...doc.querySelectorAll('.block')]
    expect(blocks).toHaveLength(2)
    expect(blocks[0].querySelector('.k')?.textContent).toBe('Party')
    expect(blocks[0].querySelector('.n')?.textContent).toBe('Northwind Traders')
  })

  it('lines the line table up across head, body and foot', () => {
    const width = COLUMNS.length - 1
    expect(doc.querySelectorAll('thead th')).toHaveLength(width)
    for (const tr of doc.querySelectorAll('tbody tr')) {
      expect(tr.querySelectorAll('td')).toHaveLength(width)
    }
    expect(doc.querySelectorAll('tfoot td')).toHaveLength(width)
  })

  it('prints one unmarked sheet when no copies are asked for', () => {
    expect(doc.querySelectorAll('.copy-tag')).toHaveLength(0)
    expect(doc.querySelectorAll('.page-break')).toHaveLength(0)
  })

  it('prints one captioned sheet per copy, separated by a page break', () => {
    const copies = parse(
      buildDocumentPrintHtml({
        title: 'Delivery challan',
        documentNo: 'DC-000412',
        companyName: 'Acme Ltd',
        columns: COLUMNS.slice(1),
        rows: ROWS.slice(0, 2),
        copies: ['Original for Consignee', 'Duplicate for Transporter', 'Triplicate for Consignor'],
      }),
    )
    const tags = [...copies.querySelectorAll('.copy-tag')].map((el) => el.textContent)
    expect(tags).toEqual([
      'Original for Consignee',
      'Duplicate for Transporter',
      'Triplicate for Consignor',
    ])
    expect(copies.querySelectorAll('table')).toHaveLength(3)
    expect(copies.querySelectorAll('.page-break')).toHaveLength(2)
  })

  it('prints three signature slots and the provenance line', () => {
    expect(doc.querySelectorAll('.sign div')).toHaveLength(3)
    expect(doc.querySelector('.prov')?.textContent).toContain('Immutable print snapshot')
  })
})
