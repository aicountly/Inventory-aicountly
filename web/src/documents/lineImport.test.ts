import { describe, expect, it } from 'vitest'
import { parseLinesInput } from './lineImport'

describe('parseLinesInput', () => {
  it('parses comma-separated identifier, qty, rate', () => {
    const rows = parseLinesInput('SKU-1, 5, 100.50\nSKU-2,2')
    expect(rows).toEqual([
      { raw: 'SKU-1, 5, 100.50', identifier: 'SKU-1', qty: 5, rate: 100.5 },
      { raw: 'SKU-2,2', identifier: 'SKU-2', qty: 2, rate: null },
    ])
  })

  it('parses tab-separated rows', () => {
    const rows = parseLinesInput('SKU-1\t5\t100')
    expect(rows).toEqual([{ raw: 'SKU-1\t5\t100', identifier: 'SKU-1', qty: 5, rate: 100 }])
  })

  it('defaults quantity to 1 for a bare identifier', () => {
    expect(parseLinesInput('SKU-1')).toEqual([{ raw: 'SKU-1', identifier: 'SKU-1', qty: 1, rate: null }])
  })

  it('splits a trailing qty (and rate) off a space-separated item name', () => {
    expect(parseLinesInput('Blue Widget 5')).toEqual([{ raw: 'Blue Widget 5', identifier: 'Blue Widget', qty: 5, rate: null }])
    expect(parseLinesInput('Blue Widget 5 12.5')).toEqual([{ raw: 'Blue Widget 5 12.5', identifier: 'Blue Widget', qty: 5, rate: 12.5 }])
  })

  it('skips a header row and blank lines', () => {
    expect(parseLinesInput('SKU, Qty, Rate\n\nSKU-1,3,10')).toEqual([{ raw: 'SKU-1,3,10', identifier: 'SKU-1', qty: 3, rate: 10 }])
  })

  it('ignores a line with no identifier', () => {
    expect(parseLinesInput(',5,10')).toEqual([])
  })
})
