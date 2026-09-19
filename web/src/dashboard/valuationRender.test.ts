import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AgeingDonut } from './charts/AgeingDonut'
import { DeltaChip } from './components/DeltaChip'
import { HealthScoreRing } from './components/HealthScoreRing'
import { InventoryInsightBar } from './components/InventoryInsightBar'
import { MethodComparisonTable } from './components/MethodComparisonTable'
import { MovementClassTable } from './components/MovementClassTable'
import { RiskList } from './components/RiskList'
import { StockHealthHero } from './components/StockHealthHero'
import { methodRows } from './valuationMethods'
import type { RiskRow, StockHealth } from './valuationHealth'
import type { SeriesItem } from './model'

/**
 * The Valuation dashboard's own components, rendered to static HTML.
 *
 * Same environment and the same reasons as render.test.ts: these assertions are
 * about the markup, because the claims they defend are properties of the markup.
 * A score a screen reader cannot read, a risk conveyed by colour alone, or a
 * chip that links nowhere all typecheck perfectly.
 */
function render(node: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node))
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
}

const health: StockHealth = {
  score: 84,
  label: 'Good stock health',
  tone: 'success',
  summary: 'Mostly ageing and concentration.',
  factors: [],
  assessed: 6,
  total: 6,
}

describe('HealthScoreRing', () => {
  it('puts the score in text, not only in the arc', () => {
    const html = render(createElement(HealthScoreRing, { score: 84 }))
    expect(html).toContain('>84<')
    expect(html).toContain('/100')
    expect(html).toContain('aria-label="Stock health score 84 out of 100"')
  })

  it('draws an em dash rather than a zero when there is no score', () => {
    // A company whose every report failed must not be told its stock is
    // worthless.
    const html = render(createElement(HealthScoreRing, { score: null }))
    expect(html).toContain('—')
    expect(html).not.toContain('>0<')
    expect(html).toContain('not available')
  })
})

describe('StockHealthHero', () => {
  const actions = [{ key: 'slow_moving', label: 'Review 12 slow-moving SKUs', to: '/reports/movement-analysis?class=slow' }]

  it('calls itself a rule-based score and never an AI insight', () => {
    // There is no AI service behind this product; the label is the difference
    // between a number someone can check and one they are asked to trust.
    const html = render(createElement(StockHealthHero, { health, actions, anyDataKnown: true }))
    expect(html).toContain('Stock health insight')
    expect(html).toContain('Rule-based score')
    expect(html).not.toMatch(/\bAI\b/)
  })

  it('renders every suggested action as a link that goes somewhere', () => {
    const html = render(createElement(StockHealthHero, { health, actions, anyDataKnown: true }))
    expect(hrefs(html)).toContain('/reports/movement-analysis?class=slow')
  })

  it('says nothing needs attention rather than drawing an empty pill row', () => {
    const html = render(createElement(StockHealthHero, { health, actions: [], anyDataKnown: true }))
    expect(html).toContain('Nothing in this scope needs attention')
    expect(hrefs(html)).toHaveLength(0)
  })

  it('says how many factors it could read when some source failed', () => {
    const partial = { ...health, assessed: 4 }
    const html = render(createElement(StockHealthHero, { health: partial, actions: [], anyDataKnown: true }))
    expect(html).toContain('4 of 6 factors could be read')
  })

  it('shows a skeleton, not a score, before anything has loaded', () => {
    const html = render(
      createElement(StockHealthHero, { health, actions: [], anyDataKnown: false, loading: true }),
    )
    expect(html).toContain('skeleton')
    expect(html).not.toContain('>84<')
  })
})

