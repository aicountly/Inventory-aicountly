import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
// Only `api.get` is a double; the module's pure helpers stay real, so the last
// test below exercises the client's own query builder rather than a copy of it.
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  api: { get },
}))

const { assertScope, fetchControls, fetchDemand, fetchOperations, fetchValuationBridge } = await import('./aggregatesApi')
const { buildQueryString } = await import('../services/api')

/**
 * The aggregates' request shape.
 *
 * These exist because of a bug a user saw rather than a rule we imagined. The
 * envelope helper used to append its filters to the PATH:
 *
 *     api.get('v1/dashboard/valuation-bridge?from=2026-04-01&to=2026-09-19')
 *
 * and the API client then appends the company scope with `buildQueryString`,
 * which starts with its own `?`. The URL came out as
 *
 *     …/valuation-bridge?from=2026-04-01&to=2026-09-19?cmp_id=1&fy_id=3&bo_id=0
 *
 * so `cmp_id` was never a parameter at all — it was swallowed into the value of
 * `to`. The server answered `context_required` and the valuation bridge card
 * printed "Company context required (cmp_id, fy_id, bo_id)" while every
 * neighbouring card, which passes its filters through `opts.query`, loaded
 * normally. The fix is to hand the client the parameters; the tests are here so
 * nobody puts them back in the path.
 */
function envelope() {
  return {
    data: {
      scope: { cmp_id: 1, fy_id: 3, bo_id: 0, timezone: 'Asia/Kolkata' },
      meta: { generated_at: '2026-09-19T10:24:00Z', status: 'ready' },
      data: {},
    },
  }
}

beforeEach(() => {
  get.mockReset()
  get.mockResolvedValue(envelope())
})

describe('dashboard aggregate requests', () => {
  it('never puts a query string in the path — the scope rides in the same one', async () => {
    await fetchValuationBridge('2026-04-01', '2026-09-19', 4)
    const [path, opts] = get.mock.calls[0]
    expect(path).toBe('v1/dashboard/valuation-bridge')
    expect(path).not.toContain('?')
    expect(opts.query).toEqual({ from: '2026-04-01', to: '2026-09-19', warehouse_id: 4 })
  })

  it('drops an absent warehouse rather than sending it empty', async () => {
    await fetchValuationBridge('2026-04-01', '2026-09-19', null)
    expect(get.mock.calls[0][1].query).toEqual({ from: '2026-04-01', to: '2026-09-19', warehouse_id: undefined })
  })

  it('holds for every aggregate, not just the one that broke', async () => {
    await fetchOperations('2026-09-19')
    await fetchDemand(7, 4, '2026-09-19', 90, 30)
    await fetchControls()
    for (const [path] of get.mock.calls) expect(path).not.toContain('?')
  })

  it('passes the abort signal through, so a filter change cancels in flight', async () => {
    const controller = new AbortController()
    await fetchValuationBridge('2026-04-01', '2026-09-19', null, controller.signal)
    expect(get.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('throws away an answer computed for another company', async () => {
    expect(() =>
      assertScope(envelope().data as never, { cmp_id: 2, fy_id: 3, bo_id: 0 }),
    ).toThrow(/different company/)
    expect(assertScope(envelope().data as never, { cmp_id: 1, fy_id: 3, bo_id: 0 })).toBeTruthy()
  })

  it('produces one well-formed query string once the client merges the scope', () => {
    // The client's own builder, over what the helper now hands it plus the
    // scope — exactly one `?`, and cmp_id is a parameter in its own right.
    const url = `v1/dashboard/valuation-bridge${buildQueryString({
      cmp_id: 1,
      fy_id: 3,
      bo_id: 0,
      from: '2026-04-01',
      to: '2026-09-19',
    })}`
    expect(url.match(/\?/g)).toHaveLength(1)
    expect(new URL(url, 'https://x').searchParams.get('cmp_id')).toBe('1')
    expect(new URL(url, 'https://x').searchParams.get('to')).toBe('2026-09-19')
  })
})
