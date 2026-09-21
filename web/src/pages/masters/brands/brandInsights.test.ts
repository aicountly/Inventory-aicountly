import { describe, expect, it } from 'vitest'
import { buildBrandInsights, percentChange, shareOf } from './brandInsights'
import type { BrandMetrics } from '../../../services/masters'
import type { BrandSales } from '../../../services/brandAnalyticsApi'

const METRICS: BrandMetrics = {
  total: 24,
  active: 22,
  inactive: 2,
  new_this_month: 3,
  new_prev_month: 1,
  without_items: 4,
  with_items: 20,
  top_by_items: { brand_id: 7, brand_name: 'Apple', item_count: 12 },
  as_of: '2026-09-18T09:00:00Z',
}

const titles = (insights: { title: string }[]) => insights.map((i) => i.title)

describe('percentChange / shareOf', () => {
  it('computes the ordinary case', () => {
    expect(percentChange(3, 1)).toBe(200)
    expect(shareOf(25, 100)).toBe(25)
  })

  it('refuses to divide by nothing rather than returning zero', () => {
    expect(percentChange(3, 0)).toBeNull()
    expect(shareOf(5, 0)).toBeNull()
  })
})

describe('buildBrandInsights', () => {
  it('says nothing at all before the figures arrive', () => {
    expect(buildBrandInsights({ metrics: null, sales: null })).toEqual([])
  })

  it('states the month-on-month change from the two counts the API sent', () => {
    const [growth] = buildBrandInsights({ metrics: METRICS, sales: null })
    expect(growth.title).toBe('3 brands added this month')
    expect(growth.description).toBe('That is 200% more than last month.')
    expect(growth.to).toBe('/masters/brands?created=month')
  })

  it('does not claim a comparison when last month was empty', () => {
    const [growth] = buildBrandInsights({
      metrics: { ...METRICS, new_this_month: 2, new_prev_month: 0 },
      sales: null,
    })
    expect(growth.description).toContain('nothing to compare')
  })

  it('drops the growth line entirely when neither month had anything', () => {
    const insights = buildBrandInsights({
      metrics: { ...METRICS, new_this_month: 0, new_prev_month: 0 },
      sales: null,
    })
    expect(insights.some((i) => i.id === 'growth')).toBe(false)
  })

  it('surfaces unlinked brands as a warning that links to that filter', () => {
    const linkage = buildBrandInsights({ metrics: METRICS, sales: null }).find((i) => i.id === 'linkage')
    expect(linkage).toMatchObject({ tone: 'warning', to: '/masters/brands?has_items=0' })
    expect(linkage?.title).toBe('4 brands have no items')
  })

  it('congratulates rather than warns when every brand is in use', () => {
    const linkage = buildBrandInsights({
      metrics: { ...METRICS, without_items: 0, with_items: 24 },
      sales: null,
    }).find((i) => i.id === 'linkage')
    expect(linkage).toMatchObject({ tone: 'positive', title: 'Every brand is in use' })
  })

  it('reports the item leader without calling it a sales leader', () => {
    const top = buildBrandInsights({ metrics: METRICS, sales: null }).find((i) => i.id === 'top-items')
    expect(top?.title).toBe('Apple carries the most items')
    expect(top?.description).toBe('12 items are filed under it.')
  })

  it('says nothing about revenue while Sales is not connected', () => {
    const disconnected: BrandSales = { available: false, reason: 'not_configured', currency: null, rows: [] }
    const insights = buildBrandInsights({ metrics: METRICS, sales: disconnected })
    expect(insights.some((i) => i.id === 'top-sales')).toBe(false)
    expect(titles(insights).join(' ')).not.toMatch(/revenue|sales/i)
  })

  it('reports the revenue leader once Sales answers, as a share of what it attributed', () => {
    const sales: BrandSales = {
      available: true,
      reason: null,
      currency: 'INR',
      rows: [
        { brand_id: 7, sales: 1_245_670, trend: null },
        { brand_id: 9, sales: 600_000, trend: null },
      ],
    }
    const leader = buildBrandInsights({
      metrics: METRICS,
      sales,
      nameOf: (id) => (id === 7 ? 'Apple' : 'Canon'),
    }).find((i) => i.id === 'top-sales')
    expect(leader?.title).toBe('Apple leads on revenue')
    expect(leader?.description).toContain('67% of brand-attributed sales')
  })

  it('stays silent about a revenue leader whose name it cannot resolve', () => {
    const sales: BrandSales = {
      available: true,
      reason: null,
      currency: 'INR',
      rows: [{ brand_id: 99, sales: 100, trend: null }],
    }
    const insights = buildBrandInsights({ metrics: METRICS, sales, nameOf: () => null })
    expect(insights.some((i) => i.id === 'top-sales')).toBe(false)
  })
})
