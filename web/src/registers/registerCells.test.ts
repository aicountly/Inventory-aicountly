import { describe, expect, it } from 'vitest'
import {
  cellFormat,
  cellText,
  cellValue,
  columnLabel,
  isAmountKey,
  rawCsvValue,
  toCsvColumns,
  toPrintColumns,
  toPrintRows,
} from './registerCells'
import type { ExportableColumn } from './registerCells'

interface Row {
  item_name: string | null
  closing_value: number
  closing_qty: number
  movement_date: string
  gp_rate: number
  days_to_expiry: number
  reasons: string[]
  triggered: boolean
}

const ROW: Row = {
  item_name: 'Widget',
  closing_value: 1234.5,
  closing_qty: 12.25,
  movement_date: '2026-09-14',
  gp_rate: 18.5,
  days_to_expiry: 7,
  reasons: ['below_reorder', 'no_cover'],
  triggered: true,
}

describe('isAmountKey', () => {
  it('recognises money-shaped keys', () => {
    for (const key of ['closing_value', 'unit_cost', 'stock_value', 'amount', 'debit', 'credit', 'total_value']) {
      expect(isAmountKey(key), key).toBe(true)
    }
  })

  it('refuses the keys that merely look like money', () => {
    // The trap the port has to survive: percentages, day counts and ids must
    // never be printed with a rupee format.
    for (const key of ['gp_rate', 'turnover', 'days_to_expiry', 'lead_time_days', 'item_id', 'weighted_age_days']) {
      expect(isAmountKey(key), key).toBe(false)
    }
    expect(isAmountKey('')).toBe(false)
    expect(isAmountKey('item_name')).toBe(false)
  })
})

describe('columnLabel', () => {
  it('prefers csvHeader, then a string header, then the key', () => {
    expect(columnLabel({ key: 'a', header: 'Header', csvHeader: 'CSV' })).toBe('CSV')
    expect(columnLabel({ key: 'a', header: 'Header' })).toBe('Header')
    expect(columnLabel({ key: 'a' })).toBe('a')
    // A JSX header is not a string; the key is the only honest fallback.
    expect(columnLabel({ key: 'a', header: { type: 'span' } })).toBe('a')
  })
})

describe('rawCsvValue', () => {
  it('passes scalars, joins arrays and stringifies objects', () => {
    expect(rawCsvValue('x')).toBe('x')
    expect(rawCsvValue(3)).toBe(3)
    expect(rawCsvValue(false)).toBe(false)
    expect(rawCsvValue(null)).toBeNull()
    expect(rawCsvValue(undefined)).toBeNull()
    expect(rawCsvValue(['a', 'b'])).toBe('a; b')
    expect(rawCsvValue([{ a: 1 }])).toBe('{"a":1}')
    expect(rawCsvValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe('cellValue / cellFormat / cellText', () => {
  it('reads the field by key when the column has no csv resolver', () => {
    expect(cellValue(ROW, { key: 'item_name' })).toBe('Widget')
    expect(cellValue(ROW, { key: 'reasons' })).toBe('below_reorder; no_cover')
  })

  it('prefers the column csv resolver', () => {
    const col: ExportableColumn<Row> = { key: 'triggered', csv: (r) => (r.triggered ? 'yes' : 'no') }
    expect(cellValue(ROW, col)).toBe('yes')
  })

  it('derives the format from explicit metadata first', () => {
    expect(cellFormat({ key: 'x', format: 'qty' })).toBe('qty')
    expect(cellFormat({ key: 'closing_value', exportType: 'text' })).toBe('text')
    expect(cellFormat({ key: 'anything', amount: true })).toBe('amount')
  })

  it('falls back to the key heuristic only for right-aligned columns', () => {
    expect(cellFormat({ key: 'closing_value', align: 'right' })).toBe('amount')
    // Left-aligned: a description column named "total_remarks" is still text.
    expect(cellFormat({ key: 'closing_value' })).toBe('text')
    expect(cellFormat({ key: 'days_to_expiry', align: 'right' })).toBe('text')
  })

  it('formats each cell for print', () => {
    expect(cellText(ROW, { key: 'closing_value', align: 'right' })).toBe('1,234.50')
    expect(cellText(ROW, { key: 'closing_qty', align: 'right', format: 'qty' })).toBe('12.25')
    // The month abbreviation comes from the platform's ICU data ("Sep" vs
    // "Sept"), so assert the parts this module is responsible for.
    expect(cellText({ ...ROW, movement_date: '2026-04-01' }, { key: 'movement_date', format: 'date' })).toBe(
      '01 Apr 2026',
    )
    expect(cellText(ROW, { key: 'days_to_expiry', align: 'right' })).toBe('7')
    expect(cellText(ROW, { key: 'triggered' })).toBe('Yes')
    expect(cellText(ROW, { key: 'item_name' })).toBe('Widget')
  })

  it('renders blank rather than a dash for an absent value', () => {
    // A print sheet full of em-dashes reads as data; blank reads as absent.
    expect(cellText({ ...ROW, item_name: null }, { key: 'item_name' })).toBe('')
    expect(cellText(ROW, { key: 'missing', align: 'right', format: 'amount' })).toBe('')
  })
})

describe('column projections', () => {
  const columns: ExportableColumn<Row>[] = [
    { key: 'item_name', header: 'Item' },
    { key: 'closing_qty', header: 'Closing', align: 'right', format: 'qty' },
    { key: 'closing_value', header: 'Value', align: 'right', format: 'amount', csvHeader: 'Closing value' },
  ]

  it('builds CSV columns that match the screen', () => {
    const csv = toCsvColumns(columns)
    expect(csv.map((c) => c.header)).toEqual(['Item', 'Closing', 'Closing value'])
    expect(csv[2].value(ROW)).toBe(1234.5)
  })

  it('builds print columns and pre-formatted print rows in column order', () => {
    expect(toPrintColumns(columns)).toEqual([
      { key: 'item_name', label: 'Item', align: undefined },
      { key: 'closing_qty', label: 'Closing', align: 'right' },
      { key: 'closing_value', label: 'Closing value', align: 'right' },
    ])
    expect(toPrintRows([ROW], columns)).toEqual([['Widget', '12.25', '1,234.50']])
  })
})
