import { describe, expect, it } from 'vitest'
import {
  failureReportCsv,
  IMPORT_COLUMNS,
  parseUnitSheet,
  readStatus,
  templateCsv,
  toCreatePayload,
} from './uomImport'
import type { Cell } from './uomImport'
import type { Uom } from '../../../services/masters'

const existing: Uom[] = [
  {
    unit_id: 1,
    unit_name: 'Kilogram',
    unit_symbol: 'KG',
    print_name: 'Kilogram',
    uqc_gst: 'KGS',
    decimal_places: 4,
    is_active: 1,
  },
]

const HEAD: Cell[] = [...IMPORT_COLUMNS]
const sheet = (...rows: Cell[][]) => [HEAD, ...rows]
const CODES = ['KGS', 'NOS', 'LTR', 'DOZ']

describe('parseUnitSheet', () => {
  it('reads a clean sheet', () => {
    const result = parseUnitSheet(sheet(['Litre', 'L', 'Litre', 'LTR', '4', 'Active']), existing, CODES)
    expect(result.fatal).toBeNull()
    expect(result.counts).toEqual({ total: 1, valid: 1, warning: 0, error: 0 })
    expect(result.rows[0].values.unit_name).toBe('Litre')
  })

  it('accepts the headings the export writes, so a round trip works', () => {
    const result = parseUnitSheet(
      [
        ['Unit', 'Symbol', 'Print name', 'GST UQC', 'Decimals', 'Status'],
        ['Litre', 'L', 'Litre', 'LTR', '4', 'Active'],
      ],
      existing,
      CODES,
    )
    expect(result.fatal).toBeNull()
    expect(result.counts.valid).toBe(1)
  })

  it('refuses a sheet with no heading row', () => {
    expect(parseUnitSheet([['Litre', 'L']], existing, CODES).fatal).toMatch(/No heading row/)
  })

  it('refuses a sheet without the two columns it cannot do without', () => {
    expect(parseUnitSheet([['Print Name', 'GST UQC'], ['Litre', 'LTR']], existing, CODES).fatal).toMatch(/Unit Name/)
  })

  it('reports headings it does not understand without refusing the sheet', () => {
    const result = parseUnitSheet(
      [
        ['Unit Name', 'Symbol', 'Warehouse'],
        ['Litre', 'L', 'Main'],
      ],
      existing,
      CODES,
    )
    expect(result.fatal).toBeNull()
    expect(result.unknownHeaders).toEqual(['Warehouse'])
    expect(result.counts.total).toBe(1)
  })

  it('skips blank spacing rows silently', () => {
    const result = parseUnitSheet(
      sheet(['Litre', 'L', '', 'LTR', '', ''], ['', '', '', '', '', ''], ['Dozen', 'DOZ', '', 'DOZ', '', '']),
      existing,
      CODES,
    )
    expect(result.counts.total).toBe(2)
  })

  it('refuses a row that collides with a unit already on record', () => {
    const result = parseUnitSheet(sheet(['Kilograms', 'KGM', '', 'KGS', '4', 'Active']), existing, CODES)
    expect(result.rows[0].verdict).toBe('error')
    expect(result.rows[0].messages.join(' ')).toMatch(/already exists/)
  })

  it('refuses a row whose symbol is taken', () => {
    const result = parseUnitSheet(sheet(['Kay Gee', 'kg', '', 'KGS', '4', 'Active']), existing, CODES)
    expect(result.rows[0].messages.join(' ')).toMatch(/already used by Kilogram/)
  })

  it('refuses a duplicate inside the file and names the line', () => {
    const result = parseUnitSheet(
      sheet(['Litre', 'L', '', 'LTR', '4', 'Active'], ['Litres', 'LT', '', 'LTR', '4', 'Active']),
      existing,
      CODES,
    )
    expect(result.rows[1].verdict).toBe('error')
    expect(result.rows[1].messages.join(' ')).toMatch(/line 2 of this sheet/)
  })

  it('refuses a GST code the schema does not know', () => {
    const result = parseUnitSheet(sheet(['Litre', 'L', '', 'ZZZ', '4', 'Active']), existing, CODES)
    expect(result.rows[0].verdict).toBe('error')
    expect(result.rows[0].messages.join(' ')).toMatch(/not a GST unit quantity code/)
  })

  it('refuses decimals outside what the column stores', () => {
    const result = parseUnitSheet(sheet(['Litre', 'L', '', 'LTR', '9', 'Active']), existing, CODES)
    expect(result.rows[0].verdict).toBe('error')
  })

  it('refuses a status it cannot read rather than guessing at it', () => {
    const result = parseUnitSheet(sheet(['Litre', 'L', '', 'LTR', '4', 'maybe']), existing, CODES)
    expect(result.rows[0].verdict).toBe('error')
    expect(result.rows[0].messages.join(' ')).toMatch(/not a status/)
  })

  it('warns, but still imports, a unit with no GST code', () => {
    const result = parseUnitSheet(sheet(['Widget', 'WGT', '', '', '4', 'Active']), existing, CODES)
    expect(result.rows[0].verdict).toBe('warning')
    expect(result.counts.warning).toBe(1)
  })

  it('numbers lines as the spreadsheet does, header included', () => {
    const result = parseUnitSheet(sheet(['Litre', 'L', '', 'LTR', '4', 'Active']), existing, CODES)
    expect(result.rows[0].line).toBe(2)
  })

  it('reads numeric and boolean cells, not only strings', () => {
    const result = parseUnitSheet([HEAD, ['Litre', 'L', 'Litre', 'LTR', 4, true]], existing, CODES)
    expect(result.rows[0].verdict).toBe('valid')
    expect(toCreatePayload(result.rows[0]).decimal_places).toBe(4)
    expect(toCreatePayload(result.rows[0]).is_active).toBe(1)
  })
})

describe('readStatus', () => {
  it('treats a blank as active, matching what a create defaults to', () => {
    expect(readStatus('')).toBe(true)
  })

  it('reads the spellings a person actually types', () => {
    for (const yes of ['Active', 'yes', 'TRUE', '1']) expect(readStatus(yes)).toBe(true)
    for (const no of ['Inactive', 'no', 'FALSE', '0']) expect(readStatus(no)).toBe(false)
  })

  it('refuses anything else', () => {
    expect(readStatus('perhaps')).toBeNull()
  })
})

describe('toCreatePayload', () => {
  it('sends null rather than an empty string for the optional fields', () => {
    const result = parseUnitSheet(sheet(['Widget', 'WGT', '', '', '', '']), existing, CODES)
    expect(toCreatePayload(result.rows[0])).toEqual({
      unit_name: 'Widget',
      unit_symbol: 'WGT',
      print_name: null,
      uqc_gst: null,
      decimal_places: 4,
      is_active: 1,
    })
  })
})

describe('the template and the failure report', () => {
  it('writes a template the parser accepts', () => {
    const grid = templateCsv()
      .split('\r\n')
      .map((line) => line.split(',') as Cell[])
    const result = parseUnitSheet(grid, [], CODES)
    expect(result.fatal).toBeNull()
    expect(result.counts.error).toBe(0)
    expect(result.counts.total).toBe(2)
  })

  it('escapes a reason containing a comma', () => {
    const csv = failureReportCsv([{ line: 4, name: 'Litre, big', reason: 'Refused: already exists' }])
    expect(csv.split('\r\n')[1]).toBe('4,"Litre, big",Refused: already exists')
  })
})
