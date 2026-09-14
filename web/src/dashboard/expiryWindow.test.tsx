import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What one click on the expiry window is allowed to cost.
 *
 * The window tunes exactly one figure set — the batches expiring inside it —
 * which comes from the near-expiry report. /v1/dashboard is a different request
 * carrying masters, document counts, the outbox, inbound events, unacknowledged
 * revisions, the reconciliation run and two `GROUP BY … HAVING SUM(...)` scans
 * over the balances table. Keying that request on the window re-runs all of it
 * for two integers this screen never reads.
 */

const calls = {
  dashboard: 0,
  expiry: [] as number[],
  stock: 0,
}

vi.mock('../services/dashboard', () => ({
  fetchDashboard: () => {
    calls.dashboard += 1
    return Promise.resolve(null)
  },
}))

vi.mock('./dashboardApi', () => ({
  fetchExpiry: (days: number) => {
    calls.expiry.push(days)
    return Promise.resolve(null)
  },
  fetchStockValue: () => {
    calls.stock += 1
    return Promise.resolve(null)
  },
  fetchWarehouseSplit: () => Promise.resolve(null),
  fetchAgeing: () => Promise.resolve(null),
  fetchMovementMix: () => Promise.resolve(null),
  fetchReplenishment: () => Promise.resolve(null),
  fetchRecentMovements: () => Promise.resolve(null),
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
  }),
}))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false }),
}))

const { useDashboardData } = await import('./useDashboardData')

function Probe() {
  const { nearExpiryDays, setNearExpiryDays } = useDashboardData()
  return (
    <button type="button" onClick={() => setNearExpiryDays(90)}>
      {nearExpiryDays}
    </button>
  )
}

async function mount(): Promise<void> {
  render(<Probe />)
  await act(async () => {})
}

beforeEach(() => {
  calls.dashboard = 0
  calls.expiry = []
  calls.stock = 0
})

describe('changing the expiry window', () => {
  it('re-runs the near-expiry report and nothing else', async () => {
    await mount()
    expect(calls.dashboard).toBe(1)
    expect(calls.expiry).toEqual([30])

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    expect(screen.getByRole('button').textContent).toBe('90')
    expect(calls.expiry).toEqual([30, 90])
    expect(calls.dashboard, '/v1/dashboard re-ran for a window it does not answer').toBe(1)
    expect(calls.stock, 'the stock-value report re-ran for the expiry window').toBe(1)
  })
})
