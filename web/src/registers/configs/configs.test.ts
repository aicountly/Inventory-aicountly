import { describe, expect, it } from 'vitest'
import {
  NATIVE_REGISTERS,
  REGISTER_CONFIGS,
  REGISTER_GROUP_LABELS,
  REGISTER_GROUP_ORDER,
  registerByPath,
  registersInGroup,
} from './index'
import {
  registerColumnPrefsKey,
  registerPermission,
  registerRoute,
} from '../RegisterConfig'
import { pageHint, pageSummaryFor, withPageSummary } from './pageSummary'
import { REPORT_CONFIGS } from '../../reports/configs'
import type { ListResponse } from '../../services/api'

describe('register registry', () => {
  it('includes every report — a report is a valid register', () => {
    for (const report of REPORT_CONFIGS) {
      expect(REGISTER_CONFIGS, report.path).toContain(report)
    }
    expect(REGISTER_CONFIGS.length).toBe(NATIVE_REGISTERS.length + REPORT_CONFIGS.length)
  })

  it('routes are unique, so /registers/:path can never be ambiguous', () => {
    const routes = REGISTER_CONFIGS.map((c) => registerRoute(c))
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('column-preference keys are unique, so two registers cannot share a saved layout', () => {
    // Several registers deliberately share a *permission* slug (the movement
    // register and the stock ledger are both reports.stock_ledger.read), which
    // is why the preference key is separate and has to be checked.
    const keys = REGISTER_CONFIGS.map((c) => registerColumnPrefsKey(c))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('resolves by URL segment and rejects anything else', () => {
    expect(registerByPath('stock-ledger')?.title).toBe('Stock ledger')
    expect(registerByPath('movement-register')?.title).toBe('Movement register')
    expect(registerByPath('stock-summary')?.slug).toBe('stock_summary')
    expect(registerByPath('nope')).toBeUndefined()
    expect(registerByPath('')).toBeUndefined()
  })

  it('falls back to reports.<slug>.read for a register that names no permission', () => {
    expect(registerPermission({ slug: 'stock_summary' })).toBe('reports.stock_summary.read')
    expect(registerPermission({ slug: 'x', permission: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('places every register in a group the hub renders', () => {
    const grouped = REGISTER_GROUP_ORDER.flatMap((g) => registersInGroup(g))
    expect(grouped.length).toBe(REGISTER_CONFIGS.length)
    for (const group of REGISTER_GROUP_ORDER) {
      expect(REGISTER_GROUP_LABELS[group]).toBeTruthy()
    }
  })
})

describe('every register is internally consistent', () => {
  for (const config of REGISTER_CONFIGS) {
    describe(config.path, () => {
      it('has unique column keys', () => {
        const keys = config.columns.map((c) => c.key)
        expect(new Set(keys).size).toBe(keys.length)
      })

      it('has unique filter keys and a default sort', () => {
        const keys = config.filters.map((f) => f.key)
        expect(new Set(keys).size).toBe(keys.length)
        expect(config.defaultSort).toBeTruthy()
      })

      it('keeps at least one column that cannot be hidden', () => {
        // A register whose every column can be switched off can be configured
        // into an empty grid.
        expect(config.columns.some((c) => c.alwaysVisible === true || c.defaultVisible !== false)).toBe(true)
      })

      it('only sorts on columns the API is told about', () => {
        for (const col of config.columns) {
          if (col.sortKey !== undefined) expect(typeof col.sortKey).toBe('string')
        }
      })

      it('declares every URL key its filters write', () => {
        for (const filter of config.filters) {
          if (filter.kind !== 'date_range') continue
          const toKey = filter.toKey ?? 'to'
          expect(
            config.filters.some((f) => f.key === toKey),
            `${config.path} must declare ${toKey} as its own filter`,
          ).toBe(true)
        }
      })
    })
  }
})

/**
 * The footer has to line up with the header.
 *
 * `buildTotalsRow` is given the column list by each config, and a typo there
 * would put a figure under the wrong heading — the one bug in a register that
 * nobody spots and everybody trusts. These fixtures run each `totals` builder
 * and check its keys are column keys the register actually renders.
 */
describe('totals rows only name columns the register has', () => {
  const summaries: Record<string, unknown> = {
    'stock-ledger': {
      opening_qty: 10,
      opening_value: 100,
      in_qty: 5,
      out_qty: 2,
      in_value: 50,
      out_value: 20,
      closing_qty: 13,
      closing_value: 130,
      from: '2026-04-01',
      to: '2026-09-14',
      warehouse_id: null,
    },
    'movement-register': { total: 9, pageRows: 9, sums: { qty: 3, value: 30 }, isWholeResult: true },
    'stock-balances': {
      total: 4,
      pageRows: 4,
      sums: {
        on_hand_qty: 1,
        reserved_qty: 1,
        committed_qty: 1,
        packed_qty: 1,
        in_transit_qty: 1,
        job_worker_qty: 1,
        quality_hold_qty: 1,
        damaged_qty: 1,
        blocked_qty: 1,
        expected_qty: 1,
        available_qty: 1,
      },
      isWholeResult: false,
    },
    valuation: { as_of: '2026-09-14', method: 'FIFO', total_qty: 7, total_value: 70, item_count: 3 },
    reservations: {
      total: 2,
      pageRows: 2,
      sums: { qty: 5, fulfilled_qty: 1, open_qty: 4 },
      isWholeResult: true,
    },
    'pending-quantities': {
      total: 2,
      pageRows: 2,
      sums: { qty_original: 5, qty_settled: 1, qty_open: 4 },
      isWholeResult: true,
      qtyOpenAll: 9,
    },
    'stock-summary': {
      items: 3,
      opening_qty: 1,
      in_qty: 2,
      out_qty: 1,
      closing_qty: 2,
      closing_value: 20,
      from: null,
      to: '2026-09-14',
    },
    'warehouse-stock': { rows: 3, closing_qty: 2, closing_value: 20, by_warehouse: [], to: '2026-09-14' },
    'batch-stock': { batches: 2, items: 2, on_hand: 5, reserved: 1 },
    'near-expiry': {
      as_of: '2026-09-14',
      days: 30,
      until: '2026-10-14',
      include_expired: true,
      batches: 2,
      items: 2,
      on_hand: 5,
      expired_batches: 1,
      expired_qty: 2,
    },
    'stock-ageing': {
      items: 3,
      total_qty: 9,
      total_value: 90,
      buckets: {
        '0_30': { qty: 1, value: 10 },
        '31_60': { qty: 2, value: 20 },
        '61_90': { qty: 2, value: 20 },
        '91_180': { qty: 2, value: 20 },
        '180_plus': { qty: 2, value: 20 },
      },
      bucket_labels: {},
      as_of: '2026-09-14',
    },
  }

  for (const config of REGISTER_CONFIGS) {
    if (!config.totals) continue
    const summary = summaries[config.path]
    it(`${config.path} footer lines up with its header`, () => {
      expect(summary, `add a fixture for ${config.path}`).toBeDefined()
      const totals = config.totals!(summary, [])
      const columnKeys = new Set(config.columns.map((c) => c.key))
      for (const key of Object.keys(totals)) {
        expect(columnKeys.has(key), `${config.path}: totals names "${key}", which is not a column`).toBe(true)
      }
      // A footer that is entirely blank is a footer nobody needed.
      expect(Object.values(totals).some((v) => v !== '')).toBe(true)
    })
  }
})

describe('drill-through targets', () => {
  it('every drillTo returns an absolute in-app path or null', () => {
    const row = {
      item_id: 12,
      warehouse_id: 3,
      document_id: 44,
      batch_id: 5,
      run_id: 7,
      received_document_id: 88,
      default_warehouse_id: 2,
    }
    for (const config of REGISTER_CONFIGS) {
      if (!config.drillTo) continue
      const target = config.drillTo(row)
      expect(target === null || target.startsWith('/'), `${config.path}: ${target}`).toBe(true)
    }
  })

  it('returns null rather than a broken link when the row has nothing to open', () => {
    const empty = { item_id: 0, document_id: null, warehouse_id: null, received_document_id: null }
    const ledger = registerByPath('stock-ledger')!
    const movement = registerByPath('movement-register')!
    expect(ledger.drillTo!(empty)).toBeNull()
    expect(movement.drillTo!(empty)).toBeNull()
  })

  it('carries the row’s own filters into the ledger it opens', () => {
    const balances = registerByPath('stock-balances')!
    expect(balances.drillTo!({ item_id: 12, warehouse_id: 3 })).toBe(
      '/registers/stock-ledger?item_id=12&warehouse_id=3',
    )
    expect(balances.drillTo!({ item_id: 12, warehouse_id: null })).toBe(
      '/registers/stock-ledger?item_id=12',
    )
  })
})

describe('the stock ledger refuses to run unfiltered', () => {
  it('requires an item, because "every item ever" is not a ledger', () => {
    const ledger = registerByPath('stock-ledger')!
    expect(ledger.requireFilters).toEqual(['item_id'])
    expect(ledger.requireFiltersMessage).toBeTruthy()
  })
})

describe('page summaries', () => {
  function response<T>(data: T[], total: number): ListResponse<T> {
    return { data, meta: { total, limit: 25, offset: 0 } }
  }

  it('sums the rows it was served and reports the filtered total separately', () => {
    const s = pageSummaryFor(response([{ qty: 2 }, { qty: 3 }], 100), ['qty'])
    expect(s.sums.qty).toBe(5)
    expect(s.total).toBe(100)
    expect(s.pageRows).toBe(2)
    expect(s.isWholeResult).toBe(false)
  })

  it('knows when the page is the whole result, and says so', () => {
    const s = pageSummaryFor(response([{ qty: 2 }], 1), ['qty'])
    expect(s.isWholeResult).toBe(true)
    expect(pageHint(s)).toBe('all rows')
    expect(pageHint({ ...s, isWholeResult: false })).toBe('this page only')
  })

  it('wraps a plain list response into the engine envelope', () => {
    const wrapped = withPageSummary(response([{ qty: 4 }], 1), 'demo', ['qty'])
    expect(wrapped.report).toBe('demo')
    expect(wrapped.data).toHaveLength(1)
    expect(wrapped.meta.total).toBe(1)
    expect(wrapped.summary.sums.qty).toBe(4)
  })
})
