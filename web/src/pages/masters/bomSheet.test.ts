import { describe, expect, it } from 'vitest'
import { BOM_SHEET_COLUMNS, bomSheetRows, buildBomSheet } from './bomSheet'
import type { BomSheetRow } from './bomSheet'
import { componentQty } from '../../documents/bom'
import { buildTabularPayload } from '../../export/exportActions'
import { cellText, columnLabel } from '../../registers/registerCells'
import type { Bom, BomLine } from '../../services/masters'

const LINES: BomLine[] = [
  { bom_line_id: 1, item_id: 2, qty: 4, unit_id: 7, line_kind: 'component', scrap_percent: 0, sort_order: 0, item_name: 'Leg', item_sku: 'LG-1', unit_symbol: 'Nos' },
  { bom_line_id: 2, item_id: 3, qty: 1.5, unit_id: 8, line_kind: 'component', scrap_percent: 10, sort_order: 1, item_name: 'Seat board', item_sku: null, unit_symbol: 'Kg' },
  { bom_line_id: 3, item_id: 4, qty: 0.25, unit_id: 8, line_kind: 'by_product', scrap_percent: 10, sort_order: 2, item_name: 'Offcut', item_sku: 'OC-1', unit_symbol: 'Kg' },
  { bom_line_id: 4, item_id: 5, qty: 0.1, unit_id: 8, line_kind: 'scrap', scrap_percent: 0, sort_order: 3, item_name: 'Sawdust', item_sku: null, unit_symbol: 'Kg' },
]

function bom(over: Partial<Bom> = {}): Bom {
  return {
    bom_id: 12,
    bom_name: 'Chair BOM',
    finished_item_id: 10,
    yield_qty: 2,
    yield_unit_id: 1,
    is_active: 1,
    finished_item_name: 'Chair',
    finished_item_sku: 'CH-1',
    yield_unit_symbol: 'Nos',
    line_count: LINES.length,
    updated_at: '2026-09-14 11:30:00',
    lines: LINES,
    ...over,
  }
}

describe('bomSheetRows', () => {
  it('keeps the stored line order and labels each kind', () => {
    expect(bomSheetRows(LINES).map((r) => [r.line_no, r.kind, r.item])).toEqual([
      [1, 'Component', 'Leg'],
      [2, 'Component', 'Seat board'],
      [3, 'By-product', 'Offcut'],
      [4, 'Scrap', 'Sawdust'],
    ])
  })

  it('prints the effective quantity the production explosion will move', () => {
    const rows = bomSheetRows(LINES)
    // Same helper, same scale-1 arithmetic as scaleBomLines: the paper must not
    // promise a consumption the posting path does not make.
    expect(rows[1].effective_qty).toBe(componentQty(1.5, 1, 10))
    expect(rows[1].effective_qty).toBe(1.65)
  })

  it('applies scrap to component lines only', () => {
    const rows = bomSheetRows(LINES)
    // The by-product line carries scrap_percent 10 and must still print 0.25:
    // scaleBomLines passes 0 for anything that is not a component, so an
    // uplift here would be a quantity nothing ever produces.
    expect(rows[2]).toMatchObject({ kind: 'By-product', qty: 0.25, scrap_percent: 0, effective_qty: 0.25 })
    expect(rows[3]).toMatchObject({ kind: 'Scrap', qty: 0.1, scrap_percent: 0, effective_qty: 0.1 })
  })

  it('falls back to the id when an item name did not come back, and blanks a missing sku', () => {
    const rows = bomSheetRows([{ item_id: 99, qty: 1, unit_id: null, line_kind: 'component', scrap_percent: 0, sort_order: 0 }])
    expect(rows[0]).toMatchObject({ item: '#99', sku: '', unit: '' })
  })

  it('treats an unknown line_kind as a component', () => {
    const rows = bomSheetRows([{ item_id: 6, qty: 2, unit_id: null, line_kind: 'phase_2_kind', scrap_percent: 50, sort_order: 0 }])
    expect(rows[0]).toMatchObject({ kind: 'Component', scrap_percent: 50, effective_qty: 3 })
  })
})

