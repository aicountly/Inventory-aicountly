import { ActiveBadge, StatusBadge } from '../components/StatusBadge'
import { batchesApi, brandsApi, itemGroupsApi, locationsApi, stockCategoriesApi, uomApi, warehouseGroupsApi, warehousesApi, BATCH_STATUSES, LOCATION_TYPES, WAREHOUSE_TYPES } from '../services/masters'
import type { Batch, Brand, ItemGroup, Location, StockCategory, Uom, Warehouse, WarehouseGroup } from '../services/masters'
import { formatDate, formatDateTime, formatInt, formatQty, humanize } from '../utils/format'
import { isPickedItem } from './formValues'
import { buildTree, descendantIds } from './tree'
import type { MasterConfig, SelectOption } from './types'

/** Master screen configurations for every simple master. */

const updatedAt = <T extends { updated_at?: string | null }>() => ({
  key: 'updated_at',
  header: 'Updated',
  sortKey: 'updated_at',
  render: (row: T) => <span className="nowrap muted">{formatDateTime(row.updated_at)}</span>,
})

const activeColumn = <T extends { is_active: number }>() => ({
  key: 'is_active',
  header: 'Status',
  render: (row: T) => <ActiveBadge active={row.is_active} />,
})

const idNum = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---------------------------------------------------------------------------

export const itemGroupsConfig: MasterConfig<ItemGroup> = {
  slug: 'item-groups',
  permissionSlug: 'item_groups',
  title: 'Item groups',
  singular: 'Item group',
  idKey: 'item_grp_id',
  nameOf: (r) => r.grp_name,
  api: itemGroupsApi,
  defaultSort: 'grp_name',
  tree: { parentKey: 'parent_grp_id' },
  columns: [
    { key: 'grp_name', header: 'Group', sortKey: 'grp_name', render: (r) => <strong>{r.grp_name}</strong> },
    { key: 'grp_alias', header: 'Alias', sortKey: 'grp_alias' },
    { key: 'is_primary', header: 'Level', render: (r) => (Number(r.is_primary) === 1 ? 'Primary' : 'Sub-group') },
    { key: 'item_count', header: 'Items', align: 'right', render: (r) => formatInt(r.item_count ?? 0) },
    activeColumn<ItemGroup>(),
    updatedAt<ItemGroup>(),
  ],
  fields: [
    { name: 'grp_name', label: 'Group name', type: 'text', required: true, maxLength: 255, span: 2 },
    { name: 'grp_alias', label: 'Alias', type: 'text', maxLength: 64 },
    {
      name: 'parent_grp_id',
      label: 'Parent group',
      type: 'select',
      emptyLabel: '— Primary group (no parent) —',
      help: 'Leave empty to make this a primary group.',
      options: (ctx) => {
        const rows = ctx.rows
        const self = ctx.row ? idNum(ctx.row.item_grp_id) : null
        const blocked = self !== null ? descendantIds(buildTree(rows, { idKey: 'item_grp_id', parentKey: 'parent_grp_id', labelOf: (r) => r.grp_name }), self) : new Set<number>()
        const source: { id: number; name: string }[] = rows.length > 0 ? rows.map((r) => ({ id: r.item_grp_id, name: r.grp_name })) : (ctx.options?.item_groups ?? []).map((g) => ({ id: g.item_grp_id, name: g.grp_name }))
        return source.filter((g) => !blocked.has(g.id)).sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: g.id, label: g.name }))
      },
    },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
  toPayload: (values) => {
    const parent = idNum(values.parent_grp_id)
    return {
      grp_name: String(values.grp_name ?? '').trim(),
      grp_alias: String(values.grp_alias ?? '').trim() || null,
      parent_grp_id: parent,
      is_primary: parent ? 0 : 1,
      is_active: values.is_active ? 1 : 0,
    }
  },
}

