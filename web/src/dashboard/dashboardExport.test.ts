import { describe, expect, it } from 'vitest'
import { buildDashboardPrintHtml } from './dashboardExport'
import type { DashboardExportOptions } from './dashboardExport'

function options(overrides: Partial<DashboardExportOptions> = {}): DashboardExportOptions {
  return {
    title: 'Valuation and stock health',
    description: 'Understand inventory cost, ageing and capital tied up in stock.',
    companyName: 'Acme Traders',
    fyLabel: '2026-27',
    branchLabel: 'Delhi',
    warehouseLabel: 'Main (Head Office)',
    asOf: '2026-09-15',
    generatedAt: '2026-09-15T10:42:00Z',
    metrics: [['Closing stock value', '₹48.62 L', 'Value at cost as at the cutoff']],
    tables: [
      {
        title: 'Ageing of remaining stock',
        columns: ['Age bucket', 'Value at cost'],
        rows: [['0 – 30 days', '₹30.14 L']],
        numericColumns: [1],
      },
    ],
    notes: ['Every figure is at cost.'],
    now: new Date('2026-09-15T11:00:00Z'),
    ...overrides,
  }
}

/**
 * A dashboard PDF is a document someone files. These pin the properties that
 * make it a document rather than a picture of a screen.
 */
describe('buildDashboardPrintHtml', () => {
  it('carries the whole scope, so a filed sheet is reconcilable later', () => {
    const html = buildDashboardPrintHtml(options())
    for (const part of ['Acme Traders', '2026-27', 'Delhi', 'Main (Head Office)', 'As at 2026-09-15']) {
      expect(html, `scope line is missing ${part}`).toContain(part)
    }
  })

  it('prints each figure with what it counts', () => {
    // "48.62 L" is not reconcilable a week later without its definition.
    const html = buildDashboardPrintHtml(options())
    expect(html).toContain('₹48.62 L')
    expect(html).toContain('Value at cost as at the cutoff')
  })

  it('repeats table headers across pages and never splits a row', () => {
    // The two rules that make a long table survive paper.
    const html = buildDashboardPrintHtml(options())
    expect(html).toContain('thead { display: table-header-group; }')
    expect(html).toContain('tr { break-inside: avoid; }')
  })

  it('lets a long table break across pages instead of running off page one', () => {
    // break-inside:avoid on the CONTAINER is the classic way to lose every row
    // past the first page.
    const html = buildDashboardPrintHtml(options())
    expect(html).toContain('.block { break-inside: auto; }')
  })

  it('says out loud when it is showing a subset', () => {
    const html = buildDashboardPrintHtml(
      options({
        tables: [
          {
            title: 'Replenishment',
            columns: ['Item'],
            rows: [['Widget']],
            note: 'Showing the 10 largest suggestions of 47 triggered rows.',
          },
        ],
      }),
    )
    expect(html).toContain('Showing the 10 largest suggestions of 47 triggered rows.')
  })

  it('renders an empty table as a sentence rather than a blank box', () => {
    const html = buildDashboardPrintHtml(options({ tables: [{ title: 'Expiry', columns: ['Item', 'Batch'], rows: [] }] }))
    expect(html).toContain('Nothing to show for this scope.')
    expect(html).toContain('colspan="2"')
  })

  it('escapes company and item names rather than injecting them', () => {
    const html = buildDashboardPrintHtml(options({ companyName: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('shows Unavailable for a figure that could not be read, never a zero', () => {
    const html = buildDashboardPrintHtml(options({ metrics: [['Closing stock value', null, 'At cost']] }))
    expect(html).toContain('Unavailable')
  })

  it('stamps both when it was printed and when the figures were computed', () => {
    const html = buildDashboardPrintHtml(options())
    expect(html).toContain('Generated')
    expect(html).toContain('2026-09-15T10:42:00Z')
  })

  it('prints the methodology notes', () => {
    const html = buildDashboardPrintHtml(options())
    expect(html).toContain('How these figures are counted')
    expect(html).toContain('Every figure is at cost.')
  })
})
