import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DashboardHeader } from './components/DashboardHeader'
import { KpiStrip } from './components/KpiStrip'
import type { KpiCardSpec } from './model'

/**
 * Density, against Books rather than against the eye.
 *
 * Both products now rem-scale off the same 13px root, so any spacing this screen
 * tightens by hand is a divergence, not a correction — the same markup would
 * then read differently in the two apps, which is the one thing a verbatim port
 * is for. The Books originals are
 * books-react-app/web/src/modules/dashboard/dashboards/inventory/InventoryKpiStrip.jsx
 * and .../components/DashboardGreeting.jsx.
 *
 * The strip is also checked for the other half of the problem: a placeholder of
 * a guessed height. Eight tiles land from four independent requests, so a
 * placeholder that is not exactly as tall as the card shifts everything below it
 * four separate times on every load.
 */

function render(node: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node))
}

/** Class attribute of the strip's first tile, loaded or loading. */
function firstTileClass(html: string): string {
  const grid = html.slice(html.indexOf('class="grid'))
  const inside = grid.slice(grid.indexOf('>') + 1)
  return /<(?:div|a|span)[^>]*class="([^"]*)"/.exec(inside)?.[1] ?? ''
}

const card = (over: Partial<KpiCardSpec>): KpiCardSpec => ({
  key: 'stock_value',
  label: 'Stock value',
  value: '₹1.2 Cr',
  numeric: 12_000_000,
  icon: 'value',
  tone: 'success',
  hint: 'Closing value as at 2026-09-14',
  ...over,
})

describe('KPI strip density', () => {
  it('spaces the tiles the way Books does', () => {
    const html = render(createElement(KpiStrip, { cards: [card({})] }))
    expect(html).toContain('grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8')
  })

  it('gives the placeholder the loaded tile’s geometry, not a pixel height', () => {
    const loaded = firstTileClass(render(createElement(KpiStrip, { cards: [card({})] })))
    const loading = firstTileClass(
      render(createElement(KpiStrip, { cards: [card({ value: null, numeric: null })] })),
    )
    expect(loaded, 'the loaded tile was not found').toContain('min-w-[160px]')
    // Same shell, same padding, same rows: nothing can move when data lands.
    expect(loading).toBe(loaded)
    expect(loading).not.toMatch(/\bh-\[/)
  })
})

describe('dashboard greeting', () => {
  it('uses the Books heading scale', () => {
    const html = render(
      createElement(DashboardHeader, {
        companyName: 'Acme Traders',
        fyLabel: '2026-27',
        branchLabel: 'All branches',
        asOf: '2026-09-14',
        lastSyncedAt: null,
        refreshing: false,
        onRefresh: () => {},
        nearExpiryDays: 30,
        nearExpiryChoices: [15, 30],
        onNearExpiryDays: () => {},
      }),
    )
    expect(html).toContain('text-xl md:text-2xl')
  })
})
