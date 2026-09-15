import { describe, expect, it } from 'vitest'
import { coverUrgency, daysOfCover, formatCover, readiness, suggest, transferableSurplus } from './replenishmentModel'
import type { ReplenishmentRow } from '../services/reportsApi'

/**
 * The replenishment arithmetic is the one thing on these dashboards that a
 * person might spend money on the strength of. Each test below pins a way it
 * could be wrong without looking wrong.
 */
describe('suggest', () => {
  it('reproduces the worked example', () => {
    // 500 available, 100/day, 7-day lead time, 200 safety, no inbound:
    // 100 x 7 = 700; 700 + 200 - 500 = 400.
    const s = suggest({ available: 500, inbound: 0, dailyDemand: 100, leadTimeDays: 7, safetyStock: 200, horizonDays: 0 })
    expect(s.forecastDemand).toBe(700)
    expect(s.netSupply).toBe(500)
    expect(s.suggestedQty).toBe(400)
    expect(s.coverDays).toBe(7)
  })

  it('counts confirmed inbound exactly once', () => {
    const without = suggest({ available: 500, inbound: 0, dailyDemand: 100, leadTimeDays: 7, safetyStock: 200, horizonDays: 0 })
    const withInbound = suggest({ available: 500, inbound: 150, dailyDemand: 100, leadTimeDays: 7, safetyStock: 200, horizonDays: 0 })
    // Inbound reduces the suggestion by exactly its own size — not twice, and
    // not not-at-all.
    expect(without.suggestedQty - withInbound.suggestedQty).toBe(150)
  })

  it('never suggests a negative quantity', () => {
    const s = suggest({ available: 10000, inbound: 0, dailyDemand: 1, leadTimeDays: 7, safetyStock: 0, horizonDays: 7 })
    expect(s.suggestedQty).toBe(0)
  })

  it('carries negative availability through instead of clamping it away', () => {
    // -40 available needs 40 more than 0 available. Clamping availability at
    // zero would under-order for exactly the worst-off item on the screen.
    const atZero = suggest({ available: 0, inbound: 0, dailyDemand: 10, leadTimeDays: 5, safetyStock: 0, horizonDays: 0 })
    const negative = suggest({ available: -40, inbound: 0, dailyDemand: 10, leadTimeDays: 5, safetyStock: 0, horizonDays: 0 })
    expect(negative.suggestedQty - atZero.suggestedQty).toBe(40)
  })

  it('reports a missing lead time rather than assuming one', () => {
    const s = suggest({ available: 0, inbound: 0, dailyDemand: 10, leadTimeDays: null, safetyStock: 0, horizonDays: 14 })
    expect(s.leadTimeMissing).toBe(true)
    // The window is the horizon only — no invented default lead time.
    expect(s.coverDays).toBe(14)
    expect(s.forecastDemand).toBe(140)
  })

  it('treats an unset safety stock as zero, not as a guess', () => {
    const s = suggest({ available: 100, inbound: 0, dailyDemand: 10, leadTimeDays: 7, safetyStock: 0, horizonDays: 0 })
    expect(s.safetyStock).toBe(0)
    expect(s.suggestedQty).toBe(0)
  })

  it('does not suggest anything for an item with no demand and no safety stock', () => {
    const s = suggest({ available: 0, inbound: 0, dailyDemand: 0, leadTimeDays: 7, safetyStock: 0, horizonDays: 14 })
    expect(s.suggestedQty).toBe(0)
  })
})

describe('daysOfCover', () => {
  it('is null when there is no demand, never Infinity and never zero', () => {
    // "No recent demand" and "runs out today" are opposite situations and must
    // not render as the same number.
    expect(daysOfCover(500, 0)).toBeNull()
    expect(daysOfCover(500, -1)).toBeNull()
    expect(formatCover(daysOfCover(500, 0))).toBe('No recent demand')
  })

  it('measures cover at the observed rate', () => {
    expect(daysOfCover(500, 100)).toBe(5)
  })

  it('is zero days when nothing is available', () => {
    expect(daysOfCover(0, 100)).toBe(0)
    expect(daysOfCover(-40, 100)).toBe(0)
  })
})

describe('coverUrgency', () => {
  it('calls cover critical when it runs out inside the lead time', () => {
    expect(coverUrgency(5, 7)).toBe('critical')
    expect(coverUrgency(7, 7)).toBe('critical')
  })

  it('separates low from adequate at two lead times', () => {
    expect(coverUrgency(13, 7)).toBe('low')
    expect(coverUrgency(20, 7)).toBe('adequate')
  })

  it('reports no demand rather than guessing at urgency', () => {
    expect(coverUrgency(null, 7)).toBe('none')
  })
})

function row(overrides: Partial<ReplenishmentRow> = {}): ReplenishmentRow {
  return {
    item_id: 1,
    item_name: 'Widget',
    item_alias: null,
    item_sku: null,
    unit_id: null,
    unit_symbol: 'pcs',
    item_grp_id: null,
    stock_cat_id: null,
    standard_cost: null,
    min_stock_qty: null,
    max_stock_qty: null,
    reorder_point_qty: 100,
    reorder_qty: null,
    safety_stock_qty: 50,
    lead_time_days: 7,
    default_warehouse_id: null,
    default_warehouse_name: null,
    on_hand: 300,
    reserved: 0,
    committed: 0,
    packed: 0,
    in_transit: 0,
    job_worker: 0,
    quality_hold: 0,
    damaged: 0,
    blocked: 0,
    expected_balance: 0,
    available: 300,
    expected: 0,
    pending_out: 0,
    projected: 0,
    triggered: true,
    reasons: ['below_reorder_point'],
    target_basis: null,
    target_qty: null,
    suggested_qty: 0,
    suggested_value: null,
    needed_by: null,
    ...overrides,
  }
}

describe('transferableSurplus', () => {
  it('leaves the holding location its own safety stock and lead-time demand', () => {
    // 300 available, 10/day over a 7-day lead time (70) plus 50 safety = 120
    // the location needs for itself. 180 may move; 300 may not.
    expect(transferableSurplus(row(), 10, 7)).toBe(180)
  })

  it('refuses to call anything transferable when the location needs it all', () => {
    // Recommending a transfer here would just move the shortage somewhere else.
    expect(transferableSurplus(row({ available: 100 }), 20, 7)).toBe(0)
  })

  it('never returns a negative surplus', () => {
    expect(transferableSurplus(row({ available: -10 }), 20, 7)).toBe(0)
  })
})

describe('readiness', () => {
  it('says which inputs are missing rather than reporting a clean bill', () => {
    const checks = readiness([row({ lead_time_days: null }), row()], null)
    const lead = checks.find((c) => c.key === 'lead_time')
    expect(lead?.status).toBe('partial')
    expect(lead?.detail).toContain('1 of 2')
  })

  it('reports insufficient history without inventing a confidence figure', () => {
    const checks = readiness([row()], { dailyMean: 3, sufficientHistory: false, historyDays: 60, daysWithDemand: 1 })
    const history = checks.find((c) => c.key === 'history')
    expect(history?.status).toBe('partial')
    expect(history?.detail).toContain('1 days with demand')
    expect(history?.detail).not.toMatch(/\d+%/)
  })
})
