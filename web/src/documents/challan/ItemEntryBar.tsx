import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, FileUp, Hash, Layers, ListPlus, Plus, ScanBarcode, X } from 'lucide-react'
import { isAbortError } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import { lookupApi } from '../../services/lookupApi'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import type { UnitOption } from '../formModel'
import { ChallanWarehouseSelect } from './fields'
import { ItemSearchInput, itemSubtitle } from './ItemSearchInput'

/** One line's worth of entry, as the bar hands it to the form. */
export interface EntryAdd {
  item: ItemSearchRow
  units: UnitOption[]
  unitId: number | null
  warehouseId: number | null
  batchId: number | null
  batchNo: string | null
  batchExpiry: string | null
  batchAvailable: number | null
  qty: string
}

interface ItemEntryBarProps {
  warehouses: FormOptionWarehouse[]
  /** Header default — pre-fills the bar's warehouse. */
  defaultWarehouseId: number | null
  disabled?: boolean
  scan: boolean
  onScanChange: (scan: boolean) => void
  onAdd: (entry: EntryAdd) => void
  onScanMiss: (code: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  onOpenMultiItem: () => void
  onOpenPaste: () => void
  onOpenImport: () => void
}

/**
 * The fast-entry row above the lines table: search (or scan) an item, confirm
 * the warehouse, batch, unit and quantity, add. Enter from the quantity box
 * adds the line and puts the cursor back in the search box, which is the loop a
 * stores clerk spends the whole document in.
 */
export function ItemEntryBar({
  warehouses,
  defaultWarehouseId,
  disabled,
  scan,
  onScanChange,
  onAdd,
  onScanMiss,
  searchRef,
  onOpenMultiItem,
  onOpenPaste,
  onOpenImport,
}: ItemEntryBarProps) {
  const [item, setItem] = useState<ItemSearchRow | null>(null)
  const [units, setUnits] = useState<UnitOption[]>([])
  const [unitId, setUnitId] = useState<number | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultWarehouseId)
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [batchId, setBatchId] = useState<number | null>(null)
  const [qty, setQty] = useState('1')
  const qtyRef = useRef<HTMLInputElement>(null)

  // The bar follows the header default until the user overrides it for a line.
  const touchedWarehouse = useRef(false)
  useEffect(() => {
    if (!touchedWarehouse.current) setWarehouseId(defaultWarehouseId)
  }, [defaultWarehouseId])

  const tracksBatch = item !== null && Number(item.track_batch) === 1
  const tracksSerial = item !== null && Number(item.track_serial) === 1

  useEffect(() => {
    if (!item || !tracksBatch) {
      setBatches([])
      setBatchId(null)
      return undefined
    }
    const controller = new AbortController()
    setBatchesLoading(true)
    lookupApi
      .batches(item.item_id, { warehouseId, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setBatches(res.data)
        setBatchesLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setBatches([])
        setBatchesLoading(false)
      })
    return () => controller.abort()
  }, [item, tracksBatch, warehouseId])

  const reset = () => {
    setItem(null)
    setUnits([])
    setUnitId(null)
    setBatches([])
    setBatchId(null)
    setQty('1')
  }

  const pick = (row: ItemSearchRow) => {
    const opts = unitOptionsFrom(row)
    const def = opts.find((u) => u.is_default) ?? opts[0]
    setItem(row)
    setUnits(opts)
    setUnitId(def?.unit_id ?? row.unit_id ?? null)
    setBatchId(null)
    if (!touchedWarehouse.current && row.default_warehouse_id) setWarehouseId(row.default_warehouse_id)
    window.setTimeout(() => {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }, 0)
  }

  const commit = () => {
    if (!item) return
    const n = Number(qty)
    if (!Number.isFinite(n) || n <= 0) {
      qtyRef.current?.focus()
      return
    }
    const batch = batches.find((b) => b.batch_id === batchId) ?? null
    onAdd({
      item,
      units,
      unitId,
      warehouseId,
      batchId,
      batchNo: batch?.batch_no ?? null,
      batchExpiry: batch?.expiry_date ?? null,
      batchAvailable: batch?.stock ? Number(batch.stock.available) : null,
      qty,
    })
    reset()
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }

