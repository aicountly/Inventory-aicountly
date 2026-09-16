import { describe, expect, it } from 'vitest'
import { REPORT_CONFIGS } from '../configs'
import { registerRoute } from '../../registers/RegisterConfig'
import { stockLedgerRegister } from '../../registers/configs/stockRegisters'
import { valuationRegister } from '../../registers/configs/opsRegisters'
import {
  CATEGORY_ORDER,
  REPORT_DIRECTORY,
  filterReports,
  reportLink,
  reportsInCategory,
  toCategory,
} from './reportDirectory'
import type { ReportDirectoryEntry } from './reportDirectory'

const byId = (id: string) => REPORT_DIRECTORY.find((r) => r.id === id)!
const ids = (list: readonly ReportDirectoryEntry[]) => list.map((r) => r.id)

describe('report directory', () => {
  it('lists every report the page has always offered, with unique ids', () => {
    expect(ids(REPORT_DIRECTORY).sort()).toEqual(
      [
        'batch-stock',
        'movement-analysis',
        'near-expiry',
        'replenishment',
        'serial-numbers',
        'stock-ageing',
        'stock-ledger',
        'stock-summary',
        'stock-valuation',
        'warehouse-stock',
      ].sort(),
    )
    expect(new Set(ids(REPORT_DIRECTORY)).size).toBe(REPORT_DIRECTORY.length)
  })

  /* The point of the whole module: a card must open the URL the report is
     actually served at, not one the directory invented. */
  it('points each card at the route its own config is mounted on', () => {
    for (const config of REPORT_CONFIGS) {
      const entry = REPORT_DIRECTORY.find((r) => r.title === config.title)
      expect(entry, config.title).toBeTruthy()
      expect(entry!.route, config.title).toBe(`/reports/${config.path}`)
    }
    expect(byId('stock-ledger').route).toBe(registerRoute(stockLedgerRegister))
    expect(byId('stock-valuation').route).toBe(registerRoute(valuationRegister))
  })

  it('takes the permission from the config, so access cannot drift from the report', () => {
    expect(byId('stock-summary').permission).toBe('reports.stock_summary.read')
    expect(byId('serial-numbers').permission).toBe('reports.serial_stock.read')
    expect(byId('stock-ledger').permission).toBe('reports.stock_ledger.read')
    expect(byId('stock-valuation').permission).toBe('reports.valuation.read')
  })

  it('shelves all ten, and only onto shelves the toolbar offers', () => {
    const shelved = CATEGORY_ORDER.flatMap((c) => reportsInCategory(REPORT_DIRECTORY, c))
    expect(shelved).toHaveLength(REPORT_DIRECTORY.length)
    expect(ids(reportsInCategory(REPORT_DIRECTORY, 'valuation-ledger'))).toEqual([
      'stock-ledger',
      'stock-valuation',
    ])
  })

  it('carries an icon for every card', () => {
    for (const entry of REPORT_DIRECTORY) expect(entry.icon, entry.id).toBeTruthy()
  })
})

describe('searching the directory', () => {
  it('finds a report by a word in its title', () => {
    expect(ids(filterReports(REPORT_DIRECTORY, { search: 'warehouse' }))).toContain(
      'warehouse-stock',
    )
  })

  it('finds the reports about expiry, including the one not named for it', () => {
    const found = ids(filterReports(REPORT_DIRECTORY, { search: 'expiry' }))
    expect(found).toContain('near-expiry')
    expect(found).toContain('batch-stock')
    // Not everything filed on the "Ageing & expiry" shelf: replenishment is
    // about reorder points, and a search is not a shelf.
    expect(found).not.toContain('replenishment')
  })

  it('matches keywords the text never says, so "valuation" reaches the summary too', () => {
    const found = ids(filterReports(REPORT_DIRECTORY, { search: 'valuation' }))
    expect(found).toContain('stock-valuation')
    expect(found).toContain('stock-summary')
  })

  it('narrows on every term rather than widening', () => {
    const found = ids(filterReports(REPORT_DIRECTORY, { search: 'batch expiry' }))
    expect(found).toContain('batch-stock')
    expect(found).toContain('near-expiry')
    expect(found).not.toContain('stock-summary')
  })

  it('ignores case and stray spacing', () => {
    expect(ids(filterReports(REPORT_DIRECTORY, { search: '  AGEING  ' }))).toContain('stock-ageing')
  })

  it('returns nothing for a term no report answers to', () => {
    expect(filterReports(REPORT_DIRECTORY, { search: 'payroll' })).toHaveLength(0)
  })

  it('combines the category with the search', () => {
    const found = filterReports(REPORT_DIRECTORY, { search: 'stock', category: 'valuation-ledger' })
    expect(ids(found).every((id) => ['stock-ledger', 'stock-valuation'].includes(id))).toBe(true)
  })

  it('shows only starred reports when asked', () => {
    const found = filterReports(REPORT_DIRECTORY, {
      favouritesOnly: true,
      favourites: new Set(['near-expiry']),
    })
    expect(ids(found)).toEqual(['near-expiry'])
  })

  it('shows nothing when favourites are demanded and none are set', () => {
    expect(
      filterReports(REPORT_DIRECTORY, { favouritesOnly: true, favourites: new Set() }),
    ).toHaveLength(0)
  })
})

describe('report links', () => {
  it('leaves the route alone when no warehouse is chosen', () => {
    expect(reportLink(byId('warehouse-stock'), '')).toBe('/reports/warehouse-stock')
    expect(reportLink(byId('warehouse-stock'), null)).toBe('/reports/warehouse-stock')
  })

  it('hands the chosen warehouse to a report that has that filter', () => {
    expect(reportLink(byId('warehouse-stock'), '7')).toBe('/reports/warehouse-stock?warehouse_id=7')
  })

  it('never adds a filter a report does not declare', () => {
    const noWarehouse: ReportDirectoryEntry = { ...byId('warehouse-stock'), acceptsWarehouse: false }
    expect(reportLink(noWarehouse, '7')).toBe('/reports/warehouse-stock')
  })
})

describe('reading the category out of a URL', () => {
  it('accepts the three it knows', () => {
    expect(toCategory('ageing-expiry')).toBe('ageing-expiry')
  })

  it('falls back to all for anything else', () => {
    expect(toCategory('nonsense')).toBe('all')
    expect(toCategory(null)).toBe('all')
    expect(toCategory('')).toBe('all')
  })
})
