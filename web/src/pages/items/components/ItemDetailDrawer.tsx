import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, PencilLine, ScrollText, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react'
import { useAccess } from '../../../access/AccessContext'
import { useCompany } from '../../../company/CompanyContext'
import { canCreate } from '../../../documents/actions'
import { slugForCode } from '../../../documents/registry'
import { useQuery } from '../../../hooks/useQuery'
import { P } from '../../../services/access'
import { itemsApi } from '../../../services/items'
import type { ItemListRow } from '../../../services/items'
import { Drawer } from '../../../ui/Drawer'
import { ActiveBadge } from '../../../ui/StatusBadge'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatDateTime, formatMoney, formatQty, humanize } from '../../../utils/format'
import { getStockHealth, itemSubtitle, trackingFlags } from '../itemsModel'
import { ItemAvatar } from './ItemIdentity'
import { StockHealthBadge } from './StockHealthBadge'
import { ItemAnalyticsTab, ItemStockTab, ItemTransactionsTab } from './ItemDrawerTabs'

type TabKey = 'overview' | 'stock' | 'transactions' | 'analytics'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'stock', label: 'Stock' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'analytics', label: 'Analytics' },
]

export interface ItemDetailDrawerProps {
  /** The row from the list — shown instantly, before the full record arrives. */
  item: ItemListRow | null
  onClose: () => void
  onDelete: (item: ItemListRow) => void
  onDuplicate: (item: ItemListRow) => void
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border-b border-gray-100 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={cx('mt-0.5 text-xs font-medium text-gray-900', mono && 'font-mono')}>{value || '—'}</dd>
    </div>
  )
}

/**
 * The item read beside the list instead of instead of it.
 *
 * It opens with the row it was given and fills in behind — the name, the
 * quantity and the classification are already on screen the instant the row is
 * clicked, and `/v1/items/{id}` only adds what the list does not carry. A
 * drawer that blanked itself and spun while a request went out would feel
 * slower than the list it came from, for data the browser already had.
 *
 * The heavy tabs fetch only when opened, so reading an item costs one request,
 * not four.
 */
export function ItemDetailDrawer({ item, onClose, onDelete, onDuplicate }: ItemDetailDrawerProps) {
  const { can } = useAccess()
  const { scope } = useCompany()
  const [tab, setTab] = useState<TabKey>('overview')

  const canWrite = can(P.masters('items', 'write'))
  const canDelete = can(P.masters('items', 'delete'))

  // A different item is a different record: start it on Overview rather than on
  // whichever tab the last one was left on.
  useEffect(() => {
    setTab('overview')
  }, [item?.item_id])

  const detail = useQuery(
    (signal) => itemsApi.get(item?.item_id as number, signal),
    [item?.item_id, scope?.cmp_id],
    { enabled: Boolean(item && scope), resetKey: item?.item_id ?? null },
  )

  if (!item) return null

  // The list row is the floor; the full record overlays it as it lands.
  const full = detail.data && detail.data.item_id === item.item_id ? detail.data : null
  const row: ItemListRow = full ?? item
  const health = getStockHealth(row)
  const tracking = trackingFlags(row)
  const hydrating = detail.loading && !full

  return (
    <Drawer
      open
      onClose={onClose}
      // 512px: wide enough for the two-column detail grid, narrow enough that
      // the list it is read against stays visible at the left edge.
      width="md"
      title={
        <span className="flex min-w-0 items-center gap-3">
          <ItemAvatar item={row} size="lg" />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-gray-900">{row.item_name}</span>
            <span className="block truncate text-xs text-gray-500">
              {itemSubtitle(row) || humanize(row.item_type)}
            </span>
          </span>
        </span>
      }
      badge={<ActiveBadge active={row.is_active} />}
      footer={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {canWrite ? (
            <Link
              to={`/items/${row.item_id}`}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary-light px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-light/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <PencilLine className="h-3.5 w-3.5" aria-hidden />
              Edit
            </Link>
          ) : (
            <Link
              to={`/items/${row.item_id}`}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              View
            </Link>
          )}
          {can(P.report('stock_ledger')) ? (
            <Link
              to={`/registers/stock-ledger?item_id=${row.item_id}`}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              Ledger
            </Link>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => onDuplicate(row)}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Duplicate
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(row)}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        {/* The four figures a stock controller checks first. */}
        <dl className="grid grid-cols-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          {[
            { label: 'On hand', value: health.onHand === null ? '—' : formatQty(health.onHand), danger: health.key === 'negative' },
            { label: 'Unit', value: row.unit_symbol ?? row.unit_name ?? '—' },
            { label: 'Valuation', value: row.valuation_method },
            { label: 'MRP', value: formatMoney(row.mrp) },
          ].map((cell, i) => (
            <div key={cell.label} className={cx('px-2 py-2.5 text-center', i < 3 && 'border-r border-gray-200')}>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">{cell.label}</dt>
              <dd className={cx('mt-1 truncate text-sm font-semibold tabular-nums', cell.danger ? 'text-red-600' : 'text-gray-900')}>
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>

        {health.key === 'negative' ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-red-700">Stock is below zero</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-red-700">
                More has been issued than was ever received. Correct it with a stock journal so the
                adjustment is posted and valued — an item&apos;s quantity is never edited directly.
              </p>
              {/*
               * A stock journal, not a quantity field.
               *
               * The correction has to be a posted movement: a quantity edited
               * on the master would leave stock that exists in the item and
               * nowhere in the ledger, and the valuation engine would have
               * nothing to cost. Slug and permission both come from the
               * document registry, so this cannot drift from the route it
               * points at, or offer a document the reader may not raise.
               */}
              {canCreate('STOCK_JOURNAL', can) ? (
                <Link
                  to={`/documents/new/${slugForCode('STOCK_JOURNAL')}`}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  Adjust stock
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2">
            <span className="text-[11px] text-gray-500">Stock health</span>
            <StockHealthBadge health={health} />
          </div>
        )}

        <div role="tablist" aria-label="Item details" className="grid grid-cols-4 gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'min-h-[32px] rounded-md px-1 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                tab === t.key ? 'bg-primary text-white' : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Item information</h3>
              {hydrating ? <Skeleton className="h-3 w-16" /> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-5">
              <Field label="SKU" value={row.item_sku} mono />
              <Field label="Barcode" value={row.item_upc} mono />
              <Field label="Alias" value={row.item_alias} />
              <Field label="Item type" value={humanize(row.item_type)} />
              <Field label="Group" value={row.grp_name} />
              <Field label="Category" value={row.cat_name} />
              <Field label="Brand" value={row.brand_name} />
              <Field label="Unit" value={row.unit_symbol ?? row.unit_name} />
              <Field label="HSN / SAC" value={row.hsn_sac} mono />
              <Field label="MRP" value={formatMoney(row.mrp)} />
              <Field label="Valuation method" value={row.valuation_method} />
              <Field label="Tracking" value={tracking.length ? tracking.join(', ') : '—'} />
              <Field label="Created" value={formatDateTime(row.created_at)} />
              <Field label="Last updated" value={formatDateTime(row.updated_at)} />
            </dl>
            {detail.error ? (
              <p className="mt-2 text-[11px] text-amber-600">
                The full record could not be loaded, so only what the list carries is shown.
              </p>
            ) : null}
          </section>
        ) : null}

        {tab === 'stock' ? <ItemStockTab item={row} /> : null}
        {tab === 'transactions' ? <ItemTransactionsTab item={row} /> : null}
        {tab === 'analytics' ? <ItemAnalyticsTab item={row} /> : null}
      </div>
    </Drawer>
  )
}
