import { describe, expect, it } from 'vitest'
import { pageSlice } from './paging'

describe('pageSlice', () => {
  const rows = Array.from({ length: 7 }, (_, i) => i + 1)

  it('returns the requested page with API-shaped meta', () => {
    expect(pageSlice(rows, 1, 3)).toEqual({ data: [1, 2, 3], meta: { total: 7, limit: 3, offset: 0 } })
    expect(pageSlice(rows, 3, 3)).toEqual({ data: [7], meta: { total: 7, limit: 3, offset: 6 } })
  })

  it('clamps a page past the end to the last page', () => {
    expect(pageSlice(rows, 9, 3).data).toEqual([7])
  })

  it('tolerates bad inputs', () => {
    expect(pageSlice(rows, 0, 0)).toEqual({ data: rows, meta: { total: 7, limit: 50, offset: 0 } })
    expect(pageSlice([], 1, 25)).toEqual({ data: [], meta: { total: 0, limit: 25, offset: 0 } })
  })
})
