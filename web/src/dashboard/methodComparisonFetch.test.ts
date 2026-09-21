import { beforeEach, describe, expect, it, vi } from 'vitest'

const snapshot = vi.fn()
vi.mock('../services/valuationApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/valuationApi')>()),
  valuationApi: { snapshot },
}))

const { fetchMethodComparison } = await import('./dashboardApi')

function summary(value: number) {
  return { summary: { as_of: '2026-09-19', method: 'FIFO', total_qty: 10, total_value: value, item_count: 2 } }
}

beforeEach(() => snapshot.mockReset())

describe('fetching the method comparison', () => {
  it('asks each method its own question, and returns them all', async () => {
    snapshot.mockResolvedValue(summary(1_000_000))
    const rows = await fetchMethodComparison('2026-09-19', 4)
    expect(rows).toHaveLength(4)
    expect(snapshot).toHaveBeenCalledTimes(4)
    expect(snapshot.mock.calls[0][0]).toMatchObject({ as_of: '2026-09-19', warehouse_id: 4, limit: 1 })
  })

  it('keeps the methods that answered when one fails', async () => {
    // Queued in REPORT_METHODS order: AS_PER_MASTER, FIFO, LIFO, WAC.
    snapshot
      .mockResolvedValueOnce(summary(1_000_000))
      .mockResolvedValueOnce(summary(1_010_000))
      .mockRejectedValueOnce(new Error('cannot cost under LIFO'))
      .mockResolvedValueOnce(summary(995_000))

    const rows = await fetchMethodComparison('2026-09-19', null)
    expect(rows.find((r) => r.method === 'LIFO')?.summary).toBeNull()
    expect(rows.filter((r) => r.summary !== null)).toHaveLength(3)
    expect(rows.find((r) => r.method === 'FIFO')?.summary?.total_value).toBe(1_010_000)
  })

  it('fails outright when every method fails', async () => {
    // Otherwise a total outage resolves as an empty comparison: the card says
    // "the engine did not answer for this date", offers no Retry, and the page
    // still reports that the data is in sync.
    for (let i = 0; i < 4; i += 1) snapshot.mockRejectedValueOnce(new Error('valuation service is down'))
    await expect(fetchMethodComparison('2026-09-19', null)).rejects.toThrow('valuation service is down')
  })

  it('lets an abort through rather than reporting it as unavailable', async () => {
    // An abort is the page moving on. Reported as "unavailable" it would draw
    // a stale comparison under the filters the reader has already left behind.
    for (let i = 0; i < 4; i += 1) {
      const abort = new Error('aborted')
      abort.name = 'AbortError'
      snapshot.mockRejectedValueOnce(abort)
    }
    await expect(fetchMethodComparison('2026-09-19', null)).rejects.toThrow('aborted')
  })
})
