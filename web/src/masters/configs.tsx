import { ActiveBadge, StatusBadge, statusBadgeLabel } from '../components/StatusBadge'
import { batchesApi, itemGroupsApi, locationsApi, warehouseGroupsApi, warehousesApi, AREA_UNITS, AREA_UNIT_LABELS, BATCH_STATUSES, LOCATION_TYPES, WAREHOUSE_TYPES } from '../services/masters'
import type { AreaUnit, Batch, ItemGroup, Location, Warehouse } from '../services/masters'
import { formatDate, formatDateTime, formatInt, formatQty, humanize, toNumber } from '../utils/format'
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
    { key: 'is_primary', header: 'Level', render: (r) => (Number(r.is_primary) === 1 ? 'Primary' : 'Sub-group'), exportValue: (r) => (Number(r.is_primary) === 1 ? 'Primary' : 'Sub-group') },
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

/*
 * No stockCategoriesConfig.
 *
 * Stock categories outgrew the generic master screen the same way Brands and
 * Units of measure did — company-wide figures over the list, a usage count per
 * row with the actions that count implies, a selection that survives paging —
 * and is rendered by `pages/masters/stockCategories/StockCategoriesPage.tsx`.
 * A config left here would be a second, silent definition of that screen.
 */

/*
 * No brandsConfig.
 *
 * Brands outgrew the generic master screen — an item count worth clicking
 * through, a revenue column owned by another product, a create form with more
 * than three fields — and is rendered by `pages/masters/brands/BrandsPage.tsx`.
 * A config left here would be a second, silent definition of that screen: a
 * column added to it would change nothing, which is exactly the kind of edit
 * that gets made twice before anyone notices.
 */

/*
 * Units of measure has no config.
 *
 * It is the one master with a screen of its own (pages/masters/uom), so a
 * `uomConfig` left here would be a definition nothing renders — the kind that
 * gets edited in good faith and changes nothing on screen.
 */

/*
 * Warehouse groups used to be described here. It now has a screen of its own —
 * masters/warehouseGroups/WarehouseGroupsPage — because a MasterConfig cannot
 * express what that screen does: three views of the same rows, live figures
 * counted over the whole master, a contextual structure panel and a form with
 * a suggested code. `warehouseGroupsApi` is still the same endpoint, and the
 * warehouse form below still reads its options from it.
 */

const warehouseTypeOptions: SelectOption[] = WAREHOUSE_TYPES.map((t) => ({ value: t, label: humanize(t) }))
const areaUnitOptions: SelectOption[] = AREA_UNITS.map((u) => ({ value: u, label: AREA_UNIT_LABELS[u] }))

/*
 * The warehouse form's five sections. Long enough to need them: without the
 * headings, a capacity field and a pincode field sit in the same undifferentiated
 * grid and the form reads as a list of twenty inputs.
 */
const BASIC = 'Basic information'
const LOCATION = 'Location'
const CAPACITY = 'Capacity'
const CONTROLS = 'Inventory controls'
const ADVANCED = 'Advanced'

/*
 * The label helpers below are shared by the table cell and the exported cell so
 * the sheet cannot drift from the screen — the rule this repo already applies to
 * every other master column.
 */
const branchLabel = (r: Warehouse): string => (Number(r.bo_id) > 0 ? `Branch #${r.bo_id}` : 'All branches')

const placeLabel = (r: Warehouse): string | null => {
  const address = (r.address ?? {}) as Record<string, unknown>
  const parts = ['city', 'state', 'country']
    .map((k) => (typeof address[k] === 'string' ? (address[k] as string).trim() : ''))
    .filter((v) => v !== '')
  return parts.length === 0 ? null : parts.slice(0, 2).join(', ')
}

/** "50,000 Units", or the honest answer when nobody has set a ceiling. */
const capacityLabel = (r: Warehouse): string => {
  const capacity = toNumber(r.capacity_units)
  return capacity !== null && capacity > 0 ? `${formatQty(capacity)} Units` : 'Not configured'
}

const areaLabel = (r: Warehouse): string => {
  const area = toNumber(r.area)
  if (area === null || area <= 0) return 'Not configured'
  const unit = r.area_unit ? (AREA_UNIT_LABELS[r.area_unit as AreaUnit] ?? String(r.area_unit)) : ''
  return unit ? `${formatQty(area)} ${unit}` : formatQty(area)
}

const negativeStockLabel = (r: Warehouse): string =>
  r.allow_negative === null || r.allow_negative === undefined ? 'Company policy' : Number(r.allow_negative) === 1 ? 'Allowed' : 'Blocked'

