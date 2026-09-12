import { describe, expect, it } from 'vitest'
import { defaultPayload, defaultValues, validateValues } from './formValues'
import type { FieldDef } from './types'

interface Row {
  brand_id: number
  brand_name: string
  brand_alias: string | null
  is_active: number
  rank: number | null
}

const fields: FieldDef<Row>[] = [
  { name: 'brand_name', label: 'Brand name', type: 'text', required: true },
  { name: 'brand_alias', label: 'Alias', type: 'text' },
  { name: 'rank', label: 'Rank', type: 'number', min: 0, max: 10 },
  { name: 'parent', label: 'Parent', type: 'select' },
  { name: 'is_active', label: 'Active', type: 'checkbox' },
]

describe('defaultValues', () => {
  it('starts blank with is_active on for a new row', () => {
    expect(defaultValues(fields, null)).toEqual({ brand_name: '', brand_alias: '', rank: '', parent: '', is_active: true })
  })

  it('copies a row as strings and booleans', () => {
    const row: Row = { brand_id: 1, brand_name: 'Bosch', brand_alias: null, is_active: 0, rank: 3 }
    expect(defaultValues(fields, row)).toEqual({ brand_name: 'Bosch', brand_alias: '', rank: '3', parent: '', is_active: false })
  })
})

describe('defaultPayload', () => {
  it('parses numbers, converts flags and nulls blanks', () => {
    expect(defaultPayload(fields, { brand_name: ' Bosch ', brand_alias: '', rank: '4', parent: '12', is_active: true })).toEqual({ brand_name: 'Bosch', brand_alias: null, rank: 4, parent: 12, is_active: 1 })
    expect(defaultPayload(fields, { brand_name: 'X', brand_alias: 'x', rank: '', parent: 'abc', is_active: false })).toEqual({ brand_name: 'X', brand_alias: 'x', rank: null, parent: 'abc', is_active: 0 })
  })
})

describe('validateValues', () => {
  const ctx = (values: Record<string, unknown>) => ({ values, mode: 'create' as const, row: null, options: null, rows: [] })

  it('flags required and range errors', () => {
    expect(validateValues(fields, ctx({ brand_name: '', rank: '11' }))).toEqual({ brand_name: 'Brand name is required', rank: 'Rank must be at most 10' })
    expect(validateValues(fields, ctx({ brand_name: 'ok', rank: 'x' }))).toEqual({ rank: 'Rank must be a number' })
    expect(validateValues(fields, ctx({ brand_name: 'ok', rank: '' }))).toEqual({})
  })

  it('skips hidden fields and runs custom validators', () => {
    const custom: FieldDef<Row>[] = [
      { name: 'code', label: 'Code', type: 'text', required: true, hidden: () => true },
      { name: 'sku', label: 'SKU', type: 'text', validate: (v) => (String(v).includes(' ') ? 'No spaces' : null) },
    ]
    expect(validateValues(custom, ctx({ sku: 'A B' }))).toEqual({ sku: 'No spaces' })
  })
})
