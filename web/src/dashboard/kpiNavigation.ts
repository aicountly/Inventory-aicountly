/**
 * Every number on the dashboard is a link, and every destination lives here.
 *
 * The rule this module exists to enforce: a card may only navigate somewhere
 * that reproduces the number it shows. So each builder below emits a URL whose
 * query string carries the *same* filters the figure was counted with —
 * `to`/`as_of` dates, the near-expiry window, the movement class, the warehouse.
 * Land on the register and the total at the top matches the card you clicked.
 *
 * Every parameter used here is one the destination screen actually reads:
 *   - `/reports/:path` — ReportPage keeps `sort`, `order`, `page`, `limit` plus
 *     one key per entry in the report's own `filters` array (src/reports/configs).
 *     Toggles are '1' / '0' (see resolveFilterValues).
 *   - list screens — the `FILTER_KEYS` constant at the top of each page.
 * Nothing here invents a filter the server or the screen would ignore.
 */

export type QueryValue = string | number | boolean | null | undefined

/** `?a=1&b=2`, dropping empties; booleans become 1/0 like the API expects. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    search.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

function path(base: string, params: Record<string, QueryValue>): string {
  return `${base}${buildQuery(params)}`
}

export interface AsOf {
  /** ISO date the figures were computed at. */
  asOf: string
}

export interface Period {
  from: string
  to: string
}

export const drill = {
  // ---- stock value ---------------------------------------------------------

  /** Closing value per item as at `asOf`, dearest first. */
  stockValue: ({ asOf }: AsOf): string =>
    path('/reports/stock-summary', { to: asOf, nonzero: 1, sort: 'closing_value', order: 'desc' }),

  /** Closing quantity per item as at `asOf`, largest first. */
  stockQty: ({ asOf }: AsOf): string =>
    path('/reports/stock-summary', { to: asOf, nonzero: 1, sort: 'closing_qty', order: 'desc' }),

  /** Every item carrying stock as at `asOf`. */
  itemsInStock: ({ asOf }: AsOf): string => path('/reports/stock-summary', { to: asOf, nonzero: 1 }),

  /**
   * Items below zero. There is no `negative=1` filter anywhere in the product,
   * so this sorts closing quantity ascending instead — the most negative item
   * is the first row, which is what the user came to see.
   */
  negativeStock: ({ asOf }: AsOf): string =>
    path('/reports/stock-summary', { to: asOf, nonzero: 1, sort: 'closing_qty', order: 'asc' }),

  /** One item's movements with running balance. */
  itemLedger: (itemId: number, period?: Partial<Period> & { warehouseId?: number | null }): string =>
    path('/stock/ledger', {
      item_id: itemId,
      from: period?.from,
      to: period?.to,
      warehouse_id: period?.warehouseId ?? undefined,
    }),

  /** Materialised balance grid, optionally for one warehouse. */
  stockBalances: (opts: { warehouseId?: number | null; itemId?: number | null } = {}): string =>
    path('/stock', { warehouse_id: opts.warehouseId ?? undefined, item_id: opts.itemId ?? undefined, nonzero: 1 }),

  // ---- warehouses ----------------------------------------------------------

  /** Closing value split by warehouse; `warehouseId` narrows to one. */
  warehouseStock: ({ asOf, warehouseId }: AsOf & { warehouseId?: number | null }): string =>
    path('/reports/warehouse-stock', { to: asOf, warehouse_id: warehouseId ?? undefined, nonzero: 1 }),

  // ---- ageing --------------------------------------------------------------

  /** Remaining cost layers by age bucket, oldest first. */
  stockAgeing: ({ asOf, warehouseId }: AsOf & { warehouseId?: number | null }): string =>
    path('/reports/stock-ageing', {
      as_of: asOf,
      warehouse_id: warehouseId ?? undefined,
      sort: 'oldest_days',
      order: 'desc',
    }),

  // ---- movement ------------------------------------------------------------

  /** Fast / slow / non-moving / dead items for the period; `cls` narrows. */
  movementAnalysis: ({ from, to, cls }: Period & { cls?: string | null }): string =>
    path('/reports/movement-analysis', { from, to, class: cls ?? undefined }),

  /** The append-only movement ledger. */
  stockMovements: (opts: { itemId?: number | null; documentId?: number | null; warehouseId?: number | null } = {}): string =>
    path('/stock/movements', {
      item_id: opts.itemId ?? undefined,
      document_id: opts.documentId ?? undefined,
      warehouse_id: opts.warehouseId ?? undefined,
    }),

  // ---- expiry --------------------------------------------------------------

  /** Batches expiring inside the window, soonest first. */
  nearExpiry: ({ days, includeExpired = false, itemId }: { days: number; includeExpired?: boolean; itemId?: number | null }): string =>
    path('/reports/near-expiry', {
      days,
      include_expired: includeExpired,
      item_id: itemId ?? undefined,
      // `days_to_expiry` is a computed column; the server's sort whitelist for
      // this report takes `expiry_date`, which is the same ordering.
      sort: 'expiry_date',
      order: 'asc',
    }),

  /** Already-expired batches lead the list when expired rows are included. */
  expiredBatches: ({ days }: { days: number }): string =>
    path('/reports/near-expiry', { days, include_expired: true, sort: 'expiry_date', order: 'asc' }),

  // ---- replenishment -------------------------------------------------------

  /** Items at or below their reorder point. */
  replenishment: (opts: { onlyTriggered?: boolean; itemId?: number | null; warehouseId?: number | null } = {}): string =>
    path('/reports/replenishment', {
      only_triggered: opts.onlyTriggered ?? true,
      item_id: opts.itemId ?? undefined,
      warehouse_id: opts.warehouseId ?? undefined,
    }),

  // ---- documents -----------------------------------------------------------

  /** The document register, optionally narrowed to one status or type. */
  documents: (opts: { status?: string | null; documentType?: string | null; from?: string; to?: string } = {}): string =>
    path('/documents', {
      status: opts.status ?? undefined,
      document_type: opts.documentType ?? undefined,
      from: opts.from,
      to: opts.to,
    }),

  document: (documentId: number): string => `/documents/${documentId}`,

  /** Open challans / deferred purchases / job work. */
  pendingQuantities: (kind?: string | null): string => path('/pending-quantities', { kind: kind ?? undefined }),

  // ---- integration + valuation --------------------------------------------

  outbox: (status?: string | null): string => path('/integration/outbox', { status: status ?? undefined }),

  /** Valuation revisions Books has not acknowledged yet. */
  revisions: (acknowledged: '0' | '1' | 'all' = '0'): string => path('/valuation/revisions', { acknowledged }),

  recalculations: (status?: string | null): string => path('/valuation/recalculations', { status: status ?? undefined }),

  reconciliationRun: (runId: number): string => `/reconciliation/${runId}`,

  reconciliationRuns: (): string => '/reconciliation',

  // ---- masters -------------------------------------------------------------

  /**
   * The item master. No status filter is offered here on purpose: ItemsListPage
   * keeps only `q` in the URL, so an `is_active=1` would be silently dropped and
   * the landing page would not match the card.
   */
  items: (opts: { q?: string } = {}): string => path('/items', { q: opts.q }),

  warehouses: (): string => '/masters/warehouses',

  batches: (): string => '/masters/batches',
} as const

export type DrillKey = keyof typeof drill