/** A key of the warehouse's stored address, as form text. */
const addressField = (row: Warehouse | null, key: string): string => {
  const value = (row?.address as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** A stored number as form text; blank for null, so the input shows empty, not 0. */
const numText = (value: unknown): string => (value === null || value === undefined || value === '' ? '' : String(value))

const nullableText = (value: unknown): string | null => {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/**
 * A number field's payload value.
 *
 * Blank means "not configured" and must reach the API as null, never 0: a
 * warehouse whose capacity saved as 0 would read as permanently full on every
 * screen that divides by it.
 */
const nullableNum = (value: unknown): number | null => {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

const nonNegative = (value: unknown, label: string): string | null => {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  if (!Number.isFinite(n)) return `${label} must be a number`
  return n < 0 ? `${label} cannot be negative` : null
}

/**
 * A coordinate is valid alone only when its partner is blank too.
 *
 * Half a point plots nothing, so the API refuses it; catching it here means the
 * message lands on the field rather than arriving as a form-level error after a
 * round trip.
 */
const coordinateError = (value: unknown, partner: unknown, limit: number, label: string): string | null => {
  const text = String(value ?? '').trim()
  const partnerText = String(partner ?? '').trim()
  if (text === '') return partnerText === '' ? null : `${label} is required when the other coordinate is set`
  const n = Number(text)
  if (!Number.isFinite(n)) return `${label} must be a number`
  return n < -limit || n > limit ? `${label} must be between -${limit} and ${limit}` : null
}

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
      exportValue: (r) => `${r.warehouse_name}${Number(r.is_default) === 1 ? ' · Default' : ''}`,
    },
    { key: 'warehouse_code', header: 'Code', sortKey: 'warehouse_code', render: (r) => <span className="mono">{r.warehouse_code ?? '—'}</span> },
    { key: 'warehouse_type', header: 'Type', sortKey: 'warehouse_type', render: (r) => humanize(r.warehouse_type), exportValue: (r) => humanize(r.warehouse_type) },
    { key: 'bo_id', header: 'Branch', sortKey: 'bo_id', render: (r) => branchLabel(r), exportValue: (r) => branchLabel(r) },
    { key: 'location', header: 'Location', render: (r) => placeLabel(r) ?? '—', exportValue: (r) => placeLabel(r) ?? '' },
    { key: 'capacity_units', header: 'Capacity', sortKey: 'capacity_units', align: 'right', render: (r) => capacityLabel(r), exportValue: (r) => capacityLabel(r) },
    { key: 'area', header: 'Area', sortKey: 'area', align: 'right', render: (r) => areaLabel(r), exportValue: (r) => areaLabel(r) },
    { key: 'allow_negative', header: 'Negative stock', render: (r) => negativeStockLabel(r), exportValue: (r) => negativeStockLabel(r) },
    activeColumn<Warehouse>(),
    updatedAt<Warehouse>(),
  ],
  fields: [
    { section: BASIC, name: 'warehouse_name', label: 'Warehouse name', type: 'text', required: true, maxLength: 255, span: 2 },
    { section: BASIC, name: 'warehouse_code', label: 'Code', type: 'text', maxLength: 32, help: 'Unique within the company.' },
    { section: BASIC, name: 'warehouse_type', label: 'Type', type: 'select', required: true, options: warehouseTypeOptions },
    {
      section: BASIC,
      name: 'warehouse_group_id',
      label: 'Warehouse group',
      type: 'select',
      loadOptions: async (_ctx, signal) => {
        const res = await warehouseGroupsApi.list({ limit: 1000, status: 'active', sort: 'grp_name' }, signal)
        return res.data.map((g) => ({ value: g.warehouse_group_id, label: g.grp_code ? `${g.grp_name} (${g.grp_code})` : g.grp_name }))
      },
    },
    {
      section: BASIC,
      name: 'parent_warehouse_id',
      label: 'Parent warehouse',
      type: 'select',
      options: (ctx) => (ctx.options?.warehouses ?? []).filter((w) => !ctx.row || w.warehouse_id !== ctx.row.warehouse_id).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })),
    },
    { section: BASIC, name: 'bo_id', label: 'Branch id', type: 'number', min: 0, step: 1, help: '0 = shared by all branches. Otherwise the Manage branch id.' },

    { section: LOCATION, name: 'address_line1', label: 'Address', type: 'text', maxLength: 255, span: 2 },
    { section: LOCATION, name: 'address_city', label: 'City', type: 'text', maxLength: 120 },
    { section: LOCATION, name: 'address_state', label: 'State', type: 'text', maxLength: 120 },
    { section: LOCATION, name: 'address_country', label: 'Country', type: 'text', maxLength: 120 },
    { section: LOCATION, name: 'address_pincode', label: 'Pincode', type: 'text', maxLength: 16 },
    {
      section: LOCATION,
      name: 'latitude',
      label: 'Latitude',
      type: 'number',
      min: -90,
      max: 90,
      help: 'Optional. Set both coordinates to plot this warehouse on the map.',
      validate: (value, ctx) => coordinateError(value, ctx.values.longitude, 90, 'Latitude'),
    },
    {
      section: LOCATION,
      name: 'longitude',
      label: 'Longitude',
      type: 'number',
      min: -180,
      max: 180,
      validate: (value, ctx) => coordinateError(value, ctx.values.latitude, 180, 'Longitude'),
    },

    {
      section: CAPACITY,
      name: 'capacity_units',
      label: 'Maximum stock units',
      type: 'number',
      min: 0,
      help: 'Leave empty if this warehouse has no set ceiling — utilisation is then reported as not configured.',
      validate: (value) => nonNegative(value, 'Maximum stock units'),
    },
    { section: CAPACITY, name: 'area', label: 'Area', type: 'number', min: 0, validate: (value) => nonNegative(value, 'Area') },
    { section: CAPACITY, name: 'area_unit', label: 'Area unit', type: 'select', emptyLabel: '— None —', options: areaUnitOptions },

    { section: CONTROLS, name: 'allow_negative', label: 'Negative stock', type: 'select', emptyLabel: 'Follow company policy', options: [{ value: 1, label: 'Allow' }, { value: 0, label: 'Block' }] },
    { section: CONTROLS, name: 'is_default', label: 'Default warehouse', type: 'checkbox', help: 'Used when a document does not name one.' },

    { section: ADVANCED, name: 'is_active', label: 'Active', type: 'checkbox' },
  ],
  toValues: (row) => ({
    warehouse_name: row?.warehouse_name ?? '',
    warehouse_code: row?.warehouse_code ?? '',
    warehouse_type: row?.warehouse_type ?? 'standard',
    warehouse_group_id: row?.warehouse_group_id ? String(row.warehouse_group_id) : '',
    parent_warehouse_id: row?.parent_warehouse_id ? String(row.parent_warehouse_id) : '',
    bo_id: row ? String(row.bo_id ?? 0) : '0',
    address_line1: addressField(row, 'line1'),
    address_city: addressField(row, 'city'),
    address_state: addressField(row, 'state'),
    address_country: addressField(row, 'country'),
    address_pincode: addressField(row, 'pincode'),
    latitude: numText(row?.latitude),
    longitude: numText(row?.longitude),
    capacity_units: numText(row?.capacity_units),
    area: numText(row?.area),
    area_unit: row?.area_unit ? String(row.area_unit) : '',
    allow_negative: row && row.allow_negative !== null && row.allow_negative !== undefined ? String(Number(row.allow_negative)) : '',
    is_default: row ? Number(row.is_default) === 1 : false,
    is_active: row ? Number(row.is_active) === 1 : true,
  }),
  toPayload: (values, row) => ({
    warehouse_name: String(values.warehouse_name ?? '').trim(),
    warehouse_code: String(values.warehouse_code ?? '').trim() || null,
    warehouse_type: String(values.warehouse_type || 'standard'),
    warehouse_group_id: idNum(values.warehouse_group_id),
    parent_warehouse_id: idNum(values.parent_warehouse_id),
    bo_id: Math.max(0, Number(values.bo_id) || 0),
    /*
     * Spread the stored address first so a key this form does not show — an
     * address line 2 typed by an older build, a landmark imported from Books —
     * survives a save made from this screen. Only the five fields below are
     * ours to overwrite.
     */
    address: {
      ...((row?.address as Record<string, unknown> | null) ?? {}),
      line1: nullableText(values.address_line1),
      city: nullableText(values.address_city),
      state: nullableText(values.address_state),
      country: nullableText(values.address_country),
      pincode: nullableText(values.address_pincode),
    },
    latitude: nullableNum(values.latitude),
    longitude: nullableNum(values.longitude),
    capacity_units: nullableNum(values.capacity_units),
    area: nullableNum(values.area),
    area_unit: String(values.area_unit ?? '').trim() || null,
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
    { key: 'location_type', header: 'Type', sortKey: 'location_type', render: (r) => humanize(r.location_type), exportValue: (r) => humanize(r.location_type) },
    { key: 'warehouse_id', header: 'Warehouse', sortKey: 'warehouse_id', render: (r) => `#${r.warehouse_id}`, exportValue: (r) => `#${r.warehouse_id}` },
    { key: 'parent_location_id', header: 'Parent', render: (r) => (r.parent_location_id ? `#${r.parent_location_id}` : '—'), exportValue: (r) => (r.parent_location_id ? `#${r.parent_location_id}` : '') },
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
    ), exportValue: (r) => `${r.item_name ?? `#${r.item_id}`}${r.item_sku ? ` · ${r.item_sku}` : ''}` },
    { key: 'lot_no', header: 'Lot' },
    { key: 'mfg_date', header: 'Manufactured', sortKey: 'mfg_date', render: (r) => <span className="nowrap">{formatDate(r.mfg_date)}</span> },
    { key: 'expiry_date', header: 'Expires', sortKey: 'expiry_date', render: (r) => <span className="nowrap">{formatDate(r.expiry_date)}</span> },
    // The unit symbol belongs beside the figure on screen; in a sheet it would
    // make the column text and stop it totalling, so the number travels alone.
    { key: 'on_hand', header: 'On hand', align: 'right', render: (r) => (r.stock ? `${formatQty(r.stock.on_hand)}${r.unit_symbol ? ` ${r.unit_symbol}` : ''}` : '—'), exportValue: (r) => r.stock?.on_hand ?? '', exportFormat: 'qty' },
    // The badge reads "In stock" / "Quarantine"; the sheet must not read
    // `in_stock` / `quarantine` under the same header.
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} />, exportValue: (r) => statusBadgeLabel(r.status) },
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
