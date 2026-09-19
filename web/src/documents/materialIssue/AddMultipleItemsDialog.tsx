import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button, Input, Skeleton } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'

export interface AddMultipleItemsDialogProps {
  open: boolean
  onClose: () => void
  /** Availability in the list is read at this warehouse, as the lines will be. */
  warehouseId: number | null
  warehouseName: string
  onAdd: (rows: ItemSearchRow[]) => void
}

/** Multi-select over the live item search, so a dozen lines take one trip. */
export function AddMultipleItemsDialog({ open, onClose, warehouseId, warehouseName, onAdd }: AddMultipleItemsDialogProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<number, ItemSearchRow>>(new Map())
  const debounced = useDebounce(query, 300)

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

  // A fresh dialog each time: a selection left over from the last open would be
  // added to a document the user has since changed.
  useEffect(() => {
    if (open) {
      setPicked(new Map())
      setQuery('')
    }
  }, [open])

  const chosen = useMemo(() => [...picked.values()], [picked])

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
      title="Add multiple items"
      description={`Availability shown for ${warehouseName || 'all warehouses'}.`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={chosen.length === 0}
            onClick={() => {
              onAdd(chosen)
              onClose()
            }}
          >
            Add {chosen.length || ''} {chosen.length === 1 ? 'item' : 'items'}
          </Button>
        </>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <Input
          size="md"
          leadingIcon={Search}
          value={query}
          autoFocus
          placeholder="Search by item name, SKU or barcode…"
          aria-label="Search items"
          onChange={(e) => setQuery(e.target.value)}
        />

        {error ? (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50/60 p-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-gray-200">
          {loading && rows.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height="h-10" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-500">No matching items.</p>
          ) : (
            <ul>
              {rows.map((row) => {
                const on = picked.has(row.item_id)
                return (
                  <li key={row.item_id} className="border-b border-gray-100 last:border-b-0">
                    <label
                      className={cx(
                        'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
                        on ? 'bg-primary-light/50' : 'hover:bg-gray-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(row)}
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{row.item_name}</span>
                        <span className="block truncate text-[11px] text-gray-500">
                          {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                          {Number(row.track_batch) === 1 ? ' · batch' : ''}
                          {Number(row.track_serial) === 1 ? ' · serial' : ''}
                        </span>
                      </span>
                      {row.stock ? (
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-bold tabular-nums text-gray-900">
                            {formatQty(row.stock.available)}
                          </span>
                          <span className="block text-[10px] text-gray-500">available</span>
                        </span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <p className="text-xs text-gray-500">
          {chosen.length > 0 ? `${chosen.length} selected.` : 'Select the items to issue; quantities are entered on the lines.'}
        </p>
      </div>
    </Modal>
  )
}

export default AddMultipleItemsDialog