describe('RiskList', () => {
  const rows: RiskRow[] = [
    { key: 'expiry', title: 'Expiry risk', detail: 'No batches expiring in 30 days', level: 'low', to: '/reports/near-expiry?days=30' },
    { key: 'slow_moving', title: 'Slow-moving stock', detail: '1 item, 60 units on hand', level: 'medium', to: '/reports/movement-analysis?class=slow' },
    { key: 'orphan', title: 'Nowhere to go', detail: 'No register lists this', level: 'high' },
  ]

  it('spells the level out in words, so colour is never the only carrier', () => {
    const html = render(createElement(RiskList, { rows }))
    expect(html).toContain('Low')
    expect(html).toContain('Medium')
    expect(html).toContain('High')
  })

  it('links a row to the register behind it, and renders the rest as text', () => {
    const html = render(createElement(RiskList, { rows }))
    const links = hrefs(html)
    expect(links).toContain('/reports/near-expiry?days=30')
    expect(links).toContain('/reports/movement-analysis?class=slow')
    expect(links).toHaveLength(2)
    expect(html).toContain('Nowhere to go')
  })

  it('names the row for a screen reader, level included', () => {
    const html = render(createElement(RiskList, { rows }))
    expect(html).toContain('aria-label="Expiry risk — Low risk. No batches expiring in 30 days"')
  })
})

describe('AgeingDonut', () => {
  const items: SeriesItem[] = [
    { key: '0_30', label: '0–30 days', value: 500_000, display: '₹5.00 L', share: 50, scale: 100, tone: 'success', sub: '500 units', to: '/reports/stock-ageing' },
    { key: '31_60', label: '31–60 days', value: 300_000, display: '₹3.00 L', share: 30, scale: 60, tone: 'info', sub: '300 units', to: '/reports/stock-ageing' },
    { key: '180_plus', label: '180+ days', value: 200_000, display: '₹2.00 L', share: 20, scale: 40, tone: 'critical', sub: '200 units', to: '/reports/stock-ageing' },
  ]

  it('keeps the buckets in age order rather than sorting by size', () => {
    // Colour carries age here. Re-ordering by size would paint the oldest
    // bucket green whenever it happened to be the largest.
    const html = render(
      createElement(AgeingDonut, { items, centerValue: '₹10.00 L', centerLabel: 'Total value', measureLabel: 'value at cost' }),
    )
    expect(html.indexOf('0–30 days')).toBeLessThan(html.indexOf('31–60 days'))
    expect(html.indexOf('31–60 days')).toBeLessThan(html.indexOf('180+ days'))
  })

  it('carries the same figures in an accessible table', () => {
    const html = render(
      createElement(AgeingDonut, { items, centerValue: '₹10.00 L', centerLabel: 'Total value', measureLabel: 'value at cost' }),
    )
    expect(html).toContain('<table>')
    expect(html).toContain('sr-only')
    expect(html).toContain('Ageing of remaining stock by value at cost')
  })

  it('prints the centre figure it was handed, never one it added up itself', () => {
    const html = render(
      createElement(AgeingDonut, { items, centerValue: '₹48.62 L', centerLabel: 'Total value', measureLabel: 'value at cost' }),
    )
    expect(html).toContain('₹48.62 L')
  })
})

describe('MovementClassTable', () => {
  const rows: SeriesItem[] = [
    { key: 'fast', label: 'Fast moving', value: 18, display: '18 items', share: 90, scale: 100, tone: 'success', sub: '900 on hand', to: '/reports/movement-analysis?class=fast' },
    { key: 'dead', label: 'Dead stock', value: 0, display: '0 items', share: 0, scale: 0, tone: 'critical', sub: '0 on hand', to: '/reports/movement-analysis?class=dead' },
  ]

  it('never heads a column with a currency the report does not carry', () => {
    // The movement summary has item counts and quantity per class and no value
    // at all; a rupee column here would come from a different report.
    const html = render(createElement(MovementClassTable, { rows, caption: 'Items per movement class.' }))
    expect(html).toContain('On hand')
    expect(html).toContain('% items')
    expect(html).not.toContain('₹')
  })

  it('links each category to the class it counts', () => {
    const html = render(createElement(MovementClassTable, { rows, caption: 'x' }))
    expect(hrefs(html)).toEqual([
      '/reports/movement-analysis?class=fast',
      '/reports/movement-analysis?class=dead',
    ])
  })
})

