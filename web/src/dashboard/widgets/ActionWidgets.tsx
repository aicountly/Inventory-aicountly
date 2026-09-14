import { ArrowDownLeft, ArrowUpRight, CalendarClock, ShoppingCart, Waypoints } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { SkeletonRows } from '../../ui/Skeleton'
import { formatDate, formatQty, humanize } from '../../utils/format'
import { MiniTable } from '../components/MiniTable'
import type { MiniColumn } from '../components/MiniTable'
import { WidgetCard } from '../components/WidgetCard'
import type { WidgetState } from '../components/WidgetCard'
import { formatCount, formatCurrencyCompact, plural } from '../formatters'
import { drill } from '../kpiNavigation'
import type { ExpirySnapshot, ReplenishmentSnapshot } from '../dashboardApi'
import type { NearExpiryRow, ReplenishmentRow } from '../../services/reportsApi'
import type { StockMovementRow } from '../../services/stockViewsApi'

interface Loadable<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

/**
 * A widget is "loading" until it has either data or an error — not merely while
 * a request is in flight. Before the company scope and the permission list
 * resolve, useQuery has not started yet and reports `loading: false` with no
 * data; keying off that would flash an empty card body on first paint and then
 * swap in the skeleton. Keying off the absence of a result never does.
 */
function state<T>(q: Loadable<T>, empty: boolean): WidgetState {
  return {
    loading: q.data === null && q.error === null,
    error: q.error,
    empty: q.data !== null && empty,
    reload: q.reload,
  }
}

// ---------------------------------------------------------------------------
// What to reorder
// ---------------------------------------------------------------------------

const REORDER_COLUMNS: MiniColumn<ReplenishmentRow>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (r) => (
      <span className="block min-w-0">
        <span className="block font-medium text-gray-800 truncate max-w-[12rem]" title={r.item_name ?? ''}>
          {r.item_name ?? `Item ${r.item_id}`}
        </span>
        <span className="block text-label-xs text-gray-400 truncate">
          {r.reasons?.length ? r.reasons.map((x) => humanize(x)).join(' · ') : r.item_sku ?? ''}
        </span>
      </span>
    ),
  },
  {
    key: 'projected',
    header: 'Projected',
    align: 'right',
    render: (r) => (
      <span className={r.projected <= 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}>{formatQty(r.projected)}</span>
    ),
  },
  {
    key: 'reorder_point_qty',
    header: 'Reorder at',
    align: 'right',
    render: (r) => <span className="text-gray-500">{formatQty(r.reorder_point_qty)}</span>,
  },
  {
    key: 'suggested_qty',
    header: 'Order',
    align: 'right',
    render: (r) => (
      <span className="font-semibold text-gray-900">
        {formatQty(r.suggested_qty)}
        {r.unit_symbol ? <span className="text-gray-400 font-normal"> {r.unit_symbol}</span> : null}
      </span>
    ),
  },
]

