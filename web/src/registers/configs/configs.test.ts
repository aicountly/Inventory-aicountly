import { readFileSync } from 'node:fs'
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

  it('declares its own period where the server does not scope by financial year', () => {
    // PendingQuantityService::listOpen is deliberately not FY-scoped (an open
    // challan crosses the year boundary and ITC-04 counts it) and
    // inv_stock_balances has no fy_id column. Without this the scope line —
    // the only record on the printed sheet of what was asked for — stamps the
    // selected FY over rows drawn from every year.
    expect(registerByPath('pending-quantities')?.scopePeriod).toBe('All financial years')
    expect(registerByPath('stock-balances')?.scopePeriod).toBe(
      'Live balances, all financial years',
    )
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

      it('only declares sort keys that are strings', () => {
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

/** One server summary per register, shared by the totals and KPI checks below. */
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

/**
 * The footer has to line up with the header.
 *
 * `buildTotalsRow` is given the column list by each config, and a typo there
 * would put a figure under the wrong heading — the one bug in a register that
 * nobody spots and everybody trusts. These fixtures run each `totals` builder
 * and check its keys are column keys the register actually renders.
 */
describe('totals rows only name columns the register has', () => {

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

/**
 * A sort header the endpoint cannot honour is the worst kind of broken: the
 * arrow moves, the same rows come back, and the reader believes the top row is
 * now the largest. The check therefore reads the *server's* own whitelist —
 * the PHP constant the endpoint orders by — rather than a list copied into the
 * test, which would drift the moment the endpoint changed.
 */
describe('sort headers match what the endpoint can order by', () => {
  const SERVER = '../../../../server-php/app/'

  /** Keys of a `const NAME = [...]` — both `'k' => 'col'` maps and plain lists. */
  function phpSortable(file: string, constName: string): Set<string> {
    const php = readFileSync(new URL(SERVER + file, import.meta.url).pathname, 'utf8')
    const start = php.indexOf(`const ${constName} = [`)
    expect(start, `${file} no longer declares ${constName}`).toBeGreaterThan(-1)
    const body = php.slice(start + `const ${constName} = [`.length, php.indexOf('];', start))
    const keys = body.includes('=>')
      ? [...body.matchAll(/'([^']+)'\s*=>/g)].map((m) => m[1])
      : [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(keys.length, `${constName} parsed empty`).toBeGreaterThan(0)
    return new Set(keys)
  }

  const ENDPOINTS: Record<string, [string, string]> = {
    'stock-ledger': ['Controllers/Api/V1/ReportsController.php', 'STOCK_LEDGER_SORTABLE'],
    'movement-register': ['Controllers/Api/V1/StockMovementsController.php', 'SORTABLE'],
    'stock-balances': ['Services/StockBalanceService.php', 'SORTABLE'],
    valuation: ['Controllers/Api/V1/ValuationController.php', 'SNAPSHOT_SORTABLE'],
    reservations: ['Controllers/Api/V1/ReservationsController.php', 'SORTABLE'],
    'pending-quantities': ['Services/PendingQuantityService.php', 'SORTABLE'],
    'reconciliation-runs': ['Controllers/Api/V1/ReconciliationController.php', 'SORTABLE'],
  }

  it('covers every native register', () => {
    expect(Object.keys(ENDPOINTS).sort()).toEqual(NATIVE_REGISTERS.map((c) => c.path).sort())
  })

  for (const config of NATIVE_REGISTERS) {
    const [file, constName] = ENDPOINTS[config.path]
    it(`${config.path} offers no header its endpoint would ignore`, () => {
      const sortable = phpSortable(file, constName)
      for (const col of config.columns) {
        if (col.sortKey === undefined) continue
        expect(sortable.has(col.sortKey), `${config.path}: "${col.key}" sorts by ${col.sortKey}, which ${constName} has no entry for`).toBe(true)
      }
      expect(sortable.has(config.defaultSort ?? ''), `${config.path}: defaultSort ${config.defaultSort} is not sortable`).toBe(true)
    })
  }
})

/**
 * A KPI card that navigates is only worth having if it lands somewhere showing
 * the rows behind the figure — and only if the destination reads the filters it
 * is handed. Both halves are checked here: the path must be a real register,
 * and every query key must be one that register declares.
 */
/**
 * Grouping is a view of the rows on screen, so its subtotals have to line up
 * with the header the same way the pinned footer does — and they have to say
 * they are page figures, because the footer beneath them is not.
 */
describe('in-table grouping', () => {
  const MOVEMENTS = [
    { movement_id: 1, document_type: 'GRN', document_type_label: 'Goods receipt', warehouse_id: 3, warehouse_name: 'Main', qty: 4, value: 400 },
    { movement_id: 2, document_type: 'GRN', document_type_label: 'Goods receipt', warehouse_id: 3, warehouse_name: 'Main', qty: 6, value: 600 },
    { movement_id: 3, document_type: 'ISSUE', document_type_label: 'Issue', warehouse_id: null, warehouse_name: null, qty: -2, value: -200 },
  ]

  it('groups the movement register by document type and by warehouse', () => {
    const movement = registerByPath('movement-register')!
    expect(movement.groupBy?.map((g) => g.key)).toEqual(['document_type', 'warehouse'])
    const byType = movement.groupBy![0]
    expect(MOVEMENTS.map((r) => byType.of(r).key)).toEqual(['GRN', 'GRN', 'ISSUE'])
    expect(byType.of(MOVEMENTS[0]).label).toBe('Goods receipt')
    // A row with no warehouse still belongs to a group, never to undefined.
    expect(movement.groupBy![1].of(MOVEMENTS[2])).toEqual({ key: '0', label: 'No warehouse' })
  })

  it('subtotals the group it was handed, and says it is a page figure', () => {
    const byType = registerByPath('movement-register')!.groupBy![0]
    const cells = byType.subtotal!(MOVEMENTS.slice(0, 2), byType.of(MOVEMENTS[0]))
    expect(cells.qty).toBe('10')
    expect(String(cells.movement_date)).toContain('Goods receipt')
    expect(String(cells.movement_date)).toContain('on this page')
  })

  it('never names a column the register does not render', () => {
    for (const config of REGISTER_CONFIGS) {
      for (const grouping of config.groupBy ?? []) {
        if (!grouping.subtotal) continue
        const columnKeys = new Set(config.columns.map((c) => c.key))
        const cells = grouping.subtotal([], { key: 'x', label: 'X' })
        for (const key of Object.keys(cells)) {
          expect(columnKeys.has(key), `${config.path}: group subtotal names "${key}"`).toBe(true)
        }
      }
    }
  })

  it('groups the stock balance register by warehouse', () => {
    const balances = registerByPath('stock-balances')!
    expect(balances.groupBy?.map((g) => g.key)).toEqual(['warehouse'])
  })
})

describe('KPI drill-downs', () => {
  const SUMMARIES: Record<string, unknown> = {
    'stock-ledger': {
      opening_qty: 1,
      opening_value: 1,
      in_qty: 5,
      out_qty: 2,
      in_value: 50,
      out_value: 20,
      closing_qty: 4,
      closing_value: 40,
      from: '2026-04-01',
      to: '2026-09-14',
      warehouse_id: 3,
    },
  }

  function destinations(config: (typeof REGISTER_CONFIGS)[number], summary: unknown, response: unknown): string[] {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const cards = config.kpis!(summary as any, response as any)
    return cards.map((c) => c.to).filter((to): to is string => typeof to === 'string')
  }

  function assertResolvable(to: string) {
    const [path, query = ''] = to.split('?')
    const registerPath = path.replace(/^\/registers\//, '').replace(/^\/reports\//, '')
    const target = REGISTER_CONFIGS.find((c) => (c.routePath ?? c.path) === registerPath)
    expect(target, `${to} points at no register`).toBeTruthy()
    const allowed = new Set(['sort', 'order', 'page', 'limit', ...target!.filters.map((f) => f.key)])
    for (const key of new URLSearchParams(query).keys()) {
      expect(allowed.has(key), `${to}: ${registerPath} would ignore ?${key}`).toBe(true)
    }
  }

  it('the stock ledger opens the movements behind In and Out', () => {
    const ledger = registerByPath('stock-ledger')!
    const links = destinations(ledger, SUMMARIES['stock-ledger'], { item: { item_id: 12 } })
    expect(links).toEqual([
      '/registers/movement-register?item_id=12&direction=in&warehouse_id=3&from=2026-04-01&to=2026-09-14',
      '/registers/movement-register?item_id=12&direction=out&warehouse_id=3&from=2026-04-01&to=2026-09-14',
    ])
    links.forEach(assertResolvable)
  })

  it('offers no link at all when the ledger has no item to open', () => {
    const ledger = registerByPath('stock-ledger')!
    expect(destinations(ledger, SUMMARIES['stock-ledger'], {})).toEqual([])
  })

  it('never links a card to a filter its destination would ignore', () => {
    for (const config of REGISTER_CONFIGS) {
      if (!config.kpis) continue
      const summary = SUMMARIES[config.path] ?? summaries[config.path]
      if (summary === undefined) continue
      for (const to of destinations(config, summary, { data: [], meta: { total: 0, limit: 25, offset: 0 }, summary })) {
        assertResolvable(to)
      }
    }
  })

  it('does not hand a card a filter that is already on — a click has to do something', () => {
    const replenishment = registerByPath('replenishment')!
    const to = replenishment.kpis!(
      { triggered_total: 4, page_suggested_qty: 1, page_suggested_value: 1 } as never,
      {} as never,
    )[0].to!
    const params = new URLSearchParams(to.split('?')[1])
    const defaults = new Set(
      replenishment.filters.filter((f) => f.kind === 'toggle' && f.defaultOn).map((f) => f.key),
    )
    const changes = [...params.keys()].filter((k) => !defaults.has(k))
    expect(changes.length, `${to} only re-applies filters that are already on`).toBeGreaterThan(0)
    assertResolvable(to)
  })
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
