import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, ScrollText } from 'lucide-react'
import { ActiveBadge } from '../../components/StatusBadge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { useFormOptions } from '../../hooks/useFormOptions'
import { useQuery } from '../../hooks/useQuery'
import { itemsApi } from '../../services/items'
import type { ItemListRow } from '../../services/items'
import { formatDateTime, formatMoney, formatQty } from '../../utils/format'

const VIEWS = [
  { value: 'details' as const, label: 'Details' },
  { value: 'stock' as const, label: 'Stock' },
]

function Field({ label, value }: { label: string; value: ReactNode }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className={cx('mt-1 break-words text-xs', missing ? 'font-medium text-amber-600' : 'text-gray-700')}>
        {missing ? 'Not set' : value}
      </div>
    </div>
  )
}

/** Per-warehouse availability, fetched only once the reader opens this tab. */
function StockTab({ row }: { row: ItemListRow }) {
  const formOptions = useFormOptions()
  const stock = useQuery((signal) => itemsApi.stock(row.item_id, signal), [row.item_id])

  const warehouseName = (id: number | null): string => {
    if (id === null) return 'Unassigned'
    return formOptions.options?.warehouses.find((w) => w.warehouse_id === id)?.warehouse_name ?? `Warehouse #${id}`
  }

  if (stock.loading && !stock.data) {
    return (
      <p className="flex items-center gap-2 px-1 py-6 text-xs text-gray-500">
        <Spinner /> Loading stock…
      </p>
    )
  }
  if (stock.error) {
    return <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">Stock could not be loaded.</p>
  }

  const rows = (stock.data?.by_warehouse ?? []).filter((r) => r.on_hand !== 0 || r.reserved !== 0 || r.available !== 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit cost" value={stock.data?.unit_cost != null ? formatMoney(stock.data.unit_cost) : null} />
        <Field label="Valuation method" value={stock.data?.valuation_method ?? row.valuation_method} />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
          No stock recorded in any warehouse.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {rows.map((r) => (
            <li key={String(r.warehouse_id)} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-medium text-gray-700">{warehouseName(r.warehouse_id)}</span>
              <span className="flex items-center gap-2 tabular-nums text-gray-600">
                <span>{formatQty(r.on_hand)} on hand</span>
                <span className="text-gray-300">·</span>
                <span className="text-emerald-600">{formatQty(r.available)} available</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface ItemPreviewDrawerProps {
  row: ItemListRow | null
  onClose: () => void
}

/** The "Item preview" side panel — Details and Stock, read-only, with a way out to edit. */
export function ItemPreviewDrawer({ row, onClose }: ItemPreviewDrawerProps) {
  const [view, setView] = useState<'details' | 'stock'>('details')

  if (!row) {
    return (
      <Drawer open={false} title="" onClose={onClose}>
        {null}
      </Drawer>
    )
  }

  return (
    <Drawer
      key={row.item_id}
      open
      onClose={onClose}
      width="md"
      title={row.item_name}
      description={row.item_alias ? `Alias: ${row.item_alias}` : undefined}
      badge={<ActiveBadge active={row.is_active} />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Link to={`/registers/stock-ledger?item_id=${row.item_id}`}>
            <Button variant="secondary" icon={ScrollText}>
              View stock ledger
            </Button>
          </Link>
          <Link to={`/items/${row.item_id}`}>
            <Button icon={Pencil}>Edit item</Button>
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-primary-light/40 px-3 py-2.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            On hand · All branches
          </span>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
            {row.stock ? formatQty(row.stock.on_hand) : '—'}{' '}
            <span className="text-sm font-normal text-gray-500">{row.unit_symbol ?? row.unit_name ?? ''}</span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <SegmentedControl value={view} onChange={setView} options={VIEWS} />
        </div>

        {view === 'details' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Group" value={row.grp_name} />
            <Field label="Category" value={row.cat_name} />
            <Field label="Base unit" value={row.unit_symbol ?? row.unit_name} />
            <Field label="Valuation" value={row.valuation_method} />
            <Field label="SKU" value={row.item_sku} />
            <Field label="Barcode" value={row.item_upc} />
            <Field label="HSN" value={row.hsn_sac} />
            <Field label="MRP" value={row.mrp !== null && row.mrp !== undefined && row.mrp !== '' ? formatMoney(row.mrp) : null} />
          </div>
        ) : (
          <StockTab row={row} />
        )}

        <p className="text-[11px] text-gray-400">Updated {formatDateTime(row.updated_at)}</p>
      </div>
    </Drawer>
  )
}

export default ItemPreviewDrawer
