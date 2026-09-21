import { useEffect, useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Badge } from '../../ui/Badge'
import { AIC, cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'
import { WarehouseField } from './WarehouseField'
import { DirectionSelect } from './DirectionSelect'
import type { FormOptionWarehouse } from '../../services/items'

interface MultiItemPickerProps {
  open: boolean
  onClose: () => void
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  /** Insert one line per selected item, all sharing the chosen warehouse and direction. */
  onAdd: (items: ItemSearchRow[], warehouseId: number | null, direction: 'in' | 'out') => void
}

/**
 * Add many items in one pass.
 *
 * The warehouse and direction are chosen once at the top, because the reason
 * anyone opens this dialog is that twenty lines share them — filling them in
 * twenty times on the grid is the work this is here to remove.
 */
export function MultiItemPicker({ open, onClose, warehouses, defaultWarehouseId, onAdd }: MultiItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [selected, setSelected] = useState<ItemSearchRow[]>([])
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounced = useDebounce(query, 300)

  useEffect(() => {
    if (!open) return
    setWarehouseId(defaultWarehouseId)
  }, [open, defaultWarehouseId])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 40, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(errorMessage(err, 'Could not search items.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, debounced, warehouseId])

  const close = () => {
    setQuery('')
    setSelected([])
    onClose()
  }

  const toggle = (row: ItemSearchRow) => {
    setSelected((s) => (s.some((x) => x.item_id === row.item_id) ? s.filter((x) => x.item_id !== row.item_id) : [...s, row]))
  }

  return (
    <Modal
      open={open}
      title="Add multiple items"
      description="Pick several items at once. Each becomes its own line, ready for a quantity."
      onClose={close}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              onAdd(selected, warehouseId, direction)
              close()
            }}
          >
            Add {selected.length} item{selected.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className={cx(AIC, 'space-y-3')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Search</span>
            <Input
              autoFocus
              size="md"
              placeholder="Name, SKU or barcode…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Warehouse for these lines</span>
            <WarehouseField size="md" value={warehouseId} onChange={setWarehouseId} warehouses={warehouses} aria-label="Warehouse for the added lines" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Direction</span>
            <DirectionSelect value={direction} onChange={(d) => setDirection(d ?? 'out')} aria-label="Direction for the added lines" />
          </label>
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-gray-200">
          {loading && rows.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Searching…
            </p>
          ) : null}
          {!loading && rows.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">No items match that search.</p>
          ) : null}
          {rows.map((row) => {
            const on = selected.some((x) => x.item_id === row.item_id)
            return (
              <label
                key={row.item_id}
                className={cx(
                  'flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-b-0',
                  on ? 'bg-primary-light/50' : 'hover:bg-gray-50',
                )}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(row)} />
                <Package className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">{row.print_name || row.item_name}</span>
                  <span className="block truncate text-[10px] text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                {Number(row.track_batch) === 1 ? <Badge size="xs" tone="info">Batch</Badge> : null}
                {Number(row.track_serial) === 1 ? <Badge size="xs" tone="violet">Serial</Badge> : null}
                {row.stock ? (
                  <span className={cx('shrink-0 text-[11px] font-semibold tabular-nums', row.stock.available > 0 ? 'text-emerald-700' : 'text-red-600')}>
                    {formatQty(row.stock.available)}
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>

        {selected.length > 0 ? (
          <p className="text-[11px] text-gray-500">
            {selected.length} selected. Quantities are entered on the grid after they are added.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
