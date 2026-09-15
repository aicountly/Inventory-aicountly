import { describe, expect, it } from 'vitest'
import { buildTabularPrintHtml } from './sheetHtml'
import type { ExportColumn, ExportRow } from './exportColumns'

/**
 * The emphasis a KPI card carries on paper.
 *
 * On a Negative stock or Expiry register the one figure the reader is meant to
 * notice is the red one. It has to stay findable when the register is printed,
 * so the sheet draws a critical card in red and a warning card in amber rather
 * than flattening both into the body colour.
 */

const COLUMNS: ExportColumn[] = [
  { key: 'item_name', label: 'Item', format: 'text', align: 'left', excelWidth: 30, pdfWeight: 24 },
  { key: 'qty', label: 'Qty', format: 'qty', align: 'right', excelWidth: 12, pdfWeight: 10 },
]

const ROWS: ExportRow[] = [{ item_name: { value: 'Widget A', text: 'Widget A' }, qty: { value: -4, text: '-4' } }]

function sheet(tone: 'default' | 'credit' | 'warn' | undefined): string {
  return buildTabularPrintHtml({
    title: 'Negative stock register',
    columns: COLUMNS,
    rows: ROWS,
    summaryCards: [{ label: 'Items below zero', value: '7', hint: 'all rows', tone }],
  })
}

describe('a KPI card on the printed sheet', () => {
  it('draws a critical figure in the house red', () => {
    expect(sheet('credit')).toContain('<div class="kpi credit">')
  })

  it('draws a warning figure in amber, not in the red that means wrong', () => {
    const html = sheet('warn')
    expect(html).toContain('<div class="kpi warn">')
    expect(html).toContain('.kpi.warn .v { color: rgb(217, 119, 6); }')
  })

  it('leaves an ordinary figure alone', () => {
    expect(sheet('default')).toContain('<div class="kpi">')
    expect(sheet(undefined)).toContain('<div class="kpi">')
  })
})
