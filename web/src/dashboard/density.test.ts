import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DashboardPageHeader } from './components/DashboardPageHeader'
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

describe('dashboard heading', () => {
  const header = () =>
    render(
      createElement(DashboardPageHeader, {
        title: 'Inventory overview',
        description: 'Your stock position and the things that need attention first.',
        companyName: 'Acme Traders',
        fyLabel: '2026-27',
        branchLabel: 'All branches',
        asOf: '2026-09-14',
        onAsOf: () => {},
        maxDate: '2026-09-15',
        warehouses: [],
        warehouseId: null,
        onWarehouseId: () => {},
        refreshing: false,
        onRefresh: () => {},
        lastSyncedAt: null,
      }),
    )

  it('uses the Books heading scale', () => {
    // Asserted as two classes on the h1 rather than as one literal string:
    // the exact order of utility classes is a formatting detail, and pinning it
    // makes the test fail on a rename that changed nothing a reader can see.
    const h1 = /<h1[^>]*class="([^"]*)"/.exec(header())?.[1] ?? ''
    expect(h1, 'no h1 was rendered').not.toBe('')
    expect(h1).toContain('text-xl')
    expect(h1).toContain('md:text-2xl')
  })

  it('states the whole scope every figure below it is counted in', () => {
    // The scope line is the contract between a card and the register behind it.
    // Drop any one of these and a figure stops being reconcilable.
    const html = header()
    for (const part of ['Acme Traders', '2026-27', 'All branches', 'All warehouses', '14 Sept 2026']) {
      expect(html, `scope line is missing ${part}`).toContain(part)
    }
  })

  it('will not offer a date in the future', () => {
    // A dashboard reports what has happened. A cutoff after today would ask the
    // server for figures that do not exist yet.
    expect(header()).toContain('max="2026-09-15"')
  })
})