  const availability = item?.stock?.available

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2.5">
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-4 xl:col-span-5">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Add items</label>
          <div className="flex items-start gap-2">
            <Button
              variant={scan ? 'primary' : 'secondary'}
              size="sm"
              icon={ScanBarcode}
              aria-pressed={scan}
              title={scan ? 'Scanner mode is on — Enter adds the scanned item' : 'Scanner mode: Enter adds the scanned code'}
              disabled={disabled}
              onClick={() => {
                onScanChange(!scan)
                window.setTimeout(() => searchRef.current?.focus(), 0)
              }}
              className="shrink-0"
              aria-label="Scanner mode"
            />
            {item ? (
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900" title={item.print_name || item.item_name}>
                  {item.print_name || item.item_name}
                </span>
                {itemSubtitle(item) ? <span className="hidden shrink-0 truncate text-[11px] text-gray-500 sm:block">{itemSubtitle(item)}</span> : null}
                {tracksBatch ? <Layers className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Batch tracked" /> : null}
                {tracksSerial ? <Hash className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-label="Serial tracked" /> : null}
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Clear item"
                  onClick={() => {
                    reset()
                    window.setTimeout(() => searchRef.current?.focus(), 0)
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <ItemSearchInput
                className="min-w-0 flex-1"
                warehouseId={warehouseId}
                onPick={pick}
                disabled={disabled}
                inputRef={searchRef}
                scan={scan}
                onScanMiss={onScanMiss}
                placeholder={scan ? 'Scan a barcode or type a SKU…' : 'Search item by name, SKU or barcode…'}
              />
            )}
          </div>
          <div className="ml-10 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline disabled:text-gray-400 disabled:no-underline" onClick={onOpenMultiItem} disabled={disabled}>
              <ListPlus className="h-3 w-3" aria-hidden /> Add multiple items
            </button>
            <span className="text-gray-300">|</span>
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline disabled:text-gray-400 disabled:no-underline" onClick={onOpenPaste} disabled={disabled}>
              <ClipboardPaste className="h-3 w-3" aria-hidden /> Paste
            </button>
            <span className="text-gray-300">|</span>
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline disabled:text-gray-400 disabled:no-underline" onClick={onOpenImport} disabled={disabled}>
              <FileUp className="h-3 w-3" aria-hidden /> Import from CSV
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-800" htmlFor="entry-warehouse">
            Warehouse
          </label>
          <ChallanWarehouseSelect
            id="entry-warehouse"
            value={warehouseId}
            warehouses={warehouses}
            disabled={disabled}
            emptyLabel="Select…"
            onChange={(id) => {
              touchedWarehouse.current = true
              setWarehouseId(id)
              setBatchId(null)
            }}
          />
        </div>

        <div className="lg:col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-800" htmlFor="entry-batch">
            Batch
          </label>
          {tracksBatch ? (
            <Select id="entry-batch" value={batchId ?? ''} disabled={disabled} onChange={(e) => setBatchId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">{batchesLoading ? 'Loading…' : batches.length === 0 ? 'No batches here' : 'Select batch…'}</option>
              {batches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.batch_no}
                  {b.expiry_date ? ` · exp ${formatDate(b.expiry_date)}` : ''}
                  {b.stock ? ` · ${formatQty(b.stock.available)} avail` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Select id="entry-batch" value="" disabled aria-label="Batch (not tracked for this item)">
              <option value="">—</option>
            </Select>
          )}
        </div>

        <div className="lg:col-span-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-800" htmlFor="entry-unit">
            Unit
          </label>
          <Select id="entry-unit" value={unitId ?? ''} disabled={disabled || units.length === 0} onChange={(e) => setUnitId(e.target.value === '' ? null : Number(e.target.value))}>
            {units.length === 0 ? <option value="">—</option> : null}
            {units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
              </option>
            ))}
          </Select>
        </div>

        <div className="lg:col-span-1">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-emerald-800" htmlFor="entry-qty">
            Qty
          </label>
          <Input
            id="entry-qty"
            ref={qtyRef}
            inputMode="decimal"
            value={qty}
            disabled={disabled || item === null}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
            className="text-right tabular-nums"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-2 xl:col-span-1">
          <Button variant="primary" size="sm" icon={Plus} block disabled={disabled || item === null} onClick={commit}>
            Add
          </Button>
        </div>
      </div>

      {item ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-emerald-100 pt-2 text-[11px] text-gray-600">
          <Badge tone={(availability ?? 0) > 0 ? 'success' : 'warning'} size="xs" dot>
            {availability === undefined ? 'Availability unknown' : `${formatQty(availability)} available`}
          </Badge>
          {tracksSerial ? <span className={cx('text-violet-700')}>Serial-tracked — pick serial numbers on the line after adding.</span> : null}
          {tracksBatch && batchId === null ? <span className="text-amber-700">Batch-tracked — select a batch before posting.</span> : null}
        </div>
      ) : null}
    </div>
  )
}
