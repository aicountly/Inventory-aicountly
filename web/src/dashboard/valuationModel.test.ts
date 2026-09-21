import { describe, expect, it } from 'vitest'
import { ageingView, bridgeCloses, bridgeSteps, movementThresholds, unknownAgeNote } from './valuationModel'
import { buildBridgeBars } from './charts/BridgeChart'
import type { ValuationBridgeData } from './aggregatesApi'
import type { StockAgeingSummary } from '../services/reportsApi'

function component(net: number, movements = 1) {
  return { net, gross_in: net > 0 ? net : 0, gross_out: net < 0 ? -net : 0, movements }
}

function bridge(overrides: Partial<ValuationBridgeData> = {}): ValuationBridgeData {
  return {
    from: '2026-04-01',
    to: '2026-09-15',
    warehouse_id: null,
    opening: { value: 4200000, state: 'ready', definition: 'opening' },
    closing: { value: 4862000, state: 'ready', definition: 'closing' },
    components: {
      inward: component(1840000),
      outward: component(-1150000),
      adjustment: component(-28000),
      transfer: component(0, 12),
      other: component(0, 0),
    },
    reversals: { net: 0, movements: 0 },
    revaluations: { net: 0, movements: 0 },
    unvalued_movements: 0,
    definition: 'opening + inward - outward +/- adjustments = closing',
    ...overrides,
  }
}

describe('the value bridge', () => {
  it('walks the specification example from opening to closing', () => {
    // 42.00L + 18.40L - 11.50L - 0.28L = 48.62L, every figure from one fixture.
    const data = bridge()
    const steps = bridgeSteps(data)
    const sum = steps.reduce((acc, s) => acc + s.delta, 0)
    expect((data.opening.value as number) + sum).toBe(data.closing.value)
    expect(bridgeCloses(data).closes).toBe(true)
  })

  it('reports a gap instead of quietly absorbing it into the last step', () => {
    // A waterfall whose bars do not reach its own end value is the most
    // misleading chart on a finance screen.
    const data = bridge({ closing: { value: 4900000, state: 'ready', definition: 'closing' } })
    const closure = bridgeCloses(data)
    expect(closure.closes).toBe(false)
    expect(closure.residual).toBe(38000)
  })

  it('draws the residual as its own labelled bar', () => {
    const data = bridge({ closing: { value: 4900000, state: 'ready', definition: 'closing' } })
    const bars = buildBridgeBars(
      data.opening.value as number,
      bridgeSteps(data),
      data.closing.value as number,
      'Opening',
      'Closing',
      '42.00L',
      '49.00L',
      (n) => String(n),
    )
    const residual = bars.find((b) => b.kind === 'residual')
    expect(residual).toBeDefined()
    expect(residual?.label).toBe('Unexplained')
    // And the last bar still lands exactly on the closing value.
    expect(bars[bars.length - 1].to).toBe(4900000)
  })

  it('keeps the transfer step even when it nets to zero, and labels why', () => {
    // At company scope the two legs cancel. Dropping the step would hide the
    // one thing a warehouse-filtered reader needs to see.
    const company = bridgeSteps(bridge())
    expect(company.find((s) => s.key === 'transfer')?.sub).toContain('company scope')

    const perWarehouse = bridgeSteps(bridge({ warehouse_id: 4, components: { ...bridge().components, transfer: component(65000) } }))
    expect(perWarehouse.find((s) => s.key === 'transfer')?.sub).toContain('this warehouse')
  })

  it('drops an "Other" step that is genuinely nothing', () => {
    expect(bridgeSteps(bridge()).map((s) => s.key)).not.toContain('other')
    const withOther = bridgeSteps(bridge({ components: { ...bridge().components, other: component(500, 3) } }))
    expect(withOther.map((s) => s.key)).toContain('other')
  })
})

function ageing(overrides: Partial<StockAgeingSummary> = {}): StockAgeingSummary {
  return {
    items: 10,
    total_qty: 1000,
    total_value: 4862000,
    buckets: {
      '0_30': { qty: 600, value: 3014000 },
      '31_60': { qty: 200, value: 1118000 },
      '61_90': { qty: 120, value: 487000 },
      '91_180': { qty: 50, value: 243000 },
      '180_plus': { qty: 30, value: 0 },
    },
    bucket_labels: {
      '0_30': '0 – 30 days',
      '31_60': '31 – 60 days',
      '61_90': '61 – 90 days',
      '91_180': '91 – 180 days',
      '180_plus': '180+ days',
    },
    as_of: '2026-09-15',
    ...overrides,
  } as StockAgeingSummary
}

