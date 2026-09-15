import { Link } from 'react-router-dom'
import { ActiveBadge } from '../../components/StatusBadge'
import { MasterPage } from '../../masters/MasterPage'
import type { MasterConfig } from '../../masters/types'
import { itemsApi, ITEM_TYPES } from '../../services/items'
import type { ItemListRow } from '../../services/items'
import type { CrudApi } from '../../services/masters'
import { formatDateTime, formatMoney, formatQty, humanize } from '../../utils/format'

const api: CrudApi<ItemListRow> = {
  list: (query, signal) => itemsApi.list(query, signal),
  get: (id, signal) => itemsApi.get(id, signal),
  create: (body) => itemsApi.create(body),
  update: (id, body) => itemsApi.update(id, body),
  remove: (id) => itemsApi.remove(id),
}

/** Batch / Serial / Expiry, in the order the screen shows them. */
function trackingFlags(r: ItemListRow): string[] {
  return [
    Number(r.track_batch) === 1 ? 'Batch' : null,
    Number(r.track_serial) === 1 ? 'Serial' : null,
    Number(r.track_expiry) === 1 ? 'Expiry' : null,
  ].filter((f): f is string => f !== null)
}

/**
 * Items.
 *
 * Exported so `masters/MasterPage.export.test.tsx` can hold the real config
 * against the sheet it produces: every column here drives the table AND the
 * CSV / Excel / PDF / print, and a computed or nested cell that forgets
 * `exportValue` exports a silently blank column under a header that promises a
 * figure. `tracking` and `on_hand` are both that shape.
 */
export const itemsConfig: MasterConfig<ItemListRow> = {
  slug: 'items',
  permissionSlug: 'items',
  title: 'Items',
  singular: 'Item',
  idKey: 'item_id',
  nameOf: (r) => r.item_name,
  api,
  defaultSort: 'item_name',
  searchPlaceholder: 'Search name, alias, SKU or barcode…',
  listQuery: { with_stock: 1 },
  createRoute: '/items/new',
  editRoute: (r) => `/items/${r.item_id}`,
  deleteHint: 'Items used on documents or bills of materials cannot be deleted — deactivate them instead.',
  filters: [
    { name: 'item_type', label: 'Type', options: ITEM_TYPES.map((t) => ({ value: t, label: humanize(t) })), allLabel: 'All types' },
    { name: 'item_grp_id', label: 'Group', options: (o) => (o?.item_groups ?? []).map((g) => ({ value: g.item_grp_id, label: g.grp_name })), allLabel: 'All groups' },
    { name: 'stock_cat_id', label: 'Category', options: (o) => (o?.stock_categories ?? []).map((c) => ({ value: c.stock_cat_id, label: c.cat_name })), allLabel: 'All categories' },
    { name: 'brand_id', label: 'Brand', options: (o) => (o?.brands ?? []).map((b) => ({ value: b.brand_id, label: b.brand_name })), allLabel: 'All brands' },
    { name: 'unit_id', label: 'Unit', options: (o) => (o?.units ?? []).map((u) => ({ value: u.unit_id, label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}` })), allLabel: 'All units' },
  ],
  columns: [
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      render: (r) => (
        <>
          <strong>{r.item_name}</strong>
          {r.item_alias ? <span className="muted"> · {r.item_alias}</span> : null}
        </>
      ),
    },
    { key: 'item_sku', header: 'SKU', sortKey: 'item_sku', render: (r) => <span className="mono">{r.item_sku ?? '—'}</span> },
    { key: 'item_upc', header: 'Barcode', render: (r) => <span className="mono">{r.item_upc ?? '—'}</span> },
    { key: 'grp_name', header: 'Group', sortKey: 'grp_name' },
    { key: 'cat_name', header: 'Category' },
    { key: 'brand_name', header: 'Brand' },
    { key: 'unit_symbol', header: 'Unit', render: (r) => r.unit_symbol ?? r.unit_name ?? '—' },
    { key: 'hsn_sac', header: 'HSN', render: (r) => <span className="mono">{r.hsn_sac ?? '—'}</span> },
    { key: 'mrp', header: 'MRP', align: 'right', render: (r) => formatMoney(r.mrp) },
    { key: 'valuation_method', header: 'Valuation', render: (r) => r.valuation_method },
    {
      /*
       * Computed, so it MUST declare its own export value.
       *
       * There is no `tracking` field on an ItemListRow — the cell is derived
       * from track_batch / track_serial / track_expiry. Without a resolver the
       * sheet falls back to `row['tracking']`, which is undefined, and every row
       * of the CSV, the spreadsheet and the letterheaded print sheet comes out
       * blank under a header promising the tracking mode. A reader of that paper
       * concludes the items carry no batch or serial tracking.
       */
      key: 'tracking',
      header: 'Tracking',
      render: (r) => {
        const flags = trackingFlags(r)
        return flags.length ? flags.join(', ') : <span className="muted">—</span>
      },
      exportValue: (r) => trackingFlags(r).join(', '),
    },
    {
      // Nested, so it MUST declare its own export value: the figure is at
      // `stock.on_hand`, not `row['on_hand']`. A blank On hand column on a
      // letterheaded sheet is a stock quantity presented as absent.
      key: 'on_hand',
      header: 'On hand',
      align: 'right',
      render: (r) => (r.stock ? formatQty(r.stock.on_hand) : '—'),
      exportValue: (r) => r.stock?.on_hand ?? '',
      exportFormat: 'qty',
    },
    { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [],
}

export function ItemsListPage() {
  return (
    <MasterPage
      config={itemsConfig}
      extraActions={({ canWrite }) =>
        canWrite ? (
          <Link className="btn" to="/items/bulk-edit">
            Bulk edit
          </Link>
        ) : null
      }
    />
  )
}
