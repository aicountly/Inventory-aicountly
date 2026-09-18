import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../components/Modal'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { cx } from '../ui/cx'
import { formatQty } from '../utils/format'

export interface PickedLine {
  row: ItemSearchRow
  qty: string
}

interface AddMultipleItemsModalProps {
  open: boolean
  onClose: () => void
  /** Scopes the availability shown and the availability the search itself prefers. */
  warehouseId: number | null
  onAdd: (rows: PickedLine[]) => void
}

/** Search, multi-select and set a quantity for each — then append them all as lines in one go. */
export function AddMultipleItemsModal({ open, onClose, warehouseId, onAdd }: AddMultipleItemsModalProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Map<number, PickedLine>>(new Map())
  const debounced = useDebounce(query, 300)

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 40, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, warehouseId])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setRows([])
      setPicked(new Map())
    }
  }, [open])

  const toggle = (row: ItemSearchRow) => {
    setPicked((m) => {
      const next = new Map(m)
      if (next.has(row.item_id)) next.delete(row.item_id)
      else next.set(row.item_id, { row, qty: '1' })
      return next
    })
  }

  const setQty = (itemId: number, qty: string) => {
    setPicked((m) => {
      const existing = m.get(itemId)
      if (!existing) return m
      const next = new Map(m)
      next.set(itemId, { ...existing, qty })
      return next
    })
  }

  const selectedCount = picked.size
  const invalidQty = useMemo(() => [...picked.values()].some((p) => !(Number(p.qty) > 0)), [picked])

  const confirm = () => {
    onAdd([...picked.values()])
    onClose()
  }

  return (
    <Modal
      open={open}
      title="Add multiple items"
      description="Search, select and set a quantity for each — they'll be appended as new lines."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} disabled={selectedCount === 0 || invalidQty}>
            Add {selectedCount || ''} selected item{selectedCount === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          leadingIcon={Search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item by name, SKU or barcode…"
          aria-label="Search items"
          autoFocus
        />
        <div className="max-h-[24rem] overflow-y-auto rounded-lg border border-gray-200">
          {loading ? <div className="px-3 py-3 text-sm text-gray-500">Searching…</div> : null}
          {!loading && rows.length === 0 ? <div className="px-3 py-3 text-sm text-gray-500">No matching items.</div> : null}
          {rows.map((row, i) => {
            const sel = picked.get(row.item_id)
            const stock = row.stock
            return (
              <div key={row.item_id} className={cx('flex items-center gap-3 px-3 py-2', i > 0 && 'border-t border-gray-100', sel && 'bg-primary-light/30')}>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary/30"
                  checked={Boolean(sel)}
                  onChange={() => toggle(row)}
                  aria-label={`Select ${row.item_name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{row.print_name || row.item_name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                    {stock ? ` · avail ${formatQty(stock.available)}` : ''}
                    {row.track_batch ? ' · batch' : ''}
                    {row.track_serial ? ' · serial' : ''}
                  </p>
                </div>
                {sel ? (
                  <Input
                    className="w-20 shrink-0 text-right tabular-nums"
                    inputMode="decimal"
                    value={sel.qty}
                    invalid={!(Number(sel.qty) > 0)}
                    onChange={(e) => setQty(row.item_id, e.target.value)}
                    aria-label={`Quantity for ${row.item_name}`}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