describe('ageing', () => {
  it('takes shares over the buckets that can be shares', () => {
    const view = ageingView(ageing(), '2026-09-15')
    expect(view.compositionInvalid).toBe(false)
    const total = view.buckets.reduce((acc, b) => acc + b.share, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('separates a negative bucket instead of forcing it into a 100% chart', () => {
    // A negative bucket is real — a layer consumed below zero — and it cannot
    // be a slice of a pie. Including it makes the other slices add to more
    // than the whole.
    const view = ageingView(
      ageing({ buckets: { ...ageing().buckets, '180_plus': { qty: -10, value: -50000 } } as StockAgeingSummary['buckets'] }),
      '2026-09-15',
    )
    expect(view.compositionInvalid).toBe(true)
    expect(view.negatives).toHaveLength(1)
    expect(view.buckets.map((b) => b.key)).not.toContain('180_plus')
    const total = view.buckets.reduce((acc, b) => acc + b.share, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('reports stock with no receipt date rather than ageing it into the oldest bucket', () => {
    // Stock whose receipt date is unknown is not stock that is known to be old.
    const note = unknownAgeNote(ageing({ total_value: 5000000 }))
    expect(note).toContain('not in any age bucket')
    expect(unknownAgeNote(ageing())).toBeNull()
  })

  it('is empty rather than fabricated when there is no ageing report', () => {
    const view = ageingView(null, '2026-09-15')
    expect(view.buckets).toHaveLength(0)
    expect(view.compositionInvalid).toBe(false)
  })

  it('splits by quantity when asked, and swaps which measure is the headline', () => {
    const value = ageingView(ageing(), '2026-09-15', 'value')
    const qty = ageingView(ageing(), '2026-09-15', 'quantity')

    expect(value.buckets[0].display).toContain('₹')
    expect(qty.buckets[0].display).toContain('units')
    // 600 of 1,000 units are in the newest bucket, but only 62% of the value.
    expect(qty.buckets[0].share).toBeCloseTo(60, 0)
    expect(value.buckets[0].share).not.toBeCloseTo(60, 0)
    // Neither measure is hidden: the one that is not the headline is the sub.
    expect(qty.buckets[0].sub).toContain('₹')
    expect(value.buckets[0].sub).toContain('units')
  })

  it('reports the centre figure the slices actually add to', () => {
    // With a negative bucket excluded, the report's own total and the base the
    // shares were taken over differ — and the donut's centre must be the base,
    // or the slices do not add to the number printed inside them.
    const withNegative = ageing({
      // What the report would really send: the negative bucket is inside its
      // own total, so the two figures genuinely part company.
      total_value: 4_812_000,
      buckets: { ...ageing().buckets, '180_plus': { qty: -10, value: -50_000 } } as StockAgeingSummary['buckets'],
    })
    const view = ageingView(withNegative, '2026-09-15')
    expect(view.compositionInvalid).toBe(true)
    expect(view.positiveTotal).toBe(4_862_000)
    expect(view.reportedTotal).toBe(4_812_000)
    // The centre reports the base the slices were taken over, not the report's
    // total — otherwise the slices do not add to the number printed inside them.
    expect(view.totalDisplay).toBe('₹48.62 L')
    expect(view.totalLabel).toBe('Total value')
  })

  it('judges a bucket negative by the measure being shown', () => {
    // A bucket can be positive in value and negative in quantity; which buckets
    // are exceptions genuinely depends on the toggle.
    const mixed = ageing({
      buckets: { ...ageing().buckets, '180_plus': { qty: -5, value: 1_000 } } as StockAgeingSummary['buckets'],
    })
    expect(ageingView(mixed, '2026-09-15', 'value').negatives).toHaveLength(0)
    expect(ageingView(mixed, '2026-09-15', 'quantity').negatives).toHaveLength(1)
  })

  it('labels the quantity centre without inventing a currency for it', () => {
    const view = ageingView(ageing(), '2026-09-15', 'quantity')
    expect(view.totalLabel).toBe('Total quantity')
    expect(view.totalDisplay).not.toContain('₹')
  })
})

describe('movement thresholds', () => {
  it('spells out the rule behind each class, because people write stock off on it', () => {
    const notes = movementThresholds({
      from: '2026-04-01',
      to: '2026-09-15',
      thresholds: { fast_days: 30, slow_days: 60, dead_days: 180 },
      by_class: {
        fast: { items: 1, on_hand: 1, period_out_qty: 1 },
        slow: { items: 1, on_hand: 1, period_out_qty: 1 },
        non_moving: { items: 1, on_hand: 1, period_out_qty: 1 },
        dead: { items: 1, on_hand: 1, period_out_qty: 1 },
      },
    })
    expect(notes).toHaveLength(4)
    expect(notes[3].detail).toContain('180')
    for (const n of notes) expect(n.detail).toMatch(/\d+/)
  })
})
