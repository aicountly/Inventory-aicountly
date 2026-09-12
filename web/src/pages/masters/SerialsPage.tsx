import { useState } from 'react'
import { StatusBadge } from '../../components/StatusBadge'
import { useFormOptions } from '../../hooks/useFormOptions'
import { MasterPage } from '../../masters/MasterPage'
import { isPickedItem } from '../../masters/formValues'
import type { MasterConfig, SelectOption } from '../../masters/types'
import { batchesApi, locationsApi, serialsApi, SERIAL_STATUSES } from '../../services/masters'
import type { Serial } from '../../services/masters'
import { formatDate, formatDateTime, formatMoney, humanize } from '../../utils/format'
import { SerialBulkAddDialog } from './SerialBulkAddDialog'

const statusOptions: SelectOption[] = SERIAL_STATUSES.map((s) => ({ value: s, label: humanize(s) }))

const idNum = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const serialsConfig: MasterConfig<Serial> = {
  slug: 'serials',
  permissionSlug: 'serials',
  title: 'Serial numbers',
  singular: 'Serial number',
  idKey: 'serial_id',
  nameOf: (r) => `${r.serial_no}${r.item_name ? ` (${r.item_name})` : ''}`,
  api: serialsApi,
  defaultSort: 'serial_no',
  hasActiveFilter: false,
  hardDelete: true,
  searchPlaceholder: 'Search serial or item…',
  deleteHint: 'Serials that are in stock, reserved or in transit are removed with a serial adjustment document instead.',
  filters: [
    { name: 'status', label: 'Status', options: statusOptions, allLabel: 'All statuses' },
    { name: 'warehouse_id', label: 'Warehouse', options: (o) => (o?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })), allLabel: 'All warehouses' },
  ],
  columns: [
    { key: 'serial_no', header: 'Serial', sortKey: 'serial_no', render: (r) => <strong className="mono">{r.serial_no}</strong> },
    {
      key: 'item_name',
      header: 'Item',
      sortKey: 'item_name',
      render: (r) => (
        <>
          {r.item_name ?? `#${r.item_id}`}
          {r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}
        </>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'warehouse_name', header: 'Warehouse', sortKey: 'warehouse_name' },
    { key: 'batch_no', header: 'Batch', sortKey: 'batch_no', render: (r) => <span className="mono">{r.batch_no ?? '—'}</span> },
    { key: 'location_code', header: 'Location', render: (r) => <span className="mono">{r.location_code ?? '—'}</span> },
    { key: 'unit_cost', header: 'Unit cost', align: 'right', render: (r) => formatMoney(r.unit_cost) },
    { key: 'warranty_until', header: 'Warranty until', sortKey: 'warranty_until', render: (r) => <span className="nowrap">{formatDate(r.warranty_until)}</span> },
    { key: 'updated_at', header: 'Updated', sortKey: 'updated_at', render: (r) => <span className="nowrap muted">{formatDateTime(r.updated_at)}</span> },
  ],
  fields: [
    { name: 'item', label: 'Item', type: 'item', required: true, span: 'all', disabled: (ctx) => ctx.mode === 'edit', itemFilter: (row) => Number(row.track_serial) === 1, help: 'Only serial-tracked items are listed.' },
    { name: 'serial_no', label: 'Serial number', type: 'text', required: true, maxLength: 128 },
    { name: 'status', label: 'Status', type: 'select', required: true, options: statusOptions, help: 'Stock-bearing statuses are normally set by documents.' },
    { name: 'warehouse_id', label: 'Warehouse', type: 'select', options: (ctx) => (ctx.options?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name })) },
    {
      name: 'batch_id',
      label: 'Batch',
      type: 'select',
      dependsOn: ['item'],
      loadOptions: async (ctx, signal) => {
        const item = isPickedItem(ctx.values.item) ? ctx.values.item.item_id : null
        if (!item) return []
        const res = await batchesApi.list({ item_id: item, limit: 500, sort: 'batch_no' }, signal)
        return res.data.map((b) => ({ value: b.batch_id, label: `${b.batch_no}${b.expiry_date ? ` (exp ${b.expiry_date})` : ''}` }))
      },
    },
    {
      name: 'location_id',
      label: 'Location',
      type: 'select',
      dependsOn: ['warehouse_id'],
      loadOptions: async (ctx, signal) => {
        const wh = idNum(ctx.values.warehouse_id)
        if (!wh) return []
        const res = await locationsApi.list({ warehouse_id: wh, limit: 1000, sort: 'location_code', status: 'active' }, signal)
        return res.data.map((l) => ({ value: l.location_id, label: `${l.location_code}${l.location_name ? ` – ${l.location_name}` : ''}` }))
      },
    },
    { name: 'unit_cost', label: 'Unit cost', type: 'number', min: 0 },
    { name: 'warranty_until', label: 'Warranty until', type: 'date' },
  ],
  toValues: (row) => ({
    item: row ? { item_id: row.item_id, item_name: row.item_name ?? `#${row.item_id}`, item_sku: row.item_sku } : null,
    serial_no: row?.serial_no ?? '',
    status: row?.status ?? 'expected',
    warehouse_id: row?.warehouse_id ? String(row.warehouse_id) : '',
    batch_id: row?.batch_id ? String(row.batch_id) : '',
    location_id: row?.location_id ? String(row.location_id) : '',
    unit_cost: row?.unit_cost !== null && row?.unit_cost !== undefined ? String(row.unit_cost) : '',
    warranty_until: row?.warranty_until ?? '',
  }),
  toPayload: (values) => ({
    item_id: isPickedItem(values.item) ? values.item.item_id : null,
    serial_no: String(values.serial_no ?? '').trim(),
    status: String(values.status || 'expected'),
    warehouse_id: idNum(values.warehouse_id),
    batch_id: idNum(values.batch_id),
    location_id: idNum(values.location_id),
    unit_cost: String(values.unit_cost ?? '').trim() === '' ? null : Number(values.unit_cost),
    warranty_until: String(values.warranty_until ?? '').trim() || null,
  }),
}

export function SerialsPage() {
  const [bulkOpen, setBulkOpen] = useState(false)
  const [reloadAfterBulk, setReloadAfterBulk] = useState<(() => void) | null>(null)
  const { options } = useFormOptions()

  return (
    <MasterPage
      config={serialsConfig}
      breadcrumbs={[{ label: 'Masters', to: '/masters' }]}
      extraActions={({ reload, canWrite }) =>
        canWrite ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setReloadAfterBulk(() => reload)
              setBulkOpen(true)
            }}
          >
            Bulk add
          </button>
        ) : null
      }
    >
      <SerialBulkAddDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => reloadAfterBulk?.()} warehouses={options?.warehouses ?? []} />
    </MasterPage>
  )
}
