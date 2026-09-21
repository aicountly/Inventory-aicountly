import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, History, Warehouse } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { P } from '../../../services/access'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { Skeleton } from '../../../ui/Skeleton'
import { SmartTable } from '../../../ui/shell/SmartTable'
import { useCompany } from '../../../company/CompanyContext'
import { useFormOptions } from '../../../hooks/useFormOptions'
import { useQuery } from '../../../hooks/useQuery'
import { itemsApi } from '../../../services/items'
import type { ItemListRow } from '../../../services/items'
import { stockLedgerApi } from '../../../services/stockViewsApi'
import type { LedgerRow } from '../../../services/stockViewsApi'
import { formatDate, formatMoney, formatQty } from '../../../utils/format'

/** How many movements the drawer shows before sending the reader to the ledger. */
const RECENT = 12

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * Where the quantity physically is, and which of it can actually be used.
 *
 * Straight from `/v1/items/{id}/stock`, which reads inv_stock_balances — the
 * warehouse split, the reserved / packed / damaged buckets and the costed unit
 * rate are all the API's answers. Nothing here is summed, netted or costed in
 * the browser: available is `StockBalanceService::availableFrom()`, and the
 * unit cost is whatever the valuation engine replayed under the item's own
 * method.
 */
export function ItemStockTab({ item }: { item: ItemListRow }) {
  const { scope } = useCompany()
  /*
   * The availability rows carry warehouse IDs, not names.
   *
   * The names are already in the cached form options this page loaded for its
   * filters, so resolving them here costs nothing and spares the reader a table
   * of "Warehouse #4" — a number that means nothing to the person who has to
   * walk to the shelf. The id is the fallback, never the first choice.
   */
  const { options } = useFormOptions()
  const warehouseName = useMemo(() => {
    const byId = new Map((options?.warehouses ?? []).map((w) => [w.warehouse_id, w.warehouse_name]))
    return (id: number | null) => (id === null ? 'Unassigned' : (byId.get(id) ?? `Warehouse #${id}`))
  }, [options])
  const query = useQuery(
    (signal) => itemsApi.stock(item.item_id, signal),
    [item.item_id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: Boolean(scope), resetKey: `${scope?.cmp_id}:${item.item_id}` },
  )

  if (query.loading && !query.data) return <TabSkeleton />
  if (query.error) {
    return <ErrorState size="sm" title="Stock could not be loaded" description={query.error.message} onRetry={query.reload} />
  }
  const data = query.data
  if (!data) return null

  const buckets: [string, number][] = [
    ['On hand', data.total.on_hand],
    ['Available', data.total.available],
    ['Reserved', data.total.reserved],
    ['Committed', data.total.committed],
    ['Packed', data.total.packed],
    ['In transit', data.total.in_transit],
    ['With job worker', data.total.job_worker],
    ['Quality hold', data.total.quality_hold],
    ['Damaged', data.total.damaged],
    ['Blocked', data.total.blocked],
    ['Expected in', data.total.expected],
  ]
  // A bucket at zero on every item is noise; the four that always matter stay.
  const shown = buckets.filter(([label, value]) => value !== 0 || ['On hand', 'Available', 'Reserved', 'Committed'].includes(label))

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Quantities</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0">
          {shown.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-gray-100 py-2">
              <dt className="text-xs text-gray-500">{label}</dt>
              <dd className={`text-xs font-semibold tabular-nums ${value < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatQty(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Reorder policy</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0">
          {[
            ['Minimum', item.min_stock_qty],
            ['Maximum', item.max_stock_qty],
            ['Reorder point', item.reorder_point_qty],
            ['Reorder quantity', item.reorder_qty],
          ].map(([label, value]) => (
            <div key={label as string} className="flex items-center justify-between border-b border-gray-100 py-2">
              <dt className="text-xs text-gray-500">{label}</dt>
              <dd className="text-xs font-semibold tabular-nums text-gray-900">{formatQty(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">By warehouse</h3>
          {data.unit_cost !== null ? (
            <span className="text-[11px] text-gray-500">
              Unit cost {formatMoney(data.unit_cost)}
              {data.valuation_method ? ` · ${data.valuation_method}` : ''}
            </span>
          ) : null}
        </div>
        {data.by_warehouse.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Warehouse}
            title="No stock in any warehouse"
            description="Nothing has been received against this item yet."
          />
        ) : (
          <SmartTable
            columns={[
              { key: 'warehouse', header: 'Warehouse', render: (r) => warehouseName(r.warehouse_id) },
              { key: 'on_hand', header: 'On hand', align: 'right', render: (r) => formatQty(r.on_hand) },
              { key: 'available', header: 'Available', align: 'right', render: (r) => formatQty(r.available) },
              { key: 'reserved', header: 'Reserved', align: 'right', render: (r) => formatQty(r.reserved) },
            ]}
            rows={data.by_warehouse}
            rowKey={(r) => `${r.warehouse_id ?? 'none'}`}
            size="xs"
            minWidth={320}
          />
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * What has actually moved, newest first, with the running balance the ledger
 * itself computed.
 *
 * `/v1/reports/stock-ledger` is the same endpoint the full Stock ledger screen
 * reads, so the twelve lines here and the report they link to cannot tell
 * different stories.
 */
export function ItemTransactionsTab({ item }: { item: ItemListRow }) {
  const { scope } = useCompany()
  const { can } = useAccess()
  const query = useQuery(
    (signal) => stockLedgerApi.get({ item_id: item.item_id, limit: RECENT, sort: 'movement_date', order: 'desc' }, signal),
    [item.item_id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: Boolean(scope), resetKey: `${scope?.cmp_id}:${scope?.fy_id}:${item.item_id}` },
  )

  if (query.loading && !query.data) return <TabSkeleton />
  if (query.error) {
    return <ErrorState size="sm" title="Movements could not be loaded" description={query.error.message} onRetry={query.reload} />
  }
  const rows = query.data?.data ?? []

  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={History}
        title="No movements yet"
        description="Nothing has been received, issued or transferred against this item in the current financial year."
      />
    )
  }

  return (
    <div className="space-y-3">
      <SmartTable<LedgerRow>
        columns={[
          { key: 'movement_date', header: 'Date', render: (r) => formatDate(r.movement_date) },
          {
            key: 'document',
            header: 'Document',
            render: (r) => (
              <span className="block max-w-[10rem] truncate">
                <span className="font-medium text-gray-900">{r.document_no ?? r.document_type_label ?? '—'}</span>
                {r.warehouse_name ? <span className="block text-[10px] text-gray-500">{r.warehouse_name}</span> : null}
              </span>
            ),
          },
          {
            key: 'qty',
            header: 'Qty',
            align: 'right',
            render: (r) => (
              <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${r.qty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {r.qty < 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownLeft className="h-3 w-3" aria-hidden />}
                {formatQty(Math.abs(r.qty))}
              </span>
            ),
          },
          { key: 'balance_qty', header: 'Balance', align: 'right', render: (r) => formatQty(r.balance_qty) },
        ]}
        rows={rows}
        rowKey="movement_id"
        size="xs"
        minWidth={340}
      />
      {/* The register, not the legacy redirect, and only for a reader allowed to open it. */}
      {can(P.report('stock_ledger')) ? (
        <Link
          to={`/registers/stock-ledger?item_id=${item.item_id}`}
          className="inline-flex text-xs font-semibold text-primary hover:underline"
        >
          Open the full stock ledger →
        </Link>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * The movement figures for the current financial year, as the ledger summarised
 * them: opening, in, out, closing, and how long it has been since anything
 * moved.
 *
 * Deliberately NOT a chart. The ledger endpoint returns a period summary, not a
 * time series, so a trend line here would be drawn from twelve rows of one page
 * and would change shape when the page size did. Turnover and days-of-cover are
 * absent for the same reason — they need an average-inventory series this API
 * does not expose, and a plausible-looking number nobody can reproduce is worse
 * than an honest gap.
 */
export function ItemAnalyticsTab({ item }: { item: ItemListRow }) {
  const { scope } = useCompany()
  const query = useQuery(
    (signal) => stockLedgerApi.get({ item_id: item.item_id, limit: 1, sort: 'movement_date', order: 'desc' }, signal),
    [item.item_id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    { enabled: Boolean(scope), resetKey: `${scope?.cmp_id}:${scope?.fy_id}:${item.item_id}` },
  )

  const lastMovedDays = useMemo(() => {
    const last = query.data?.data[0]?.movement_date
    if (!last) return null
    const then = new Date(last).getTime()
    if (Number.isNaN(then)) return null
    return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
  }, [query.data])

  if (query.loading && !query.data) return <TabSkeleton />
  if (query.error) {
    return <ErrorState size="sm" title="Analysis could not be loaded" description={query.error.message} onRetry={query.reload} />
  }

  const s = query.data?.summary
  if (!s || (s.in_qty === 0 && s.out_qty === 0 && s.opening_qty === 0)) {
    return (
      <EmptyState
        size="sm"
        icon={History}
        title="Nothing to analyse yet"
        description="Movement figures appear once this item has been received or issued in the current financial year."
      />
    )
  }

  const net = s.closing_qty - s.opening_qty

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          This financial year
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Opening', value: formatQty(s.opening_qty), tone: 'text-gray-900' },
            { label: 'Received', value: formatQty(s.in_qty), tone: 'text-emerald-600' },
            { label: 'Issued', value: formatQty(s.out_qty), tone: 'text-red-600' },
            { label: 'Closing', value: formatQty(s.closing_qty), tone: s.closing_qty < 0 ? 'text-red-600' : 'text-gray-900' },
          ].map((cell) => (
            <div key={cell.label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{cell.label}</p>
              <p className={`text-base font-semibold tabular-nums ${cell.tone}`}>{cell.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Movement</h3>
        <dl className="text-xs">
          <div className="flex items-center justify-between border-b border-gray-100 py-2">
            <dt className="text-gray-500">Net change</dt>
            <dd className={`font-semibold tabular-nums ${net < 0 ? 'text-red-600' : net > 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
              {net > 0 ? '+' : ''}
              {formatQty(net)}
            </dd>
          </div>
          <div className="flex items-center justify-between border-b border-gray-100 py-2">
            <dt className="text-gray-500">Last movement</dt>
            <dd className="font-semibold text-gray-900">
              {lastMovedDays === null
                ? '—'
                : lastMovedDays === 0
                  ? 'Today'
                  : `${lastMovedDays} ${lastMovedDays === 1 ? 'day' : 'days'} ago`}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2">
            <dt className="text-gray-500">Closing value</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{formatMoney(s.closing_value)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
          {/* The method is an acronym the API already sends upper-case — humanize()
              would turn FIFO into "Fifo". */}
          Valued by the posting engine under {item.valuation_method}. Inventory never costs stock in
          the browser.
        </p>
      </section>
    </div>
  )
}

function TabSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
