import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BarList } from './charts/BarList'
import { DonutChart } from './charts/DonutChart'
import { KpiStrip } from './components/KpiStrip'
import { MiniTable } from './components/MiniTable'
import type { MiniColumn } from './components/MiniTable'
import { WidgetCard } from './components/WidgetCard'
import { DocumentsWidget, IntegrationWidget } from './widgets/OpsWidgets'
import { buildKpiCards } from './model'
import type { SeriesItem } from './model'

/**
 * Renders the dashboard's presentational components to static HTML.
 *
 * This runs in the existing node environment with react-dom/server — no
 * happy-dom, no testing-library, no change to vitest.config.ts, and none of the
 * 135 pre-existing tests are touched.
 *
 * What it is actually for: the brief for this screen is that a number a user
 * cannot click through to is the complaint we are trying to prevent. That is a
 * property of the rendered markup, not of the model, so it is asserted on the
 * markup — every KPI tile must come out as an `<a href>` pointing at the
 * register behind it, and so must every bar, every legend row and every table
 * row. A future refactor that quietly drops a link fails here.
 */

function render(node: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, node))
}

/** True when `cls` appears as a class token (not as a substring of another). */
function hasClass(html: string, cls: string): boolean {
  return new RegExp(`class="[^"]*\\b${cls}\\b`).test(html)
}

