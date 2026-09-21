import { useEffect, useMemo, useState } from 'react'
import { Check, Package, Search } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'

export interface AddItemsDrawerProps {
  open: boolean
  onClose: () => void
  /** Availability in the results is read at this warehouse. */
  warehouseId: number | null
  warehouseLabel: string
  onAdd: (rows: ItemSearchRow[]) => void
}

/**
 * Add several items in one pass.
 *
 * The same `GET /v1/items/search?with_stock=1&warehouse_id=` the line typeahead
 * uses, so what is on hand at the SOURCE warehouse is visible before anything is
 * added — which is the whole reason to open a picker rather than type six rows.
 */
export function AddItemsDrawer({ open, onClose, warehouseId, warehouseLabel, onAdd }: AddItemsDrawerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [picked, setPicked] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounced = useDebounce(query, 250)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPicked([])
      setRows([])
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 25, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Items could not be searched just now.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, debounced, warehouseId])

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.item_id)), [picked])

  const toggle = (row: ItemSearchRow) => {
    setPicked((list) => (pickedIds.has(row.item_id) ? list.filter((p) => p.item_id !== row.item_id) : [...list, row]))
  }

  const confirm = () => {
    if (picked.length === 0) return
    onAdd(picked)
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add items to the transfer"
      description={warehouseId ? `Stock shown is what ${warehouseLabel} holds free right now.` : 'Choose a source warehouse to see live stock beside each item.'}
      width="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {picked.length === 0 ? 'Nothing selected' : `${picked.length} item${picked.length === 1 ? '' : 's'} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={picked.length === 0}>
              Add {picked.length > 0 ? picked.length : ''} to transfer
            </Button>
          </div>
        </div>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          className="aic block h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={query}
          autoFocus
          aria-label="Search items"
          placeholder="Search by item name, SKU or barcode…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error ? (
        <Notice kind="warning" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {!loading && rows.length === 0 ? (
          <li className="px-3 py-6 text-center">
            <p className="text-sm font-medium text-gray-700">No matching items found</p>
            <p className="mt-1 text-xs text-gray-500">Try the item name, its SKU or a barcode.</p>
          </li>
        ) : null}
        {loading && rows.length === 0 ? <li className="px-3 py-6 text-center text-xs text-gray-500">Searching…</li> : null}
        {rows.map((row) => {
          const isPicked = pickedIds.has(row.item_id)
          return (
            <li key={row.item_id}>
              <button
                type="button"
                aria-pressed={isPicked}
                onClick={() => toggle(row)}
                className={cx('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors', isPicked ? 'bg-primary-light' : 'hover:bg-gray-50')}
              >
                <span
                  className={cx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                    isPicked ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-gray-50 text-gray-400',
                  )}
                  aria-hidden
                >
                  {isPicked ? <Check className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{row.print_name || row.item_name}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                    {Number(row.track_batch) === 1 ? ' · batch tracked' : ''}
                    {Number(row.track_serial) === 1 ? ' · serial tracked' : ''}
                  </span>
                </span>
                {row.stock ? (
                  <span className="shrink-0 text-right">
                    <span className={cx('block text-xs font-bold tabular-nums', Number(row.stock.available) > 0 ? 'text-emerald-600' : 'text-red-500')}>
                      {formatQty(row.stock.available)}
                    </span>
                    <span className="block text-[10px] text-gray-400">free</span>
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </Drawer>
  )
}
