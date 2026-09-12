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

const itemsConfig: MasterConfig<ItemListRow> = {
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
      key: 'tracking',
      header: 'Tracking',
      render: (r) => {
        const flags = [Number(r.track_batch) === 1 ? 'Batch' : null, Number(r.track_serial) === 1 ? 'Serial' : null, Number(r.track_expiry) === 1 ? 'Expiry' : null].filter(Boolean)
        return flags.length ? flags.join(', ') : <span className="muted">—</span>
      },
    },
    { key: 'on_hand', header: 'On hand', align: 'right', render: (r) => (r.stock ? formatQty(r.stock.on_hand) : '—') },
    { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [],
}

export function ItemsListPage() {
  return <MasterPage config={itemsConfig} />
}
