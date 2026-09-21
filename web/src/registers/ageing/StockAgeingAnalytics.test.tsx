import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { StockAgeingAnalytics } from './StockAgeingAnalytics'
import type { StockAgeingSummary } from '../../services/reportsApi'

/*
 * The analytics band over the ageing register.
 *
 * Two things are the subject here, and they are the two things a chart over a
 * register can get wrong: that every figure drawn is the server's own, and that
 * clicking a band narrows the register rather than quietly showing something else.
 */

function summary(overrides: Partial<StockAgeingSummary> = {}): StockAgeingSummary {
  return {
    items: 428,
    total_qty: 12480,
    total_value: 4876920,
    buckets: {
      '0_30': { qty: 5200, value: 1860000, items: 162 },
      '31_60': { qty: 3100, value: 1120000, items: 98 },
      '61_90': { qty: 2035, value: 940000, items: 67 },
      '91_180': { qty: 1145, value: 535370, items: 64 },
      '180_plus': { qty: 1000, value: 421550, items: 37 },
    },
    bucket_labels: {
      '0_30': '0-30 days',
      '31_60': '31-60 days',
      '61_90': '61-90 days',
      '91_180': '91-180 days',
      '180_plus': '180+ days',
    },
    as_of: '2026-09-19',
    weighted_age_days: 67,
    oldest_days: 412,
    value_over_90: 956920,
    value_over_180: 421550,
    qty_over_90: 2145,
    qty_over_180: 1000,
    by_health: { fresh: 200, healthy: 127, watch: 64, slow: 0, obsolete: 37 },
    health_score: 82,
    health_band: 'healthy',
    age_bucket: null,
    health_status: null,
    warehouses: [
      { warehouse_id: 1, warehouse_name: 'Main WH', total_qty: 9000, total_value: 3000000, value_over_90: 580000, value_over_180: 260000, weighted_age_days: 74 },
    ],
    item_groups: [
      { item_grp_id: 4, grp_name: 'Electrical components', total_qty: 2100, total_value: 900000, value_over_90: 310000, value_over_180: 190000, weighted_age_days: 96 },
    ],
    ...overrides,
  }
}

function Url() {
  const { search } = useLocation()
  return <output data-testid="url">{search}</output>
}

function renderBand(props: Partial<{ summary: StockAgeingSummary; loading: boolean }> = {}, url = '/registers/stock-ageing') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <StockAgeingAnalytics summary={props.summary ?? summary()} loading={props.loading ?? false} />
      <Url />
    </MemoryRouter>,
  )
}

describe('the ageing distribution chart', () => {
  it('draws one band per bucket, in ageing order, with the server’s share', () => {
    renderBand()
    const bars = screen.getAllByRole('button', { name: /days:/ })
    expect(bars).toHaveLength(5)
    const labels = bars.map((b) => b.getAttribute('aria-label') ?? '')
    expect(labels[0]).toMatch(/^0-30 days:/)
    expect(labels[4]).toMatch(/^180\+ days:/)
    // 421550 / 4876920 = 8.6%
    expect(labels[4]).toContain('8.6% of value')
    // Every band states all three measures, whichever one is drawn.
    expect(labels[4]).toContain('4,21,550.00')
    expect(labels[4]).toContain('1,000 qty')
    expect(labels[4]).toContain('37 items')
  })

  it('ships a text equivalent carrying the same figures as the bars', () => {
    renderBand()
    const table = screen.getByRole('table', { name: /stock ageing distribution/i })
    const row = within(table).getByRole('row', { name: /180\+ days/ })
    expect(within(row).getByRole('cell', { name: '1,000' })).toBeTruthy()
    expect(within(row).getByRole('cell', { name: '4,21,550.00' })).toBeTruthy()
    expect(within(row).getByRole('cell', { name: '37' })).toBeTruthy()
  })

  it('switches the drawn measure without inventing a figure', () => {
    renderBand()
    fireEvent.click(screen.getByRole('tab', { name: 'Items' }))
    const bars = screen.getAllByRole('button', { name: /days:/ })
    // 162 of 428 item-band pairs in the first band.
    expect(bars[0].getAttribute('aria-label')).toContain('37.9% of items')
  })

  it('says so plainly rather than drawing an empty axis', () => {
    renderBand({
      summary: summary({
        items: 0,
        total_value: 0,
        total_qty: 0,
        buckets: {
          '0_30': { qty: 0, value: 0, items: 0 },
          '31_60': { qty: 0, value: 0, items: 0 },
          '61_90': { qty: 0, value: 0, items: 0 },
          '91_180': { qty: 0, value: 0, items: 0 },
          '180_plus': { qty: 0, value: 0, items: 0 },
        },
      }),
    })
    expect(screen.getByText(/no stock on hand at this date/i)).toBeTruthy()
  })
})

