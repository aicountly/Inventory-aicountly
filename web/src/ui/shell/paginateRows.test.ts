import { describe, expect, it } from 'vitest'
import { paginateRows } from './paginateRows'

const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }))

describe('paginateRows', () => {
  it('returns the first page slice', () => {
    const p = paginateRows(rows, 1, 25)
    expect(p.pageRows).toHaveLength(25)
    expect(p.total).toBe(30)
    expect(p.totalPages).toBe(2)
    expect(p.from).toBe(1)
    expect(p.to).toBe(25)
  })

  it('returns the last page slice', () => {
    const p = paginateRows(rows, 2, 25)
    expect(p.pageRows).toHaveLength(5)
    expect(p.from).toBe(26)
    expect(p.to).toBe(30)
  })

  it('clamps a page beyond the end', () => {
    const p = paginateRows(rows, 99, 25)
    expect(p.page).toBe(2)
    expect(p.pageRows).toHaveLength(5)
  })

  it('returns every row when the page size is "all"', () => {
    const p = paginateRows(rows, 1, 'all')
    expect(p.pageRows).toHaveLength(30)
    expect(p.totalPages).toBe(1)
  })

  it('reports a zero range for an empty list', () => {
    const p = paginateRows([], 1, 25)
    expect(p).toMatchObject({ total: 0, totalPages: 1, from: 0, to: 0 })
  })
})
