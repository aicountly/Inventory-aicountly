import { describe, expect, it } from 'vitest'
import { csvColumnsFromTable, defaultPeriod, expiryTone, filterUrlKeys, rawCsvValue, resolveFilterValues, sumBy } from './helpers'
import type { ReportFilter } from './types'

const ctx = { fyFrom: '2025-04-01', fyTo: '2026-03-31', today: '2025-09-12' }

describe('resolveFilterValues', () => {
  const filters: ReportFilter[] = [
    { key: 'item_id', kind: 'item', label: 'Item' },
    { key: 'nonzero', kind: 'toggle', label: 'Non-zero', defaultOn: true },
    { key: 'by_warehouse', kind: 'toggle', label: 'By warehouse' },
    { key: 'as_of', kind: 'date', label: 'As of', defaultValue: (c) => c.today },
    { key: 'days', kind: 'number', label: 'Days', defaultValue: () => '30' },
  ]

  it('lets the URL win and fills defaults otherwise', () => {
    expect(resolveFilterValues(filters, { nonzero: '0', as_of: '2025-05-01' }, ctx)).toEqual({ nonzero: '0', by_warehouse: '0', as_of: '2025-05-01', days: '30' })
  })

  it('applies toggle defaults and skips filters with no default', () => {
    expect(resolveFilterValues(filters, {}, ctx)).toEqual({ nonzero: '1', by_warehouse: '0', as_of: '2025-09-12', days: '30' })
  })
})

describe('date_range filters', () => {
  const period: ReportFilter[] = [
    { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period', defaultValue: (c) => c.fyFrom, defaultToValue: (c) => c.today },
  ]

  it('resolves both ends of the range from one declaration', () => {
    expect(resolveFilterValues(period, {}, ctx)).toEqual({ from: '2025-04-01', to: '2025-09-12' })
  })

  it('lets the URL win for either end independently', () => {
    // An old bookmark that only carries `from` still resolves, and only the
    // missing end takes its default.
    expect(resolveFilterValues(period, { from: '2025-06-01' }, ctx)).toEqual({ from: '2025-06-01', to: '2025-09-12' })
    expect(resolveFilterValues(period, { to: '2025-07-31' }, ctx)).toEqual({ from: '2025-04-01', to: '2025-07-31' })
  })

  it('uses `to` as the second key when none is named', () => {
    const anonymous: ReportFilter[] = [{ key: 'from', kind: 'date_range', label: 'Period', defaultToValue: () => '2025-12-31' }]
    expect(resolveFilterValues(anonymous, {}, ctx)).toEqual({ to: '2025-12-31' })
  })
})

describe('filterUrlKeys', () => {
  it('names every URL key a filter list owns, second date ends included', () => {
    const filters: ReportFilter[] = [
      { key: 'item_id', kind: 'item', label: 'Item' },
      { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' },
      { key: 'posted_from', toKey: 'posted_to', kind: 'date_range', label: 'Posted' },
    ]
    expect(filterUrlKeys(filters)).toEqual(['item_id', 'from', 'to', 'posted_from', 'posted_to'])
  })

  it('does not repeat a key declared both inside and outside a range', () => {
    const filters: ReportFilter[] = [
      { key: 'from', toKey: 'to', kind: 'date_range', label: 'Period' },
      { key: 'to', kind: 'date', label: 'To', hidden: true },
    ]
    expect(filterUrlKeys(filters)).toEqual(['from', 'to'])
  })
})

describe('defaultPeriod', () => {
  it('uses the financial year, capped at today', () => {
    expect(defaultPeriod({ from: '2025-04-01', to: '2026-03-31' }, '2025-09-12')).toEqual({ from: '2025-04-01', to: '2025-09-12' })
  })

  it('keeps a past financial year intact', () => {
    expect(defaultPeriod({ from: '2023-04-01', to: '2024-03-31' }, '2025-09-12')).toEqual({ from: '2023-04-01', to: '2024-03-31' })
  })

  it('tolerates an unknown range', () => {
    expect(defaultPeriod({ from: '', to: '' }, '2025-09-12')).toEqual({ from: '', to: '2025-09-12' })
  })
})

describe('csvColumnsFromTable', () => {
  it('uses the raw field unless a csv accessor is given', () => {
    const cols = csvColumnsFromTable<{ name: string; qty: number; tags: string[] }>([
      { key: 'name', header: 'Item' },
      { key: 'qty', header: 'Qty', csv: (r) => r.qty * 2, csvHeader: 'Qty x2' },
      { key: 'tags', header: 'Tags' },
    ])
    const row = { name: 'Bolt', qty: 2, tags: ['a', 'b'] }
    expect(cols.map((c) => c.header)).toEqual(['Item', 'Qty x2', 'Tags'])
    expect(cols.map((c) => c.value(row))).toEqual(['Bolt', 4, 'a; b'])
  })
})

describe('rawCsvValue / expiryTone / sumBy', () => {
  it('serialises nested values', () => {
    expect(rawCsvValue({ a: 1 })).toBe('{"a":1}')
    expect(rawCsvValue([{ a: 1 }, 'x'])).toBe('{"a":1}; x')
    expect(rawCsvValue(null)).toBeNull()
  })

  it('flags expiry urgency', () => {
    expect(expiryTone(-1, true)).toBe('critical')
    expect(expiryTone(10, false)).toBe('warning')
    expect(expiryTone(90, false)).toBe('good')
    expect(expiryTone(null, false)).toBe('good')
  })

  it('sums numeric-ish fields and ignores junk', () => {
    expect(sumBy([{ v: '1.5' }, { v: 2 }, { v: null }, { v: 'x' }], (r) => r.v)).toBe(3.5)
  })
})