export const stockCategoriesConfig: MasterConfig<StockCategory> = {
  slug: 'stock-categories',
  permissionSlug: 'stock_categories',
  title: 'Stock categories',
  singular: 'Stock category',
  idKey: 'stock_cat_id',
  nameOf: (r) => r.cat_name,
  api: stockCategoriesApi,
  defaultSort: 'cat_name',
  needsFormOptions: false,
  columns: [
    { key: 'cat_name', header: 'Category', sortKey: 'cat_name', render: (r) => <strong>{r.cat_name}</strong> },
    { key: 'cat_alias', header: 'Alias', sortKey: 'cat_alias' },
    activeColumn<StockCategory>(),
    updatedAt<StockCategory>(),
  ],
  fields: [
    { name: 'cat_name', label: 'Category name', type: 'text', required: true, maxLength: 255, span: 2 },
    { name: 'cat_alias', label: 'Alias', type: 'text', maxLength: 64 },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
}

export const brandsConfig: MasterConfig<Brand> = {
  slug: 'brands',
  permissionSlug: 'brands',
  title: 'Brands',
  singular: 'Brand',
  idKey: 'brand_id',
  nameOf: (r) => r.brand_name,
  api: brandsApi,
  defaultSort: 'brand_name',
  needsFormOptions: false,
  columns: [
    { key: 'brand_name', header: 'Brand', sortKey: 'brand_name', render: (r) => <strong>{r.brand_name}</strong> },
    { key: 'brand_alias', header: 'Alias', sortKey: 'brand_alias' },
    activeColumn<Brand>(),
    updatedAt<Brand>(),
  ],
  fields: [
    { name: 'brand_name', label: 'Brand name', type: 'text', required: true, maxLength: 255, span: 2 },
    { name: 'brand_alias', label: 'Alias', type: 'text', maxLength: 64 },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
}

export const uomConfig: MasterConfig<Uom> = {
  slug: 'uom',
  permissionSlug: 'uom',
  title: 'Units of measure',
  singular: 'Unit',
  idKey: 'unit_id',
  nameOf: (r) => r.unit_name,
  api: uomApi,
  defaultSort: 'unit_name',
  needsFormOptions: false,
  columns: [
    { key: 'unit_name', header: 'Unit', sortKey: 'unit_name', render: (r) => <strong>{r.unit_name}</strong> },
    { key: 'unit_symbol', header: 'Symbol', sortKey: 'unit_symbol' },
    { key: 'print_name', header: 'Print name', sortKey: 'print_name' },
    { key: 'uqc_gst', header: 'GST UQC', sortKey: 'uqc_gst', render: (r) => <span className="mono">{r.uqc_gst ?? '—'}</span> },
    { key: 'decimal_places', header: 'Decimals', align: 'right', sortKey: 'decimal_places' },
    activeColumn<Uom>(),
    updatedAt<Uom>(),
  ],
  fields: [
    { name: 'unit_name', label: 'Unit name', type: 'text', required: true, maxLength: 128, placeholder: 'Pieces' },
    { name: 'unit_symbol', label: 'Symbol', type: 'text', required: true, maxLength: 16, placeholder: 'Pcs' },
    { name: 'print_name', label: 'Print name', type: 'text', maxLength: 128, help: 'Defaults to the symbol.' },
    { name: 'uqc_gst', label: 'GST UQC code', type: 'text', maxLength: 16, placeholder: 'PCS', help: 'Unit quantity code used on GST returns.' },
    { name: 'decimal_places', label: 'Decimal places', type: 'number', min: 0, max: 4, step: 1, help: '0 to 4.' },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
  toValues: (row) => ({
    unit_name: row?.unit_name ?? '',
    unit_symbol: row?.unit_symbol ?? '',
    print_name: row?.print_name ?? '',
    uqc_gst: row?.uqc_gst ?? '',
    decimal_places: row ? String(row.decimal_places ?? 4) : '4',
    is_active: row ? Number(row.is_active) === 1 : true,
  }),
}

export const warehouseGroupsConfig: MasterConfig<WarehouseGroup> = {
  slug: 'warehouse-groups',
  permissionSlug: 'warehouse_groups',
  title: 'Warehouse groups',
  singular: 'Warehouse group',
  idKey: 'warehouse_group_id',
  nameOf: (r) => r.grp_name,
  api: warehouseGroupsApi,
  defaultSort: 'grp_name',
  needsFormOptions: false,
  tree: { parentKey: 'parent_grp_id' },
  columns: [
    { key: 'grp_name', header: 'Group', sortKey: 'grp_name', render: (r) => <strong>{r.grp_name}</strong> },
    activeColumn<WarehouseGroup>(),
    updatedAt<WarehouseGroup>(),
  ],
  fields: [
    { name: 'grp_name', label: 'Group name', type: 'text', required: true, maxLength: 255, span: 2 },
    {
      name: 'parent_grp_id',
      label: 'Parent group',
      type: 'select',
      emptyLabel: '— No parent —',
      options: (ctx) => {
        const self = ctx.row ? idNum(ctx.row.warehouse_group_id) : null
        const blocked = self !== null ? descendantIds(buildTree(ctx.rows, { idKey: 'warehouse_group_id', parentKey: 'parent_grp_id', labelOf: (r) => r.grp_name }), self) : new Set<number>()
        return ctx.rows
          .filter((r) => !blocked.has(r.warehouse_group_id))
          .sort((a, b) => a.grp_name.localeCompare(b.grp_name))
          .map((r) => ({ value: r.warehouse_group_id, label: r.grp_name }))
      },
    },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
}

const warehouseTypeOptions: SelectOption[] = WAREHOUSE_TYPES.map((t) => ({ value: t, label: humanize(t) }))

export const warehousesConfig: MasterConfig<Warehouse> = {
  slug: 'warehouses',
  permissionSlug: 'warehouses',
  title: 'Warehouses',
  singular: 'Warehouse',
  idKey: 'warehouse_id',
  nameOf: (r) => r.warehouse_name,
  api: warehousesApi,
  defaultSort: 'warehouse_name',
  modalSize: 'lg',
  filters: [{ name: 'warehouse_type', label: 'Type', options: warehouseTypeOptions, allLabel: 'All types' }],
  columns: [
    {
      key: 'warehouse_name',
      header: 'Warehouse',
      sortKey: 'warehouse_name',
      render: (r) => (
        <>
          <strong>{r.warehouse_name}</strong>
          {Number(r.is_default) === 1 ? <span className="badge" style={{ marginLeft: '0.5rem' }}>Default</span> : null}
        </>
      ),
    },
    { key: 'warehouse_code', header: 'Code', sortKey: 'warehouse_code', render: (r) => <span className="mono">{r.warehouse_code ?? '—'}</span> },
    { key: 'warehouse_type', header: 'Type', sortKey: 'warehouse_type', render: (r) => humanize(r.warehouse_type) },
    { key: 'bo_id', header: 'Branch', sortKey: 'bo_id', render: (r) => (Number(r.bo_id) > 0 ? `Branch #${r.bo_id}` : 'All branches') },
    { key: 'allow_negative', header: 'Negative stock', render: (r) => (r.allow_negative === null || r.allow_negative === undefined ? 'Company policy' : Number(r.allow_negative) === 1 ? 'Allowed' : 'Blocked') },
    activeColumn<Warehouse>(),
    updatedAt<Warehouse>(),
  ],
  fields: [
    { name: 'warehouse_name', label: 'Warehouse name', type: 'text', required: true, maxLength: 255, span: 2 },
    { name: 'warehouse_code', label: 'Code', type: 'text', maxLength: 32, help: 'Unique within the company.' },
    { name: 'warehouse_type', label: 'Type', type: 'select', required: true, options: warehouseTypeOptions },
    {
      name: 'warehouse_group_id',
      label: 'Warehouse group',
      type: 'select',
      loadOptions: async (_ctx, signal) => {
        const res = await warehouseGroupsApi.list({ limit: 1000, status: 'active', sort: 'grp_name' }, signal)
        return res.data.map((g) => ({ value: g.warehouse_group_id, label: g.grp_name }))
      },
    },
    {
      name: 'parent_warehouse_id',
      label: 'Parent warehouse',
      type: 'select',
      options: (ctx) => (ctx.options?.warehouses ?? []).filter((w) => !ctx.row || w.warehouse_id !== ctx.row.warehouse_id).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })),
    },
    { name: 'bo_id', label: 'Branch id', type: 'number', min: 0, step: 1, help: '0 = shared by all branches. Otherwise the Manage branch id.' },
    { name: 'allow_negative', label: 'Negative stock', type: 'select', emptyLabel: 'Follow company policy', options: [{ value: 1, label: 'Allow' }, { value: 0, label: 'Block' }] },
    { name: 'is_default', label: 'Default warehouse', type: 'checkbox', help: 'Used when a document does not name one.' },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
  toValues: (row) => ({
    warehouse_name: row?.warehouse_name ?? '',
    warehouse_code: row?.warehouse_code ?? '',
    warehouse_type: row?.warehouse_type ?? 'standard',
    warehouse_group_id: row?.warehouse_group_id ? String(row.warehouse_group_id) : '',
    parent_warehouse_id: row?.parent_warehouse_id ? String(row.parent_warehouse_id) : '',
    bo_id: row ? String(row.bo_id ?? 0) : '0',
    allow_negative: row && row.allow_negative !== null && row.allow_negative !== undefined ? String(Number(row.allow_negative)) : '',
    is_default: row ? Number(row.is_default) === 1 : false,
    is_active: row ? Number(row.is_active) === 1 : true,
  }),
  toPayload: (values) => ({
    warehouse_name: String(values.warehouse_name ?? '').trim(),
    warehouse_code: String(values.warehouse_code ?? '').trim() || null,
    warehouse_type: String(values.warehouse_type || 'standard'),
    warehouse_group_id: idNum(values.warehouse_group_id),
    parent_warehouse_id: idNum(values.parent_warehouse_id),
    bo_id: Math.max(0, Number(values.bo_id) || 0),
    allow_negative: values.allow_negative === '' || values.allow_negative === null || values.allow_negative === undefined ? null : Number(values.allow_negative),
    is_default: values.is_default ? 1 : 0,
    is_active: values.is_active ? 1 : 0,
  }),
}

const locationTypeOptions: SelectOption[] = LOCATION_TYPES.map((t) => ({ value: t, label: humanize(t) }))

export const locationsConfig: MasterConfig<Location> = {
  slug: 'locations',
  permissionSlug: 'locations',
  title: 'Locations',
  singular: 'Location',
  idKey: 'location_id',
  nameOf: (r) => `${r.location_code}${r.location_name ? ` – ${r.location_name}` : ''}`,
  api: locationsApi,
  defaultSort: 'location_code',
  searchPlaceholder: 'Search by code or name…',
  filters: [{ name: 'warehouse_id', label: 'Warehouse', options: (o) => (o?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })), allLabel: 'All warehouses' }],
  columns: [
    { key: 'location_code', header: 'Code', sortKey: 'location_code', render: (r) => <strong className="mono">{r.location_code}</strong> },
    { key: 'location_name', header: 'Name', sortKey: 'location_name' },
    { key: 'location_type', header: 'Type', sortKey: 'location_type', render: (r) => humanize(r.location_type) },
    { key: 'warehouse_id', header: 'Warehouse', sortKey: 'warehouse_id', render: (r) => `#${r.warehouse_id}` },
    { key: 'parent_location_id', header: 'Parent', render: (r) => (r.parent_location_id ? `#${r.parent_location_id}` : '—') },
    activeColumn<Location>(),
    updatedAt<Location>(),
  ],
  fields: [
    { name: 'warehouse_id', label: 'Warehouse', type: 'select', required: true, options: (ctx) => (ctx.options?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })), disabled: (ctx) => ctx.mode === 'edit' },
    { name: 'location_type', label: 'Type', type: 'select', required: true, options: locationTypeOptions },
    { name: 'location_code', label: 'Code', type: 'text', required: true, maxLength: 64, help: 'Unique within the warehouse.' },
    { name: 'location_name', label: 'Name', type: 'text', maxLength: 255 },
    {
      name: 'parent_location_id',
      label: 'Parent location',
      type: 'select',
      dependsOn: ['warehouse_id'],
      emptyLabel: '— Top level —',
      loadOptions: async (ctx, signal) => {
        const wh = idNum(ctx.values.warehouse_id)
        if (!wh) return []
        const res = await locationsApi.list({ warehouse_id: wh, limit: 1000, sort: 'location_code' }, signal)
        const self = ctx.row?.location_id ?? null
        return res.data.filter((l) => l.location_id !== self).map((l) => ({ value: l.location_id, label: `${l.location_code}${l.location_name ? ` – ${l.location_name}` : ''} (${humanize(l.location_type)})` }))
      },
    },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
  toValues: (row) => ({
    warehouse_id: row?.warehouse_id ? String(row.warehouse_id) : '',
    location_type: row?.location_type ?? 'bin',
    location_code: row?.location_code ?? '',
    location_name: row?.location_name ?? '',
    parent_location_id: row?.parent_location_id ? String(row.parent_location_id) : '',
    is_active: row ? Number(row.is_active) === 1 : true,
  }),
}

