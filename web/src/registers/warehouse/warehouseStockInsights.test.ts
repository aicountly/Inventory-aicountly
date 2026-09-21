import { describe, expect, it } from 'vitest'
import { warehouseStockAlerts, warehouseStockInsight } from './warehouseStockInsights'
import type { WarehouseStockSummary } from '../../services/reportsApi'

const EMPTY_HEALTH = { negative: 0, out: 0, reorder: 0, low: 0, overstocked: 0, healthy: 0 }

function summary(patch: Partial<WarehouseStockSummary> = {}): WarehouseStockSummary {
  return {
    rows: 10,
    items: 8,
    warehouses: 2,
    active_warehouses: 3,
    closing_qty: 1000,
    closing_value: 50_000,
    reserved_qty: 0,
    available_qty: 1000,
    by_warehouse: [],
    health: { ...EMPTY_HEALTH, healthy: 10 },
    health_items: { ...EMPTY_HEALTH, healthy: 8 },
    health_filter: null,
    method: 'AS_PER_MASTER',
    live_buckets: true,
    currency: 'INR',
    to: '2026-09-19',
    ...patch,
  }
}

describe('warehouseStockInsight', () => {
  it('says nothing at all about an empty register', () => {
    // The empty state already tells the reader what to do; an "observation" over no
    // rows would be a sentence with no subject.
    expect(warehouseStockInsight(summary({ rows: 0 }))).toBeNull()
    expect(warehouseStockInsight(undefined)).toBeNull()
  })

  it('leads with stock below zero, because that is a correction and not a shortage', () => {
    const insight = warehouseStockInsight(
      summary({
        health: { ...EMPTY_HEALTH, negative: 3, reorder: 9, low: 4 },
        health_items: { ...EMPTY_HEALTH, negative: 3, reorder: 9, low: 4 },
      }),
    )
    expect(insight?.rule).toBe('negative')
    expect(insight?.headline).toBe('3 lines show stock below zero.')
    expect(insight?.health).toBe('negative')
  })

  it('counts ITEMS for replenishment — one item short in three warehouses is one order', () => {
    const insight = warehouseStockInsight(
      summary({
        health: { ...EMPTY_HEALTH, reorder: 9 },
        health_items: { ...EMPTY_HEALTH, reorder: 4 },
      }),
    )
    expect(insight?.rule).toBe('reorder')
    expect(insight?.headline).toBe('4 items have reached their reorder point.')
  })

  it('prefers the reorder point over safety stock, as the register itself does', () => {
    const insight = warehouseStockInsight(
      summary({
        health: { ...EMPTY_HEALTH, reorder: 1, low: 6 },
        health_items: { ...EMPTY_HEALTH, reorder: 1, low: 6 },
      }),
    )
    expect(insight?.rule).toBe('reorder')
  })

  it('names the dominant warehouse only when one genuinely dominates', () => {
    const concentrated = warehouseStockInsight(
      summary({
        closing_value: 1000,
        by_warehouse: [
          { warehouse_id: 1, warehouse_name: 'Main', closing_qty: 700, closing_value: 620, items: 5 },
          { warehouse_id: 2, warehouse_name: 'North', closing_qty: 300, closing_value: 380, items: 3 },
        ],
      }),
    )
    expect(concentrated?.rule).toBe('concentration')
    expect(concentrated?.headline).toBe('Main holds 62% of stock value.')

    const even = warehouseStockInsight(
      summary({
        closing_value: 1000,
        reserved_qty: 0,
        by_warehouse: [
          { warehouse_id: 1, warehouse_name: 'Main', closing_qty: 500, closing_value: 510, items: 5 },
          { warehouse_id: 2, warehouse_name: 'North', closing_qty: 500, closing_value: 490, items: 3 },
        ],
      }),
    )
    expect(even?.rule).not.toBe('concentration')
  })

  it('never offers a live reserved figure on a back-dated read', () => {
    // reserved_qty is null when `to` is in the past — a rule that read it as a number
    // would print "0 units are reserved" about a day nobody asked about.
    const past = warehouseStockInsight(
      summary({ live_buckets: false, reserved_qty: null, available_qty: null }),
    )
    expect(past?.rule).not.toBe('reserved')
  })

  it('reports reserved stock as a share of what is on hand', () => {
    const insight = warehouseStockInsight(summary({ reserved_qty: 250, closing_qty: 1000 }))
    expect(insight?.rule).toBe('reserved')
    expect(insight?.headline).toContain('25% of what is on hand')
  })

  it('falls back to the good news only when the good news is true', () => {
    const insight = warehouseStockInsight(summary())
    expect(insight?.rule).toBe('healthy')
    expect(insight?.tone).toBe('success')
    expect(insight?.detail).toBe('8 items across 2 warehouses.')
  })

  it('is a pure function of the summary — the same figures give the same sentence', () => {
    const s = summary({ health: { ...EMPTY_HEALTH, low: 2 }, health_items: { ...EMPTY_HEALTH, low: 2 } })
    expect(warehouseStockInsight(s)).toEqual(warehouseStockInsight(s))
  })
})

describe('warehouseStockAlerts', () => {
  it('lists only the states that are actually happening, worst first', () => {
    const alerts = warehouseStockAlerts(
      summary({
        health: { ...EMPTY_HEALTH, negative: 2, low: 5, overstocked: 1 },
        health_items: { ...EMPTY_HEALTH, negative: 2, low: 4, overstocked: 1 },
      }),
    )
    expect(alerts.map((a) => a.key)).toEqual(['negative', 'low', 'overstocked'])
    expect(alerts[0].label).toBe('2 lines below zero')
    expect(alerts[1].label).toBe('4 items under safety stock')
    // One of anything reads as one of anything.
    const single = warehouseStockAlerts(
      summary({ health: { ...EMPTY_HEALTH, negative: 1 }, health_items: { ...EMPTY_HEALTH, negative: 1 } }),
    )
    expect(single[0].label).toBe('1 line below zero')
  })

  it('carries a filter value for every alert, so a click lands on the rows behind it', () => {
    const alerts = warehouseStockAlerts(
      summary({ health: { ...EMPTY_HEALTH, reorder: 3 }, health_items: { ...EMPTY_HEALTH, reorder: 3 } }),
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0].health).toBe('reorder')
  })

  it('says nothing when nothing needs attention', () => {
    expect(warehouseStockAlerts(summary())).toEqual([])
    expect(warehouseStockAlerts(undefined)).toEqual([])
  })
})