describe('MethodComparisonTable', () => {
  it('prints Unavailable rather than a zero for a method that did not answer', () => {
    const rows = methodRows([
      { method: 'AS_PER_MASTER', summary: { as_of: '2026-09-19', method: 'AS_PER_MASTER', total_qty: 10, total_value: 1_000_000, item_count: 5 } },
      { method: 'FIFO', summary: null },
      { method: 'LIFO', summary: null },
      { method: 'WAC', summary: null },
    ])
    const html = render(createElement(MethodComparisonTable, { rows }))
    expect(html).toContain('Unavailable')
    expect(html).toContain('Current basis')
    expect(html).not.toContain('₹0')
  })

  it('offers no control that would switch the company onto another method', () => {
    const rows = methodRows([
      { method: 'AS_PER_MASTER', summary: { as_of: '2026-09-19', method: 'AS_PER_MASTER', total_qty: 10, total_value: 1_000_000, item_count: 5 } },
      { method: 'FIFO', summary: { as_of: '2026-09-19', method: 'FIFO', total_qty: 10, total_value: 1_010_000, item_count: 5 } },
      { method: 'LIFO', summary: null },
      { method: 'WAC', summary: null },
    ])
    const html = render(createElement(MethodComparisonTable, { rows }))
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).toContain('Comparison only')
  })
})

describe('InventoryInsightBar', () => {
  it('states the sync status in words beside its dot', () => {
    const html = render(
      createElement(InventoryInsightBar, { chips: [], state: 'synced', lastSyncedAt: Date.parse('2026-09-19T10:24:00Z') }),
    )
    expect(html).toContain('Data is in sync')
    expect(html).toContain('aria-live="polite"')
  })

  it('says it has not loaded rather than stamping an empty screen', () => {
    const html = render(createElement(InventoryInsightBar, { chips: [], state: 'refreshing', lastSyncedAt: null }))
    expect(html).toContain('Not loaded yet')
    expect(html).toContain('Refreshing')
  })

  it('links a chip that has a destination and renders one that has none as text', () => {
    const html = render(
      createElement(InventoryInsightBar, {
        chips: [
          { key: 'a', label: '62% of value in top 5 items', tone: 'warning', to: '/reports/stock-summary' },
          { key: 'b', label: 'No expiry exposure', tone: 'success' },
        ],
        state: 'synced',
        lastSyncedAt: Date.parse('2026-09-19T10:24:00Z'),
      }),
    )
    expect(hrefs(html)).toEqual(['/reports/stock-summary'])
    expect(html).toContain('No expiry exposure')
  })
})

describe('DeltaChip', () => {
  it('renders nothing at all without a prior figure to compare against', () => {
    expect(render(createElement(DeltaChip, { delta: null, comparedTo: null }))).toBe('')
  })

  it('colours by whether the movement is good, not by whether it is up', () => {
    // More slow-moving stock is never an improvement.
    const worse = render(
      createElement(DeltaChip, { delta: { percent: 50, direction: 'up' }, comparedTo: '2026-08-19', goodWhen: 'down' }),
    )
    expect(worse).toContain('text-red-600')
    const better = render(
      createElement(DeltaChip, { delta: { percent: -50, direction: 'down' }, comparedTo: '2026-08-19', goodWhen: 'down' }),
    )
    expect(better).toContain('text-emerald-600')
  })

  it('says "up from nil" instead of an infinite percentage', () => {
    const html = render(
      createElement(DeltaChip, { delta: { percent: null, direction: 'up' }, comparedTo: '2026-08-19' }),
    )
    expect(html).toContain('Up from nil')
    expect(html).not.toContain('Infinity')
    expect(html).not.toContain('NaN')
  })

  it('names the date it compared against', () => {
    const html = render(
      createElement(DeltaChip, { delta: { percent: 12, direction: 'up' }, comparedTo: '2026-08-19' }),
    )
    expect(html).toContain('12%')
    expect(html).toContain('19 Aug 2026')
  })
})