const batchStatusOptions: SelectOption[] = BATCH_STATUSES.map((s) => ({ value: s, label: humanize(s) }))

export const batchesConfig: MasterConfig<Batch> = {
  slug: 'batches',
  permissionSlug: 'batches',
  title: 'Batches',
  singular: 'Batch',
  idKey: 'batch_id',
  nameOf: (r) => `${r.batch_no}${r.item_name ? ` (${r.item_name})` : ''}`,
  api: batchesApi,
  defaultSort: 'batch_no',
  hasActiveFilter: false,
  hardDelete: true,
  needsFormOptions: false,
  searchPlaceholder: 'Search batch, lot or item…',
  listQuery: { with_stock: 1 },
  filters: [{ name: 'status', label: 'Status', options: batchStatusOptions, allLabel: 'All statuses' }],
  deleteHint: 'Only a batch with no stock and no document references can be deleted.',
  columns: [
    { key: 'batch_no', header: 'Batch', sortKey: 'batch_no', render: (r) => <strong className="mono">{r.batch_no}</strong> },
    { key: 'item_name', header: 'Item', sortKey: 'item_name', render: (r) => (
      <>
        {r.item_name ?? `#${r.item_id}`}
        {r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}
      </>
    ) },
    { key: 'lot_no', header: 'Lot' },
    { key: 'mfg_date', header: 'Manufactured', sortKey: 'mfg_date', render: (r) => <span className="nowrap">{formatDate(r.mfg_date)}</span> },
    { key: 'expiry_date', header: 'Expires', sortKey: 'expiry_date', render: (r) => <span className="nowrap">{formatDate(r.expiry_date)}</span> },
    { key: 'on_hand', header: 'On hand', align: 'right', render: (r) => (r.stock ? `${formatQty(r.stock.on_hand)}${r.unit_symbol ? ` ${r.unit_symbol}` : ''}` : '—') },
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} /> },
  ],
  fields: [
    { name: 'item', label: 'Item', type: 'item', required: true, span: 'all', disabled: (ctx) => ctx.mode === 'edit', itemFilter: (row) => Number(row.track_batch) === 1, help: 'Only batch-tracked items are listed.' },
    { name: 'batch_no', label: 'Batch number', type: 'text', required: true, maxLength: 64 },
    { name: 'lot_no', label: 'Lot number', type: 'text', maxLength: 64 },
    { name: 'mfg_date', label: 'Manufacturing date', type: 'date' },
    { name: 'expiry_date', label: 'Expiry date', type: 'date', help: 'Filled from the item shelf life when left empty.' },
    { name: 'warranty_months', label: 'Warranty (months)', type: 'number', min: 0, step: 1 },
    { name: 'status', label: 'Status', type: 'select', required: true, options: batchStatusOptions },
  ],
  toValues: (row) => ({
    item: row ? { item_id: row.item_id, item_name: row.item_name ?? `#${row.item_id}`, item_sku: row.item_sku } : null,
    batch_no: row?.batch_no ?? '',
    lot_no: row?.lot_no ?? '',
    mfg_date: row?.mfg_date ?? '',
    expiry_date: row?.expiry_date ?? '',
    warranty_months: row?.warranty_months !== null && row?.warranty_months !== undefined ? String(row.warranty_months) : '',
    status: row?.status ?? 'active',
  }),
  toPayload: (values) => ({
    item_id: isPickedItem(values.item) ? values.item.item_id : null,
    batch_no: String(values.batch_no ?? '').trim(),
    lot_no: String(values.lot_no ?? '').trim() || null,
    mfg_date: String(values.mfg_date ?? '').trim() || null,
    expiry_date: String(values.expiry_date ?? '').trim() || null,
    warranty_months: String(values.warranty_months ?? '').trim() === '' ? null : Number(values.warranty_months),
    status: String(values.status || 'active'),
  }),
}
