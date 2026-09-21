import { ActiveBadge } from '../../components/StatusBadge'
import { ITEM_TYPES, itemsApi } from '../../services/items'
import type { ItemListRow } from '../../services/items'
import type { CrudApi } from '../../services/masters'
import type { MasterConfig } from '../../masters/types'
import { formatDateTime, formatMoney, formatQty, humanize } from '../../utils/format'
import { getStockHealth, trackingFlags } from './itemsModel'

const api: CrudApi<ItemListRow> = {
  list: (query, signal) => itemsApi.list(query, signal),
  get: (id, signal) => itemsApi.get(id, signal),
  create: (body) => itemsApi.create(body),
  update: (id, body) => itemsApi.update(id, body),
  remove: (id) => itemsApi.remove(id),
}

/**
 * Items, as a `MasterConfig`.
 *
 * The screen itself is no longer a `MasterPage` — `ItemsPage` renders the list,
 * the KPI strip and the inspector drawer. This config stayed, and stayed
 * authoritative, because it is what the CSV, the Excel workbook, the PDF and
 * the letterheaded print sheet are built from: ONE column list behind the table
 * and the paper, so a column cannot be added to the screen and forgotten in the
 * export. `masters/realMasterExports.test.tsx` holds it to exactly that.
 *
 * A computed or nested cell MUST declare `exportValue`. Without one the sheet
 * falls back to `row[key]`, which is undefined, and the column comes out blank
 * under a header promising a figure — a reader of that paper concludes the
 * items carry no tracking and hold no stock. `tracking`, `on_hand` and
 * `stock_health` are all that shape.
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
    {
      /*
       * The reading of the quantity beside it, in words.
       *
       * On paper the colour the screen uses is gone — a red -1 and a black 412
       * print identically — so the sheet has to SAY which items need attention
       * or the print-out quietly loses the one thing the screen was shouting.
       */
      key: 'stock_health',
      header: 'Stock health',
      render: (r) => getStockHealth(r).label,
      exportValue: (r) => getStockHealth(r).label,
    },
    { key: 'is_active', header: 'Status', render: (r) => <ActiveBadge active={r.is_active} /> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [],
}