describe('buildBomSheet', () => {
  it('states the finished item, the yield and the bill on the letterhead', () => {
    const sheet = buildBomSheet(bom())
    expect(sheet.title).toBe('Chair BOM')
    expect(sheet.metaLines.slice(0, 3)).toEqual([
      'Finished item: Chair (CH-1)',
      'Yield: 2 Nos per run',
      'Bill: #12',
    ])
    // The month abbreviation is the runtime's (`Sep` / `Sept` by ICU version),
    // so the day, year and clock time are what is pinned.
    expect(sheet.metaLines[3]).toMatch(/^Last updated: 14 Sept? 2026, 11:30$/)
    expect(sheet.filenameBase).toBe('bill-of-materials-12')
  })

  it('counts the lines by kind instead of totalling quantities across units', () => {
    const sheet = buildBomSheet(bom())
    expect(sheet.summaryCards.map((c) => [c.label, c.value])).toEqual([
      ['Status', 'Active'],
      ['Yield', '2 Nos'],
      ['Components', '2'],
      ['By-products', '1'],
      ['Scrap lines', '1'],
    ])
    // Kg and Nos on the same sheet: any single "total quantity" figure would be
    // wrong in both units, so the sheet carries none and says why.
    expect(sheet.footerNotes).toContain('Quantities are not totalled: lines can be in different units.')
  })

  it('omits the by-product and scrap cards when the bill has none', () => {
    const sheet = buildBomSheet(bom({ lines: [LINES[0]] }))
    expect(sheet.summaryCards.map((c) => c.label)).toEqual(['Status', 'Yield', 'Components'])
  })

  it('marks an inactive bill on the paper, not only on the screen', () => {
    const sheet = buildBomSheet(bom({ is_active: 0 }))
    const status = sheet.summaryCards[0]
    expect(status).toMatchObject({ label: 'Status', value: 'Inactive', tone: 'warn' })
    expect(sheet.footerNotes[0]).toContain('inactive')
  })

  it('leaves no inactive warning on an active bill', () => {
    const sheet = buildBomSheet(bom())
    expect(sheet.summaryCards[0]).toMatchObject({ value: 'Active', tone: 'default' })
    expect(sheet.footerNotes.join(' ')).not.toContain('is inactive')
  })

  it('says the sheet is the saved bill, not the draft on screen', () => {
    expect(buildBomSheet(bom()).footerNotes).toContain(
      'Printed from the saved bill of materials — unsaved changes on screen are not included.',
    )
  })

  it('survives a bill whose lines were not requested', () => {
    const sheet = buildBomSheet(bom({ lines: undefined }))
    expect(sheet.rows).toEqual([])
    expect(sheet.summaryCards.map((c) => c.label)).toEqual(['Status', 'Yield', 'Components'])
  })

  it('degrades to the id and drops the unit when the bill carries neither', () => {
    const sheet = buildBomSheet(bom({ finished_item_name: null, finished_item_sku: null, yield_unit_symbol: null }))
    expect(sheet.metaLines[0]).toBe('Finished item: #10')
    expect(sheet.metaLines[1]).toBe('Yield: 2 per run')
  })
})

describe('the printed sheet itself', () => {
  it('carries no rate, cost or value column — a BOM holds quantities', () => {
    const headers = BOM_SHEET_COLUMNS.map((c) => columnLabel(c).toLowerCase())
    for (const banned of ['rate', 'cost', 'value', 'amount', 'price']) {
      expect(headers.some((h) => h.includes(banned)), banned).toBe(false)
    }
  })

  it('formats every numeric column as a number rather than raw text', () => {
    // Four digits so the grouping separator shows: `String(1234.5)` is
    // "1234.5", which is what an unformatted column would print.
    const row = bomSheetRows([{ item_id: 2, qty: 1234.5, unit_id: null, line_kind: 'component', scrap_percent: 12.5, sort_order: 0 }])[0]
    const text = (key: string) => cellText(row, BOM_SHEET_COLUMNS.find((c) => c.key === key)!)
    expect(text('qty')).toBe('1,234.5')
    expect(text('effective_qty')).toBe('1,388.8125')
    expect(text('scrap_percent')).toBe('12.5')
    expect(text('line_no')).toBe('1')
  })

  it('builds a tabular payload with the letterhead, the cards and no totals row', () => {
    const sheet = buildBomSheet(bom())
    const payload = buildTabularPayload<BomSheetRow>({
      columns: BOM_SHEET_COLUMNS,
      rows: sheet.rows,
      identity: { companyName: 'Acme Ltd', scopeLabel: 'Acme Ltd · FY 2026-27 · Head office' },
      title: sheet.title,
      description: sheet.description,
      metaLines: sheet.metaLines,
      summaryCards: sheet.summaryCards,
      footerNotes: sheet.footerNotes,
      orientation: 'portrait',
      filenameBase: sheet.filenameBase,
    })
    expect(payload.companyName).toBe('Acme Ltd')
    expect(payload.columns.map((c) => c.key)).toEqual(BOM_SHEET_COLUMNS.map((c) => c.key))
    expect(payload.rows).toHaveLength(4)
    expect(payload.totalsRow).toBeNull()
    expect(payload.orientation).toBe('portrait')
    // The notes have to reach the spreadsheet too, or an xlsx of the bill is
    // the only copy that does not say what "effective qty" means.
    expect(payload.excelNotes).toEqual(sheet.footerNotes)
  })
})
