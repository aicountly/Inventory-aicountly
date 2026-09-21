import { Trash2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import { StockChip } from './StockChip'

/** Two letters of the item name — Items carry no image, so this is the honest avatar. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export interface MaterialIssueLineRowProps {
  line: LineDraft
  index: number
  /** Falls back to this when the line has no warehouse of its own. */
  defaultWarehouseId: number | null
  warehouses: FormOptionWarehouse[]
  availability: AvailabilityCheckResult | undefined
  checking: boolean
  /** The negative-stock block named this line. */
  offending: boolean
  /** A validation message for this line, shown under the item. */
  error?: string
  disabled?: boolean
  /** Focus the item search as soon as the row mounts (new line, scan, Enter). */
  autoFocus?: boolean
  onChange: (patch: Partial<LineDraft>) => void
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  onRemove: () => void
  /** Enter from the quantity box — the fast-entry jump to the next line. */
  onQtyEnter: () => void
}

const CELL = 'px-2 py-2 align-middle'

export function MaterialIssueLineRow({
  line,
  index,
  defaultWarehouseId,
  warehouses,
  availability,
  checking,
  offending,
  error,
  disabled = false,
  autoFocus = false,
  onChange,
  onPick,
  onClear,
  onRemove,
  onQtyEnter,
}: MaterialIssueLineRowProps) {
  const warehouseId = line.warehouse_id ?? defaultWarehouseId
  const requiredSerials = lineBaseQty(line)
  const serialsOff = line.track_serial && requiredSerials > 0 && line.serials.length !== requiredSerials

  const onQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    onQtyEnter()
  }

  return (
    <tr
      // The lines card addresses a row by this when Enter jumps out of a
      // quantity box; the shared pickers expose no imperative handle.
      data-line-key={line.key}
      className={cx(
        AIC,
        'group border-b border-gray-100 transition-colors last:border-b-0',
        offending ? 'bg-red-50/60' : 'hover:bg-gray-50/70',
      )}
    >
      <td className={cx(CELL, 'w-8 text-center text-xs font-medium tabular-nums text-gray-400')}>{index + 1}</td>

      <td className={cx(CELL, 'min-w-[15rem]')}>
        {line.item_id === null ? (
          // The shared typeahead: debounced `items/search?with_stock=1`, scoped
          // to this line's warehouse, with its own arrow / Enter / Escape keys.
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={warehouseId}
            onPick={onPick}
            onClear={onClear}
            disabled={disabled}
            autoFocus={autoFocus}
            invalid={Boolean(error)}
          />
        ) : (
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-light text-[11px] font-bold text-primary"
              aria-hidden
            >
              {initials(line.item_name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-gray-900" title={line.item_name}>
                {line.item_name}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="truncate">{line.item_sku || '—'}</span>
                {line.track_batch ? <span className="rounded bg-sky-50 px-1 font-medium text-sky-700">batch</span> : null}
                {line.track_serial ? <span className="rounded bg-violet-50 px-1 font-medium text-violet-700">serial</span> : null}
              </div>
            </div>
            {!disabled ? (
              <button
                type="button"
                onClick={onClear}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-700 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
              >
                Change
              </button>
            ) : null}
          </div>
        )}
        {error ? <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p> : null}
      </td>

      <td className={cx(CELL, 'w-[9.5rem]')}>
        <WarehouseSelect
          value={line.warehouse_id}
          warehouses={warehouses}
          disabled={disabled}
          emptyLabel="(default)"
          // Batch and serials belong to the warehouse they were picked in; moving
          // the line elsewhere has to drop both or the issue names stock that is
          // not there.
          onChange={(id) => onChange({ warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
        />
      </td>

      <td className={cx(CELL, 'w-[11rem]')}>
        {line.item_id && line.track_batch ? (
          <BatchPicker
            itemId={line.item_id}
            warehouseId={warehouseId}
            value={line.batch_id}
            // An issue never registers a batch: the stock it takes out already
            // belongs to one.
            allowCreate={false}
            disabled={disabled}
            onChange={(b) => onChange({ batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null, serials: [] })}
          />
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      <td className={cx(CELL, 'w-[9rem]')}>
        {line.item_id && line.track_serial ? (
          <div className={serialsOff ? 'rounded-lg ring-1 ring-amber-300' : undefined}>
            <SerialPicker
              itemId={line.item_id}
              itemName={line.item_name}
              warehouseId={warehouseId}
              batchId={line.batch_id}
              direction="out"
              value={line.serials}
              requiredCount={requiredSerials}
              disabled={disabled}
              onChange={(serials) => onChange({ serials })}
            />
          </div>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      <td className={cx(CELL, 'w-[6.5rem]')}>
        <input
          className="input"
          inputMode="decimal"
          aria-label={`Quantity for line ${index + 1}`}
          value={line.qty}
          disabled={disabled}
          onKeyDown={onQtyKeyDown}
          onChange={(e) => onChange({ qty: e.target.value })}
        />
      </td>

      <td className={cx(CELL, 'w-[7rem]')}>
        {line.units.length > 0 ? (
          <select
            className="select"
            aria-label={`Unit for line ${index + 1}`}
            value={line.unit_id ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
          >
            {line.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      <td className={cx(CELL, 'w-[7rem]')}>
        <StockChip result={availability} checking={checking} idle={!line.item_id} />
      </td>

      <td className={cx(CELL, 'min-w-[9rem]')}>
        <input
          className="input"
          aria-label={`Remarks for line ${index + 1}`}
          value={line.description}
          placeholder="Optional"
          maxLength={255}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </td>

      <td className={cx(CELL, 'w-12 text-center')}>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove line ${index + 1}`}
          title="Remove line"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </td>
    </tr>
  )
}

export default MaterialIssueLineRow
