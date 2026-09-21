import { useState } from 'react'
import { Boxes, Check, Hash, Layers, Trash2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import type { EntryAdd } from './ItemEntryBar'
import { ChallanWarehouseSelect } from './fields'
import { ItemSearchInput, itemSubtitle } from './ItemSearchInput'

interface Picked {
  row: ItemSearchRow
  qty: string
  warehouseId: number | null
}

interface MultiItemDrawerProps {
  open: boolean
  onClose: () => void
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onAdd: (entries: EntryAdd[]) => void
}

/**
 * Build a basket of items and add them in one go — the difference between a
 * forty-line challan taking forty round trips of the entry bar and one pass.
 *
 * Batch and serial selections are deliberately NOT made here: they name
 * specific physical stock and belong on the line, where the availability check
 * for that line's own warehouse can be seen next to them.
 */
export function MultiItemDrawer({ open, onClose, warehouses, defaultWarehouseId, onAdd }: MultiItemDrawerProps) {
  const [picked, setPicked] = useState<Picked[]>([])
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)

  const add = (row: ItemSearchRow) => {
    setPicked((list) => {
      const at = list.findIndex((p) => p.row.item_id === row.item_id)
      if (at >= 0) {
        const next = [...list]
        const current = Number(next[at].qty) || 0
        next[at] = { ...next[at], qty: String(current + 1) }
        return next
      }
      return [...list, { row, qty: '1', warehouseId: row.default_warehouse_id ?? warehouseId }]
    })
  }

  const close = () => {
    setPicked([])
    onClose()
  }

  const commit = () => {
    const entries: EntryAdd[] = picked
      .filter((p) => (Number(p.qty) || 0) > 0)
      .map((p) => {
        const units = unitOptionsFrom(p.row)
        const def = units.find((u) => u.is_default) ?? units[0]
        return {
          item: p.row,
          units,
          unitId: def?.unit_id ?? p.row.unit_id ?? null,
          warehouseId: p.warehouseId ?? warehouseId,
          batchId: null,
          batchNo: null,
          batchExpiry: null,
          batchAvailable: null,
          qty: p.qty,
        }
      })
    if (entries.length) onAdd(entries)
    close()
  }

  const usable = picked.filter((p) => (Number(p.qty) || 0) > 0).length

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Add multiple items"
      description="Search, build the list, then add every line at once."
      width="xl"
      badge={picked.length ? <Badge tone="primary" size="xs">{picked.length} selected</Badge> : undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {usable === 0 ? 'Nothing to add yet.' : `${usable} line${usable === 1 ? '' : 's'} will be added to the challan.`}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" icon={Check} disabled={usable === 0} onClick={commit}>
              Add {usable || ''} selected item{usable === 1 ? '' : 's'}
            </Button>
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,12rem]">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Search items</label>
            <ItemSearchInput warehouseId={warehouseId} onPick={add} autoFocus limit={15} placeholder="Search item by name, SKU or barcode…" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="multi-warehouse">
              Warehouse for new rows
            </label>
            <ChallanWarehouseSelect id="multi-warehouse" value={warehouseId} warehouses={warehouses} onChange={setWarehouseId} emptyLabel="(header default)" />
          </div>
        </div>

        {picked.length === 0 ? (
          <EmptyState icon={Boxes} size="sm" title="Nothing picked yet" description="Every item you pick from the search lands here with a quantity you can adjust." />
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {picked.map((p, i) => {
              const available = p.row.stock?.available
              return (
                <li key={p.row.item_id} className={cx('flex flex-wrap items-center gap-2 px-3 py-2', i % 2 ? 'bg-gray-50/50' : '')}>
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block truncate text-xs font-medium text-gray-900">{p.row.print_name || p.row.item_name}</span>
                    <span className="flex items-center gap-1.5 truncate text-[10px] text-gray-500">
                      {p.row.item_sku ? <span className="font-mono">{p.row.item_sku}</span> : null}
                      {itemSubtitle(p.row) && itemSubtitle(p.row) !== p.row.item_sku ? <span className="truncate">· {itemSubtitle(p.row)}</span> : null}
                      {Number(p.row.track_batch) === 1 ? <Layers className="h-2.5 w-2.5 text-amber-500" aria-label="Batch tracked" /> : null}
                      {Number(p.row.track_serial) === 1 ? <Hash className="h-2.5 w-2.5 text-violet-500" aria-label="Serial tracked" /> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] tabular-nums text-gray-500">
                    {available === undefined ? '—' : `${formatQty(available)} avail`}
                  </span>
                  <ChallanWarehouseSelect
                    className="w-40 shrink-0"
                    value={p.warehouseId}
                    warehouses={warehouses}
                    emptyLabel="(header default)"
                    aria-label={`Warehouse for ${p.row.item_name}`}
                    onChange={(id) => setPicked((list) => list.map((x, idx) => (idx === i ? { ...x, warehouseId: id } : x)))}
                  />
                  <Input
                    className="w-20 shrink-0 text-right tabular-nums"
                    size="sm"
                    inputMode="decimal"
                    value={p.qty}
                    aria-label={`Quantity for ${p.row.item_name}`}
                    invalid={!((Number(p.qty) || 0) > 0)}
                    onChange={(e) => setPicked((list) => list.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50"
                    aria-label={`Remove ${p.row.item_name}`}
                    onClick={() => setPicked((list) => list.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {picked.length > 0 ? (
          <Button variant="ghost" size="xs" icon={Trash2} onClick={() => setPicked([])}>
            Clear the list
          </Button>
        ) : null}
      </div>
    </Drawer>
  )
}