export function ReorderWidget({ query }: { query: Loadable<ReplenishmentSnapshot> }) {
  const snapshot = query.data
  const rows = snapshot?.rows ?? []
  const triggered = snapshot?.summary.triggered_total ?? 0

  return (
    <WidgetCard
      title="To reorder"
      description="Items at or below their reorder point"
      icon={ShoppingCart}
      tone="warning"
      viewAll={{ to: drill.replenishment({ onlyTriggered: true }) }}
      state={state(query, rows.length === 0)}
      skeleton={<SkeletonRows rows={6} />}
      emptyIcon={ShoppingCart}
      emptyTitle="Nothing needs reordering"
      emptyDescription="No item with a reorder point, safety stock or minimum is below it right now."
      footer={
        snapshot ? (
          <div className="flex items-center justify-between gap-2">
            <span>{plural(triggered, 'item')} triggered</span>
            {snapshot.summary.page_suggested_value > 0 ? (
              <span className="text-gray-400">
                these {rows.length}: ~{formatCurrencyCompact(snapshot.summary.page_suggested_value)}
              </span>
            ) : null}
          </div>
        ) : null
      }
    >
      <MiniTable
        columns={REORDER_COLUMNS}
        rows={rows}
        rowKey={(r) => r.item_id}
        to={(r) => drill.replenishment({ itemId: r.item_id, onlyTriggered: false })}
        rowClassName={(r) => (r.projected < 0 ? 'bg-red-50/40' : undefined)}
      />
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// What is about to expire
// ---------------------------------------------------------------------------

function expiryTone(days: number, expired: boolean): BadgeTone {
  if (expired) return 'danger'
  if (days <= 7) return 'danger'
  if (days <= 30) return 'warning'
  return 'info'
}

const EXPIRY_COLUMNS: MiniColumn<NearExpiryRow>[] = [
  {
    key: 'item',
    header: 'Item / batch',
    render: (r) => (
      <span className="block min-w-0">
        <span className="block font-medium text-gray-800 truncate max-w-[12rem]" title={r.item_name ?? ''}>
          {r.item_name ?? `Item ${r.item_id}`}
        </span>
        <span className="block text-label-xs text-gray-400 truncate">
          {r.batch_no ?? `Batch ${r.batch_id}`}
          {r.warehouse_name ? ` · ${r.warehouse_name}` : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'expiry_date',
    header: 'Expires',
    align: 'right',
    render: (r) => <span className="text-gray-600 whitespace-nowrap">{formatDate(r.expiry_date)}</span>,
  },
  {
    key: 'days',
    header: 'In',
    align: 'right',
    render: (r) => (
      <Badge tone={expiryTone(r.days_to_expiry, r.is_expired)} size="xs">
        {r.is_expired ? 'Expired' : `${formatCount(r.days_to_expiry)}d`}
      </Badge>
    ),
  },
  {
    key: 'on_hand',
    header: 'On hand',
    align: 'right',
    render: (r) => <span className="font-semibold text-gray-900">{formatQty(r.on_hand)}</span>,
  },
]

export function ExpiryWidget({ query, days }: { query: Loadable<ExpirySnapshot>; days: number }) {
  const snapshot = query.data
  const rows = snapshot?.rows ?? []

  return (
    <WidgetCard
      title="Expiring and expired"
      description={`Batches with stock, within ${days} days`}
      icon={CalendarClock}
      tone="danger"
      viewAll={{ to: drill.nearExpiry({ days, includeExpired: true }) }}
      state={state(query, rows.length === 0)}
      skeleton={<SkeletonRows rows={6} />}
      emptyIcon={CalendarClock}
      emptyTitle="Nothing expiring"
      emptyDescription={`No batch holding stock expires in the next ${days} days.`}
      footer={
        snapshot ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              {plural(snapshot.expiringSoon, 'batch', 'batches')} expiring
              {snapshot.expired > 0 ? (
                <>
                  {' · '}
                  <span className="font-semibold text-rose-600">{formatCount(snapshot.expired)} already expired</span>
                </>
              ) : null}
            </span>
            <span className="text-gray-400">{formatQty(snapshot.summary.on_hand)} units</span>
          </div>
        ) : null
      }
    >
      <MiniTable
        columns={EXPIRY_COLUMNS}
        rows={rows}
        rowKey={(r) => r.batch_id}
        to={(r) => drill.nearExpiry({ days, includeExpired: true, itemId: r.item_id })}
        rowClassName={(r) => (r.is_expired ? 'bg-red-50/40' : undefined)}
      />
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// What just happened
// ---------------------------------------------------------------------------

const MOVEMENT_COLUMNS: MiniColumn<StockMovementRow>[] = [
  {
    key: 'when',
    header: 'Date',
    render: (r) => (
      <span className="block min-w-0">
        <span className="block text-gray-700 whitespace-nowrap">{formatDate(r.movement_date)}</span>
        <span className="block text-label-xs text-gray-400 truncate">
          {r.document_type_label ?? humanize(r.document_type)}
        </span>
      </span>
    ),
  },
  {
    key: 'item',
    header: 'Item',
    render: (r) => (
      <span className="block font-medium text-gray-800 truncate max-w-[11rem]" title={r.item_name ?? ''}>
        {r.item_name ?? `Item ${r.item_id}`}
      </span>
    ),
  },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    render: (r) => {
      const out = r.qty < 0
      return (
        <span className={`inline-flex items-center gap-0.5 font-semibold ${out ? 'text-rose-600' : 'text-emerald-600'}`}>
          {out ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
          {formatQty(Math.abs(r.qty))}
        </span>
      )
    },
  },
  {
    key: 'value',
    header: 'Value',
    align: 'right',
    render: (r) => <span className="text-gray-600">{formatCurrencyCompact(Math.abs(r.value ?? 0))}</span>,
  },
]

export function RecentMovementsWidget({ query }: { query: Loadable<StockMovementRow[]> }) {
  const rows = query.data ?? []

  return (
    <WidgetCard
      title="Latest movements"
      description="The stock ledger, newest first"
      icon={Waypoints}
      tone="violet"
      viewAll={{ to: drill.stockMovements() }}
      state={state(query, rows.length === 0)}
      skeleton={<SkeletonRows rows={6} />}
      emptyIcon={Waypoints}
      emptyTitle="No stock has moved yet"
      emptyDescription="Movements appear here as soon as a document posts."
    >
      <MiniTable
        columns={MOVEMENT_COLUMNS}
        rows={rows}
        rowKey={(r) => r.movement_id}
        to={(r) => (r.document_id ? drill.document(r.document_id) : drill.stockMovements({ itemId: r.item_id }))}
      />
    </WidgetCard>
  )
}