/** Every `href` in the markup, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
}

const series: SeriesItem[] = [
  { key: 'a', label: 'Mumbai', value: 600, display: '₹600', share: 60, scale: 100, tone: 'success', to: '/reports/warehouse-stock?warehouse_id=1', sub: '150 units' },
  { key: 'b', label: 'Pune', value: 250, display: '₹250', share: 25, scale: 41, tone: 'info', to: '/reports/warehouse-stock?warehouse_id=2' },
  { key: 'c', label: 'No warehouse', value: 150, display: '₹150', share: 15, scale: 25, tone: 'warning' },
]

describe('KpiStrip', () => {
  const cards = buildKpiCards({
    asOf: '2026-09-14',
    nearExpiryDays: 30,
    core: null,
    stock: {
      summary: { items: 88, opening_qty: 0, in_qty: 0, out_qty: 0, closing_qty: 300, closing_value: 1_24_00_000, from: null, to: '2026-09-14' },
      topItems: [],
      total: 88,
    },
    expiry: null,
    replenishment: null,
  })

  it('renders a loaded KPI as a link carrying its own filters', () => {
    const html = render(createElement(KpiStrip, { cards }))
    const links = hrefs(html)
    expect(links).toContain('/reports/stock-summary?to=2026-09-14&nonzero=1&sort=closing_value&order=desc')
    expect(html).toContain('₹1.24 Cr')
  })

  it('labels the link for screen readers', () => {
    const html = render(createElement(KpiStrip, { cards }))
    expect(html).toContain('aria-label="Open Stock value"')
  })

  it('shows a skeleton — not a zero — for a figure that has not loaded', () => {
    const html = render(createElement(KpiStrip, { cards }))
    // `reorder` has no data in this fixture, so its tile is a placeholder.
    expect(hasClass(html, 'skeleton')).toBe(true)
    expect(html).not.toContain('To reorder')
  })

  it('draws no delta arrow, because no previous-period figure exists', () => {
    const html = render(createElement(KpiStrip, { cards }))
    expect(html).not.toMatch(/\d+\.\d%/)
  })
})

describe('BarList', () => {
  it('links every bar that has a destination', () => {
    const html = render(createElement(BarList, { items: series }))
    expect(hrefs(html)).toEqual([
      '/reports/warehouse-stock?warehouse_id=1',
      '/reports/warehouse-stock?warehouse_id=2',
    ])
  })

  it('renders a row without a destination as plain text rather than a dead link', () => {
    const html = render(createElement(BarList, { items: series }))
    expect(html).toContain('No warehouse')
    expect(hrefs(html)).toHaveLength(2)
  })

  it('scales the bar against the largest row, not against the total', () => {
    const html = render(createElement(BarList, { items: series }))
    expect(html).toContain('width:100%')
    expect(html).toContain('width:41%')
  })

  it('gives a non-zero row a visible sliver even when it rounds to nothing', () => {
    const tiny: SeriesItem[] = [{ key: 't', label: 'Tiny', value: 1, display: '1', share: 1, scale: 0.2, tone: 'info' }]
    expect(render(createElement(BarList, { items: tiny }))).toContain('width:3%')
  })

  it('honours the row limit', () => {
    const html = render(createElement(BarList, { items: series, limit: 1 }))
    expect(html).toContain('Mumbai')
    expect(html).not.toContain('Pune')
  })
})

describe('DonutChart', () => {
  const html = render(createElement(DonutChart, { items: series, centerValue: '₹1,000' }))

  it('draws one arc per positive slice plus the track ring', () => {
    expect((html.match(/<circle/g) ?? []).length).toBe(4)
  })

  it('prints the real total in the middle', () => {
    expect(html).toContain('₹1,000')
  })

  it('makes each legend row a link into its slice of the register', () => {
    expect(hrefs(html)).toContain('/reports/warehouse-stock?warehouse_id=1')
  })

  it('is described for assistive technology', () => {
    expect(html).toContain('role="img"')
  })
})

describe('MiniTable', () => {
  interface Row {
    id: number
    name: string
  }
  const columns: MiniColumn<Row>[] = [
    { key: 'name', header: 'Item', render: (r) => r.name },
    { key: 'id', header: 'Id', align: 'right', render: (r) => r.id },
  ]
  const rows: Row[] = [
    { id: 1, name: 'Widget' },
    { id: 2, name: 'Gadget' },
  ]

  it('puts a real link in each row that leads somewhere', () => {
    const html = render(
      createElement(MiniTable<Row>, { columns, rows, rowKey: (r) => r.id, to: (r) => `/stock/ledger?item_id=${r.id}` }),
    )
    // An <a href> is what middle-click, Ctrl-click and the status bar need; a
    // <tr role="link"> gives none of them.
    expect(hrefs(html)).toEqual(['/stock/ledger?item_id=1', '/stock/ledger?item_id=2'])
    // The row keeps its implicit row role, so the table still reads as a table.
    expect(html).not.toContain('role="link"')
  })

  it('names each link after the row, never after its position', () => {
    const html = render(
      createElement(MiniTable<Row>, {
        columns,
        rows,
        rowKey: (r) => r.id,
        to: (r) => `/stock/ledger?item_id=${r.id}`,
        rowLabel: (r) => `${r.name} — stock ledger`,
      }),
    )
    expect(html).toContain('aria-label="Widget — stock ledger"')
    expect(html).toContain('aria-label="Gadget — stock ledger"')
    expect(html).not.toContain('Open row')
  })

  it('leaves rows inert when there is nowhere to go', () => {
    const html = render(createElement(MiniTable<Row>, { columns, rows, rowKey: (r) => r.id }))
    expect(html).not.toContain('role="link"')
    expect(hrefs(html)).toEqual([])
  })

  it('keeps the header sticky and right-aligns numeric columns', () => {
    const html = render(createElement(MiniTable<Row>, { columns, rows, rowKey: (r) => r.id }))
    expect(html).toContain('sticky top-0')
    expect(html).toContain('text-right tabular-nums')
  })
})

describe('the ops widgets render the whole payload', () => {
  const payload = {
    as_of: '2026-09-14',
    fy_id: 3,
    bo_id: 0,
    masters: { items: { total: 120, active: 110 }, warehouses: { total: 4, active: 4 } },
    documents: {
      total: 42,
      by_status: { POSTED: 30, FAILED: 4 },
      pending_approval: 5,
      failed: 4,
      posted_by_type: { SALES_ISSUE: 20, PURCHASE_RECEIPT: 10 },
    },
    stock: {
      negative_stock_rows: 3,
      negative_stock_items: 2,
      near_expiry_batches: 7,
      expired_batches: 1,
      near_expiry_days: 30,
      pending_quantities: { challan: 4 },
    },
    integration: {
      outbox: { PENDING: 6, ACKED: 38 },
      outbox_pending: 6,
      outbox_failed: 0,
      inbound: { RECEIVED: 10, PROCESSED: 9, FAILED: 1, IGNORED: 0 },
      unacknowledged_revisions: { count: 0, delta_total: 0 },
      recalculations_in_progress: 0,
    },
    last_reconciliation: null,
  }
  const query = { data: payload, loading: false, error: null, reload: () => {} }

  it('keeps "Posted, by type" on the documents card', () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const html = render(createElement(DocumentsWidget, { query } as any))
    expect(html).toContain('Posted, by type')
    expect(hrefs(html)).toContain('/documents?document_type=SALES_ISSUE')
  })

  it('shows both directions of the Books sync, not just the outbox', () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const html = render(createElement(IntegrationWidget, { query } as any))
    expect(html).toContain('Outbound to Books')
    expect(html).toContain('Inbound from Books')
    expect(html).toContain('Processed')
  })
})

describe('WidgetCard states', () => {
  const base = {
    title: 'Stock ageing',
    skeleton: createElement('div', { 'data-testid': 'skeleton' }, 'skeleton'),
    children: createElement('div', null, 'content'),
  }

  it('shows the skeleton while loading, not the content', () => {
    const html = render(
      createElement(WidgetCard, { ...base, state: { loading: true, error: null, empty: false } }),
    )
    expect(html).toContain('skeleton')
    expect(html).not.toContain('content')
  })

  it('offers a retry for this card alone when it fails, without quoting the API', () => {
    let retried = 0
    const html = render(
      createElement(WidgetCard, {
        ...base,
        errorSubject: 'stock ageing',
        state: {
          loading: false,
          error: new Error('SQLSTATE[42P01]: undefined_table inv_stock_layers'),
          empty: false,
          reload: () => (retried += 1),
        },
      }),
    )
    // The reader is told what failed and what to do, in their own vocabulary.
    expect(html).toContain('We couldn’t load stock ageing')
    expect(html).toContain('Retry')
    // And never the server's note to us. This is the whole point of errorCopy:
    // the screen this replaced printed "Company context required (cmp_id,
    // fy_id, bo_id)" onto a card a customer was looking at.
    expect(html).not.toContain('SQLSTATE')
    expect(html).not.toContain('inv_stock_layers')
    expect(retried).toBe(0)
  })

  it('explains an empty card instead of showing a dash', () => {
    const html = render(
      createElement(WidgetCard, {
        ...base,
        state: { loading: false, error: null, empty: true },
        emptyTitle: 'No ageing to report',
        emptyDescription: 'Ageing is built from open cost layers.',
      }),
    )
    expect(html).toContain('No ageing to report')
    expect(html).toContain('Ageing is built from open cost layers.')
    expect(html).not.toContain('content')
  })

  it('links the header through to the full register', () => {
    const html = render(
      createElement(WidgetCard, {
        ...base,
        viewAll: { to: '/reports/stock-ageing?as_of=2026-09-14' },
        state: { loading: false, error: null, empty: false },
      }),
    )
    expect(hrefs(html)).toContain('/reports/stock-ageing?as_of=2026-09-14')
    expect(html).toContain('content')
  })

  it('hides its footer while loading so a stale total is never shown', () => {
    const html = render(
      createElement(WidgetCard, {
        ...base,
        footer: createElement('span', null, 'Total ₹5 L'),
        state: { loading: true, error: null, empty: false },
      }),
    )
    expect(html).not.toContain('Total ₹5 L')
  })
})
