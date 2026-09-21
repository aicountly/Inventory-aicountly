import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Skeleton } from '../../ui/Skeleton'
import { formatQty } from '../../utils/format'

export interface AddMultipleItemsDrawerProps {
  open: boolean
  onClose: () => void
  warehouseId: number | null
  onAdd: (rows: { row: ItemSearchRow; qty: number }[]) => void
}

/**
 * Bulk item picker: search, tick, set a quantity, confirm once. Every row comes from the live
 * item-search endpoint (`lookupApi.searchItems`, scoped to the packing warehouse so availability
 * reads right) — nothing here preloads the item master.
 */
export function AddMultipleItemsDrawer({ open, onClose, warehouseId, onAdd }: AddMultipleItemsDrawerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Map<number, number>>(new Map())
  const [byId, setById] = useState<Map<number, ItemSearchRow>>(new Map())
  const debounced = useDebounce(query, 250)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setRows([])
      setSelected(new Map())
      setById(new Map())
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 30, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setById((m) => {
          const next = new Map(m)
          found.forEach((r) => next.set(r.item_id, r))
          return next
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, warehouseId])

  const toggle = (row: ItemSearchRow) => {
    setSelected((m) => {
      const next = new Map(m)
      if (next.has(row.item_id)) next.delete(row.item_id)
      else next.set(row.item_id, 1)
      return next
    })
  }

  const setQty = (itemId: number, qty: number) => setSelected((m) => new Map(m).set(itemId, qty))

  const confirm = () => {
    const picked = [...selected.entries()]
      .map(([itemId, qty]) => ({ row: byId.get(itemId), qty }))
      .filter((p): p is { row: ItemSearchRow; qty: number } => Boolean(p.row) && p.qty > 0)
    if (picked.length === 0) return
    onAdd(picked)
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add multiple items"
      description="Search, tick and set a quantity for each — added together when you confirm."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={selected.size === 0}>
              Add {selected.size || ''} item{selected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <Input leadingIcon={Search} autoFocus placeholder="Search by item name, SKU or barcode…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-3" />
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height="h-9" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">{query.trim() ? 'No matching items.' : 'Start typing to search items.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {rows.map((row) => {
            const checked = selected.has(row.item_id)
            return (
              <li key={row.item_id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(row)}
                  aria-label={`Select ${row.item_name}`}
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-2 focus:ring-primary/30"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{row.item_name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                    {row.stock ? ` · avail ${formatQty(row.stock.available)}` : ''}
                  </p>
                </div>
                {checked ? (
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Quantity for ${row.item_name}`}
                    value={selected.get(row.item_id) ?? 1}
                    onChange={(e) => setQty(row.item_id, Number(e.target.value))}
                    className="w-20 shrink-0"
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Drawer>
  )
}

export default AddMultipleItemsDrawer
