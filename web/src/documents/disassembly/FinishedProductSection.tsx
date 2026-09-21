import { memo, useCallback } from 'react'
import { ArrowDownToLine, Hash, PackageSearch, Plus, Trash2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import { AvailabilityCell, CellMessage, NumberCell, PickedItemCell } from './LineCells'
import type { DisassemblyIssue } from './validation'

export interface FinishedProductSectionProps {
  lines: LineDraft[]
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  availability: Record<string, AvailabilityCheckResult>
  checkingAvailability: boolean
  fieldErrors: Map<string, DisassemblyIssue>
  /** Bills of materials found for the picked parent, null while unknown. */
  bomCount: number | null
  onLoadBom: () => void
  onUpdate: (key: string, patch: Partial<LineDraft>) => void
  onPick: (key: string, row: ItemSearchRow) => void
  onClear: (key: string) => void
  onAdd: () => void
  onRemove: (key: string) => void
  disabled?: boolean
}

/*
 * One column template for the header and every row, so they cannot drift apart.
 *
 * The `minmax()` minimums are what the table can shrink to before the wrapper below starts
 * scrolling sideways — a line table has to stay readable, and squeezing a warehouse dropdown to
 * 60px helps nobody. `SCROLL_MIN` is their sum plus the gaps.
 */
const GRID = 'grid items-start gap-2 grid-cols-[1.75rem_minmax(11rem,2.4fr)_minmax(7.5rem,1.1fr)_minmax(7rem,1fr)_minmax(5.5rem,0.9fr)_minmax(4rem,0.6fr)_minmax(5rem,0.7fr)_2rem]'
const SCROLL_MIN = 'min-w-[47rem]'

function errorOf(errors: Map<string, DisassemblyIssue>, key: string, field: string): DisassemblyIssue | undefined {
  return errors.get(`${key}:${field}`)
}

interface RowProps extends Omit<FinishedProductSectionProps, 'lines' | 'onAdd' | 'bomCount' | 'onLoadBom'> {
  line: LineDraft
  index: number
  removable: boolean
}

const FinishedRow = memo(function FinishedRow({
  line,
  index,
  warehouses,
  defaultWarehouseId,
  availability,
  checkingAvailability,
  fieldErrors,
  onUpdate,
  onPick,
  onClear,
  onRemove,
  disabled,
  removable,
}: RowProps) {
  const update = useCallback((patch: Partial<LineDraft>) => onUpdate(line.key, patch), [onUpdate, line.key])
  const result = availability[line.key]
  const itemError = errorOf(fieldErrors, line.key, 'item')
  const qtyError = errorOf(fieldErrors, line.key, 'qty')
  const whError = errorOf(fieldErrors, line.key, 'warehouse')
  const batchError = errorOf(fieldErrors, line.key, 'batch')
  const serialError = errorOf(fieldErrors, line.key, 'serials')
  const unitError = errorOf(fieldErrors, line.key, 'unit')
  const warehouseId = line.warehouse_id ?? defaultWarehouseId
  const need = lineBaseQty(line)

  const availState = !line.item_id || need <= 0 ? 'idle' : result ? (result.ok ? 'ok' : 'short') : checkingAvailability ? 'checking' : 'idle'

  return (
    <div className={cx(GRID, 'border-t border-gray-100 px-3 py-2.5 first:border-t-0')}>
      <div className="pt-2 text-xs font-medium tabular-nums text-gray-400">{index + 1}</div>

      <div className="min-w-0">
        {line.item_id === null ? (
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={warehouseId}
            onPick={(row) => onPick(line.key, row)}
            onClear={() => onClear(line.key)}
            disabled={disabled}
            invalid={Boolean(itemError)}
          />
        ) : (
          <PickedItemCell line={line} tone="primary" onChangeItem={() => onClear(line.key)} disabled={disabled} />
        )}
        {itemError ? <CellMessage message={itemError.message} severity={itemError.severity} /> : null}
      </div>

      <div className="min-w-0">
        {line.item_id && line.track_batch ? (
          <BatchPicker
            itemId={line.item_id}
            warehouseId={warehouseId}
            value={line.batch_id}
            onChange={(b) => update({ batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null, serials: [] })}
            allowCreate={false}
            disabled={disabled}
            variant="field"
            invalid={Boolean(batchError)}
          />
        ) : (
          <span className="inline-flex h-8 items-center text-xs text-gray-400">Not batch-tracked</span>
        )}
        {line.item_id && line.track_serial ? (
          <div className="mt-1.5">
            <SerialPicker
              itemId={line.item_id}
              itemName={line.item_name}
              warehouseId={warehouseId}
              batchId={line.batch_id}
              direction="out"
              value={line.serials}
              onChange={(serials) => update({ serials })}
              requiredCount={need}
              disabled={disabled}
              renderTrigger={(open, state) => (
                <Button
                  size="xs"
                  variant={state.mismatch ? 'danger' : 'secondary'}
                  icon={Hash}
                  onClick={open}
                  disabled={disabled}
                  className="w-full justify-start"
                >
                  Serials {state.count}
                  {state.required > 0 ? ` / ${state.required}` : ''}
                </Button>
              )}
            />
          </div>
        ) : null}
        {batchError ? <CellMessage message={batchError.message} severity={batchError.severity} /> : null}
        {serialError ? <CellMessage message={serialError.message} severity={serialError.severity} /> : null}
      </div>

      <div className="min-w-0">
        <WarehouseSelect
          value={line.warehouse_id}
          onChange={(id) => update({ warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
          warehouses={warehouses}
          disabled={disabled}
          invalid={Boolean(whError)}
          variant="field"
        />
        {whError ? <CellMessage message={whError.message} severity={whError.severity} /> : null}
      </div>

      <div className="min-w-0">
        <NumberCell
          value={line.qty}
          onChange={(v) => update({ qty: v })}
          ariaLabel={`Quantity to disassemble, row ${index + 1}`}
          invalid={qtyError?.severity === 'error'}
          disabled={disabled}
          placeholder="0.00"
        />
        {qtyError ? <CellMessage message={qtyError.message} severity={qtyError.severity} /> : null}
      </div>

      <div className="min-w-0">
        {line.units.length > 0 ? (
          <Select
            className="h-8"
            value={line.unit_id ?? ''}
            disabled={disabled}
            invalid={Boolean(unitError)}
            aria-label={`Unit, row ${index + 1}`}
            onChange={(e) => update({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">—</option>
            {line.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="inline-flex h-8 items-center text-xs text-gray-400">—</span>
        )}
      </div>

      <div className="min-w-0 pt-1.5 text-right">
        <AvailabilityCell
          state={availState}
          value={result ? formatQty(result.available) : '—'}
          short={result && !result.ok ? formatQty(shortBy(result)) : undefined}
          title="Available now in the selected warehouse and batch. A back-dated document is re-checked against the same rule when it posts."
        />
      </div>

      <div className="pt-1">
        <button
          type="button"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300/50 disabled:opacity-40"
          onClick={() => onRemove(line.key)}
          disabled={disabled || !removable}
          aria-label={`Remove finished product row ${index + 1}`}
          title={removable ? 'Remove row' : 'A disassembly needs a finished product'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})

/**
 * What is consumed. One visual language for the whole section — the arrow, the word "Consumed"
 * and the tint all say the same thing, so the old per-row "Dir." dropdown is gone: the operation
 * decides the direction, not the user.
 */
export function FinishedProductSection(props: FinishedProductSectionProps) {
  const { lines, bomCount, onLoadBom, onAdd, disabled } = props
  const hasItem = lines.some((l) => l.item_id !== null)
  const removable = lines.length > 1

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200" aria-labelledby="finished-heading">
      <header className="flex flex-wrap items-center gap-2 border-b border-emerald-100 bg-emerald-50/70 px-3 py-2">
        <ArrowDownToLine className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
        <h3 id="finished-heading" className="text-[13px] font-bold text-emerald-900">
          Finished product
        </h3>
        <span className="text-[12px] text-emerald-700">to disassemble</span>
        <Badge tone="success" size="xs" className="ml-auto">
          Stock out
        </Badge>
      </header>

      {!hasItem ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-dashed border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-500">
          <PackageSearch className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          Select the finished product you want to disassemble — search by name, SKU or barcode.
        </div>
      ) : null}

      <div className="overflow-x-auto scrollbar-thin">
        <div className={SCROLL_MIN}>
          <div className={cx(GRID, 'bg-gray-50/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500')}>
            <span>#</span>
            <span>Item (finished product)</span>
            <span>Batch / serial</span>
            <span>Warehouse</span>
            <span>Qty to disassemble</span>
            <span>Unit</span>
            <span className="text-right">Available</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="bg-white">
            {lines.map((line, i) => (
              <FinishedRow key={line.key} line={line} index={i} removable={removable} {...props} />
            ))}
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2">
        <Button variant="secondary" size="xs" icon={Plus} onClick={onAdd} disabled={disabled}>
          Add finished product
        </Button>
        {hasItem && bomCount !== null ? (
          bomCount > 0 ? (
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
              <Badge tone="primary" size="xs">
                {bomCount} bill{bomCount === 1 ? '' : 's'} of materials
              </Badge>
              <Button variant="outline" size="xs" onClick={onLoadBom} disabled={disabled}>
                Load components
              </Button>
            </span>
          ) : (
            <span className="text-[12px] text-gray-500">No bill of materials for this item. Add the recovered components manually.</span>
          )
        ) : null}
      </footer>
    </section>
  )
}
