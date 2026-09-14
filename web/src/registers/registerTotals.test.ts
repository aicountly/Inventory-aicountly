import { describe, expect, it } from 'vitest'
import { buildTotalsRow, sumColumn, sumColumns, totalsLabel, totalsRowToText } from './registerTotals'

const COLUMNS = [
  { key: 'movement_date' },
  { key: 'document_no' },
  { key: 'in_qty', align: 'right' as const },
  { key: 'out_qty', align: 'right' as const },
  { key: 'value', align: 'right' as const },
]

describe('buildTotalsRow', () => {
  it('covers exactly the column keys, blanking the ones with no total', () => {
    const row = buildTotalsRow(COLUMNS, { in_qty: '120', out_qty: '80' })
    expect(Object.keys(row).sort()).toEqual(
      ['document_no', 'in_qty', 'movement_date', 'out_qty', 'value'].sort(),
    )
    expect(row.value).toBe('')
  })

  it('puts the label in the first non-amount column by default', () => {
    const row = buildTotalsRow(COLUMNS, { in_qty: '120' }, { label: 'Total (12 movements)' })
    expect(row.movement_date).toBe('Total (12 movements)')
    expect(row.in_qty).toBe('120')
  })

  it('honours an explicit label column', () => {
    const row = buildTotalsRow(COLUMNS, {}, { label: 'Total', labelKey: 'document_no' })
    expect(row.document_no).toBe('Total')
    expect(row.movement_date).toBe('')
  })

  it('falls back to a spare column when the label column already has a value', () => {
    const row = buildTotalsRow(
      COLUMNS,
      { movement_date: '—' },
      { label: 'Total', labelKey: 'movement_date' },
    )
    expect(row.movement_date).toBe('—')
    expect(row.document_no).toBe('Total')
  })

  it('ignores a label column the register does not define', () => {
    const row = buildTotalsRow(COLUMNS, {}, { label: 'Total', labelKey: 'nope' })
    expect(row.movement_date).toBe('Total')
    expect(row).not.toHaveProperty('nope')
  })

  it('returns an empty record for an empty column list', () => {
    expect(buildTotalsRow([], { a: '1' })).toEqual({})
  })

  it('treats a null supplied value as absent so the cell renders blank', () => {
    const row = buildTotalsRow(COLUMNS, { value: null })
    expect(row.value).toBe('')
  })
})

describe('totalsRowToText', () => {
  it('projects string and number totals in column order', () => {
    expect(totalsRowToText(COLUMNS, { movement_date: 'Total', in_qty: '120', value: 4 })).toEqual([
      'Total',
      '',
      '120',
      '',
      '4',
    ])
  })

  it('prints a JSX total as blank rather than [object Object]', () => {
    const jsx = { type: 'span', props: {} } as unknown as string
    expect(totalsRowToText(COLUMNS, { movement_date: 'Total', in_qty: jsx })).toEqual([
      'Total',
      '',
      '',
      '',
      '',
    ])
  })

  it('returns null when there is nothing to print', () => {
    expect(totalsRowToText(COLUMNS, null)).toBeNull()
    expect(totalsRowToText(COLUMNS, undefined)).toBeNull()
    expect(totalsRowToText(COLUMNS, { movement_date: '', in_qty: '' })).toBeNull()
  })
})

describe('sumColumn / sumColumns', () => {
  const rows = [
    { qty: 10, value: '100.5', other: 'x' },
    { qty: '2.25', value: 4.5, other: null },
    { qty: null, value: undefined, other: 3 },
  ]

  it('sums numeric strings and skips non-numbers', () => {
    expect(sumColumn(rows, 'qty')).toBe(12.25)
    expect(sumColumn(rows, 'value')).toBe(105)
    expect(sumColumn(rows, 'other')).toBe(3)
    expect(sumColumn([], 'qty')).toBe(0)
  })

  it('rounds like the API does, so 0.1 + 0.2 does not leak', () => {
    expect(sumColumn([{ v: 0.1 }, { v: 0.2 }], 'v')).toBe(0.3)
  })

  it('sums several keys in one pass with the same answers', () => {
    expect(sumColumns(rows, ['qty', 'value'])).toEqual({ qty: 12.25, value: 105 })
    expect(sumColumns([], ['qty'])).toEqual({ qty: 0 })
  })
})

describe('totalsLabel', () => {
  it('counts and pluralises', () => {
    expect(totalsLabel(1, 'movement')).toBe('Total (1 movement)')
    expect(totalsLabel(12, 'movement')).toBe('Total (12 movements)')
    expect(totalsLabel(3, 'entry', 'entries')).toBe('Total (3 entries)')
  })

  it('says just Total when there is no count', () => {
    expect(totalsLabel(0, 'movement')).toBe('Total')
    expect(totalsLabel(null, 'movement')).toBe('Total')
    expect(totalsLabel(undefined, 'movement')).toBe('Total')
  })
})
