import { useEffect, useMemo, useState } from 'react'
import { ListPlus, Search } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { FormField } from '../../ui/shell/FormSectionCard'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty, toNumber } from '../../utils/format'
import { WarehouseSelect } from '../WarehouseSelect'
import { unitOptionsFrom } from '../LineEditor'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

export interface MultiItemPickerDialogProps {
  open: boolean
  spec: DocumentTypeSpec
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  onClose: () => void
  onAdd: (lines: LineDraft[]) => void
}

interface Chosen {
  row: ItemSearchRow
  qty: string
}

/**
 * Add several components in one pass.
 *
 * The same `GET /v1/items/search?with_stock=1` the row typeahead uses, so what is on hand is
 * beside each candidate while it is being chosen — the number that decides whether the row is
 * worth adding at all. Nothing is added until the button is pressed, and the chosen set survives
 * a change of search term, which is the whole reason this is a dialog and not five row lookups.
 */
export function MultiItemPickerDialog({
  open,
  spec,
  warehouses,
  defaultWarehouseId,
  onClose,
  onAdd,
}: MultiItemPickerDialogProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Record<number, Chosen>>({})
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const debounced = useDebounce(query, 300)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setChosen({})
    setError(null)
    setWarehouseId(defaultWarehouseId)
  }, [open, defaultWarehouseId])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 25, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError('Unable to load items. Try again.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, debounced, warehouseId])

  const chosenList = useMemo(() => Object.values(chosen), [chosen])

  const toggle = (row: ItemSearchRow) =>
    setChosen((prev) => {
      const next = { ...prev }
      if (next[row.item_id]) delete next[row.item_id]
      else next[row.item_id] = { row, qty: '1' }
      return next
    })

  const setQty = (itemId: number, qty: string) =>
    setChosen((prev) => (prev[itemId] ? { ...prev, [itemId]: { ...prev[itemId], qty } } : prev))

  const add = () => {
    const lines = chosenList.map(({ row, qty }) => {
      const units = unitOptionsFrom(row)
      const def = units.find((u) => u.is_default) ?? units[0]
      return newLine(spec, {
        item_id: row.item_id,
        item_name: row.print_name || row.item_name,
        item_sku: row.item_sku,
        track_batch: Number(row.track_batch) === 1,
        track_serial: Number(row.track_serial) === 1,
        units,
        unit_id: def?.unit_id ?? row.unit_id ?? null,
        warehouse_id: warehouseId ?? row.default_warehouse_id ?? defaultWarehouseId ?? null,
        direction: 'out',
        qty: (toNumber(qty) ?? 0) > 0 ? String(toNumber(qty)) : '1',
      })
    })
    onAdd(lines)
  }

  return (
    <Modal
      open={open}
      title="Add multiple components"
      description="Search, tick what this assembly consumes, and set each quantity."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={ListPlus} onClick={add} disabled={chosenList.length === 0}>
            Add {chosenList.length || ''} component{chosenList.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Search" htmlFor="multi-item-query">
            <Input
              id="multi-item-query"
              leadingIcon={Search}
              value={query}
              placeholder="Name, SKU or barcode…"
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </FormField>
          <FormField label="Warehouse for these rows" htmlFor="multi-item-wh">
            <WarehouseSelect
              id="multi-item-wh"
              variant="field"
              value={warehouseId}
              onChange={setWarehouseId}
              warehouses={warehouses}
              emptyLabel="Use assembly warehouse"
            />
          </FormField>
        </div>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 scrollbar-thin">
          {loading && rows.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">Searching…</p>
          ) : null}
          {!loading && rows.length === 0 && !error ? (
            <p className="px-3 py-3 text-xs text-gray-500">No matching items.</p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => {
              const picked = chosen[row.item_id]
              return (
                <li key={row.item_id} className="flex items-center gap-2.5 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`multi-item-${row.item_id}`}
                    className="h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                    checked={Boolean(picked)}
                    onChange={() => toggle(row)}
                  />
                  <label htmlFor={`multi-item-${row.item_id}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate text-sm font-medium text-gray-900">{row.item_name}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                      {row.stock ? ` · avail ${formatQty(row.stock.available)}` : ''}
                      {row.track_batch ? ' · batch' : ''}
                      {row.track_serial ? ' · serial' : ''}
                    </span>
                  </label>
                  <Input
                    inputMode="decimal"
                    className="w-20 text-right tabular-nums"
                    aria-label={`Quantity of ${row.item_name}`}
                    value={picked?.qty ?? ''}
                    placeholder="Qty"
                    disabled={!picked}
                    onChange={(e) => setQty(row.item_id, e.target.value)}
                  />
                </li>
              )
            })}
          </ul>
        </div>

        {chosenList.length > 0 ? (
          <p className="text-xs text-gray-600">
            {chosenList.length} item{chosenList.length === 1 ? '' : 's'} chosen. They stay chosen while you search
            again.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

export default MultiItemPickerDialog