describe('the donut', () => {
  it('centres the register’s own item count and lists every band', () => {
    renderBand()
    expect(screen.getByText('428')).toBeTruthy()
    // One legend row per band, each naming its band, its count and its share.
    const legend = screen
      .getAllByRole('button')
      .filter((b) => /^\d+-\d+ days|^180\+ days/.test(b.textContent ?? ''))
    expect(legend).toHaveLength(5)
    expect(legend[0].textContent).toContain('162')
    expect(legend[0].textContent).toContain('37.9%')
    expect(legend[4].textContent).toContain('37')
    expect(legend[4].textContent).toContain('8.6%')
  })

  it('says plainly that the bands are a distribution of the items in stock', () => {
    renderBand()
    expect(screen.getByText(/distribution of the items currently in stock/i)).toBeTruthy()
  })

  it('warns when an item holding stock in three bands has been counted in three', () => {
    // 162 + 98 + 67 + 64 + 37 = 428 band memberships across only 300 items.
    renderBand({ summary: summary({ items: 300 }) })
    expect(screen.getByText(/counted in every band they hold stock in/i)).toBeTruthy()
  })
})

describe('drilling in', () => {
  it('writes the bucket into the URL, where the register reads its filters', () => {
    renderBand()
    fireEvent.click(screen.getAllByRole('button', { name: /180\+ days:/ })[0])
    expect(screen.getByTestId('url').textContent).toContain('age_bucket=180_plus')
  })

  it('resets the page, because a drill-down is a new question', () => {
    renderBand({}, '/registers/stock-ageing?page=7')
    fireEvent.click(screen.getAllByRole('button', { name: /91-180 days:/ })[0])
    const url = screen.getByTestId('url').textContent ?? ''
    expect(url).toContain('age_bucket=91_180')
    expect(url).not.toContain('page=7')
  })

  it('clicking the selected band again clears it', () => {
    renderBand({ summary: summary({ age_bucket: '180_plus' }) }, '/registers/stock-ageing?age_bucket=180_plus')
    expect(screen.getByText(/every figure on this page describes the drilled-in rows only/i)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /180\+ days:/ })[0])
    expect(screen.getByTestId('url').textContent).not.toContain('age_bucket')
  })

  it('offers a labelled way out of the drill-down', () => {
    renderBand({}, '/registers/stock-ageing?age_bucket=91_180')
    fireEvent.click(screen.getByRole('button', { name: /clear the 91-180 days drill-down/i }))
    expect(screen.getByTestId('url').textContent).not.toContain('age_bucket')
  })
})

describe('the health panel', () => {
  it('shows the score the server sent, with its band in words', () => {
    renderBand()
    expect(screen.getByRole('heading', { name: 'Healthy' })).toBeTruthy()
    expect(screen.getByText('82')).toBeTruthy()
    expect(screen.getByText('82 / 100')).toBeTruthy()
  })

  it('shows its working on request, weights and all', () => {
    renderBand()
    const toggle = screen.getByRole('button', { name: /how is this calculated/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/× 60 penalty/)).toBeTruthy()
    expect(screen.getByText(/× 25 penalty/)).toBeTruthy()
    expect(screen.getByText(/not a forecast/i)).toBeTruthy()
  })

  it('prints the capital at risk and the weighted age', () => {
    renderBand()
    expect(screen.getByText('Capital over 90 days')).toBeTruthy()
    expect(screen.getByText('Capital over 180 days')).toBeTruthy()
    expect(screen.getByText('67 days')).toBeTruthy()
  })

  it('scores nothing rather than perfectly when there is no stock', () => {
    renderBand({ summary: summary({ items: 0, health_score: null, health_band: null }) })
    expect(screen.getByRole('heading', { name: /not scored/i })).toBeTruthy()
    expect(screen.getByText(/no stock on hand at this date to score/i)).toBeTruthy()
  })
})
