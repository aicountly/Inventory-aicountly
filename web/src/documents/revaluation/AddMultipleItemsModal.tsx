import { useEffect, useMemo, useState } from 'react'
import { Package, Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button, Select, Skeleton } from '../../ui'
import { FormField } from '../../ui/shell'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import { formatQty } from '../../utils/format'

export interface AddMultipleItemsModalProps {
  open: boolean
  onClose: () => void
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  existingItemIds: ReadonlySet<number>
  onAdd: (items: ItemSearchRow[], warehouseId: number | null) => void
}

/** Tick several items and add them as lines in one go, all at the warehouse chosen here. */
export function AddMultipleItemsModal({ open, onClose, warehouses, defaultWarehouseId, existingItemIds, onAdd }: AddMultipleItemsModalProps) {
  const [query, setQuery] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<number, ItemSearchRow>>(new Map())
  const debounced = useDebounce(query, 250)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(new Map())
    setError(null)
    setWarehouseId(defaultWarehouseId)
  }, [open, defaultWarehouseId])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 50, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Items could not be searched.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, warehouseId])

  const selectable = useMemo(() => rows.filter((r) => !existingItemIds.has(r.item_id)), [rows, existingItemIds])
  const allVisiblePicked = selectable.length > 0 && selectable.every((r) => picked.has(r.item_id))

  const toggle = (row: ItemSearchRow) => {
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(row.item_id)) next.delete(row.item_id)
      else next.set(row.item_id, row)
      return next
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add several items"
      description="Tick the items to revalue. Their current cost and quantity are read once they are on the document."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={picked.size === 0}
            onClick={() => {
              onAdd([...picked.values()], warehouseId)
              onClose()
            }}
          >
            Add {picked.size > 0 ? `${picked.size} item${picked.size === 1 ? '' : 's'}` : 'items'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <FormField label="Search" htmlFor="add-multiple-search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              id="add-multiple-search"
              type="search"
              autoFocus
              className="aic block h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Name, SKU or barcode…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </FormField>
        <FormField label="Warehouse" htmlFor="add-multiple-warehouse" hint="Applied to every item added here.">
          <Select id="add-multiple-warehouse" size="md" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                {w.warehouse_name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] text-gray-500">
          {loading ? 'Searching…' : `${rows.length} item${rows.length === 1 ? '' : 's'} shown`}
          {picked.size > 0 ? ` · ${picked.size} selected` : ''}
        </p>
        <Button
          size="xs"
          variant="ghost"
          disabled={selectable.length === 0}
          onClick={() =>
            setPicked((prev) => {
              const next = new Map(prev)
              if (allVisiblePicked) for (const row of selectable) next.delete(row.item_id)
              else for (const row of selectable) next.set(row.item_id, row)
              return next
            })
          }
        >
          {allVisiblePicked ? 'Clear all visible' : 'Select all visible'}
        </Button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-2 max-h-[22rem] overflow-y-auto scrollbar-thin rounded-xl border border-gray-200">
        {loading && rows.length === 0 ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-gray-500">No matching items.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => {
              const already = existingItemIds.has(row.item_id)
              const checked = picked.has(row.item_id)
              return (
                <li key={row.item_id}>
                  <label className={`flex items-center gap-2.5 px-3 py-2 ${already ? 'opacity-60' : 'cursor-pointer hover:bg-primary-light/25'}`}>
                    <input
                      type="checkbox"
                      className="aic h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                      checked={checked}
                      disabled={already}
                      onChange={() => toggle(row)}
                    />
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                      <Package className="h-4 w-4 text-gray-400" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-gray-900">{row.print_name || row.item_name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                        {[row.item_sku ? `SKU ${row.item_sku}` : null, row.hsn_sac ? `HSN ${row.hsn_sac}` : null, already ? 'already on this document' : null].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs font-semibold tabular-nums text-gray-900">{row.stock ? formatQty(row.stock.on_hand) : '—'}</span>
                      <span className="block text-[10px] text-gray-400">{row.unit_symbol ?? 'on hand'}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default AddMultipleItemsModal
