import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows } from './listAll'
import type { ListResponse } from './api'

/**
 * `fetchAllRows` is the function every export in the app hangs on.
 *
 * ExportActions, ListSheetActions, MasterPage and ExportCsvButton all hand it a
 * page fetcher and write whatever it returns into a CSV, a spreadsheet, a PDF
 * and a letterheaded print sheet — and the footers of those documents are
 * re-totalled over the rows it returned. If it stops walking after the first
 * page, every one of those files goes out short with an internally consistent
 * footer that gives the reader no signal anything is missing. Nothing else in
 * the repository exercised it, so a `break` in the wrong place was invisible.
 *
 * Every case below is written against an offset pager that behaves like the
 * real `/v1/...` list endpoints: `{ data, meta: { total } }`, one page at a time.
 */

function pager(total: number, pageSize = total) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }))
  const calls: { page: number; limit: number }[] = []
  const fetchPage = vi.fn(async (page: number, limit: number): Promise<ListResponse<{ id: number }>> => {
    calls.push({ page, limit })
    const size = Math.min(limit, pageSize)
    const start = (page - 1) * size
    return { data: all.slice(start, start + size), meta: { total, limit: size, offset: start } }
  })
  return { fetchPage, calls, all }
}

describe('fetchAllRows walks every page', () => {
  it('concatenates a result that spans several pages, in order', async () => {
    const { fetchPage, calls } = pager(1250)

    const result = await fetchAllRows(fetchPage, { limit: 500 })

    expect(calls.map((c) => c.page)).toEqual([1, 2, 3])
    expect(result.rows).toHaveLength(1250)
    // The last row exists only on page 3: a walk that stops early loses it.
    expect(result.rows[0]).toEqual({ id: 1 })
    expect(result.rows[1249]).toEqual({ id: 1250 })
    expect(result.total).toBe(1250)
    expect(result.truncated).toBe(false)
  })

  it('stops after one request when the first page is the whole result', async () => {
    const { fetchPage } = pager(12)

    const result = await fetchAllRows(fetchPage, { limit: 500 })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result.rows).toHaveLength(12)
    expect(result.truncated).toBe(false)
  })

  it('stops on an exact multiple of the page size instead of asking for an empty page', async () => {
    const { fetchPage, calls } = pager(1000)

    const result = await fetchAllRows(fetchPage, { limit: 500 })

    expect(calls.map((c) => c.page)).toEqual([1, 2])
    expect(result.rows).toHaveLength(1000)
  })

  it('caps at maxRows and says so, rather than returning a short set silently', async () => {
    const { fetchPage } = pager(12_431)

    const result = await fetchAllRows(fetchPage, { limit: 500, maxRows: 10_000 })

    expect(result.rows).toHaveLength(10_000)
    expect(result.total).toBe(12_431)
    // The flag the export reads to put "Partial export" on the paper.
    expect(result.truncated).toBe(true)
  })

  it('reports the server total even when the pager came up short of it', async () => {
    /*
     * The concurrent-insert / clamped-limit case: the endpoint serves fewer rows
     * than were asked for while meta.total is larger. The walk exits on the
     * short page — so `total` is the only thing that can tell a caller the file
     * is incomplete, and it must not be overwritten with the row count.
     */
    const fetchPage = vi.fn(async (): Promise<ListResponse<{ id: number }>> => ({
      data: [{ id: 1 }, { id: 2 }],
      meta: { total: 4182, limit: 500, offset: 0 },
    }))

    const result = await fetchAllRows(fetchPage, { limit: 500 })

    expect(result.rows).toHaveLength(2)
    expect(result.total).toBe(4182)
    expect(result.truncated).toBe(false)
  })

  it('asks for 500 rows a page by default', async () => {
    const { fetchPage, calls } = pager(3)
    await fetchAllRows(fetchPage)
    expect(calls[0].limit).toBe(500)
  })
})
