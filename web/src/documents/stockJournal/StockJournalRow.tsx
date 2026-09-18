import { AlertTriangle, Info, Sparkles, Trash2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty, toNumber } from '../../utils/format'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import type { LineDraft } from '../formModel'
import { lineAmount, lineBaseQty } from '../formModel'
import { BatchSelect } from './BatchSelect'
import { DirectionSelect } from './DirectionSelect'
import { ItemSearchSelect } from './ItemSearchSelect'
import { SerialSelect } from './SerialSelect'
import { WarehouseField } from './WarehouseField'
import type { ColumnVisibility, JournalError, JournalWarning } from './model'

export interface StockJournalRowProps {
  line: LineDraft
  index: number
  columns: ColumnVisibility
  warehouses: readonly FormOptionWarehouse[]
  availability: AvailabilityCheckResult | undefined
  checking: boolean
  errors: readonly JournalError[]
  warnings: readonly JournalWarning[]
  usedSerialIds: ReadonlySet<number>
  disabled?: boolean
  autoFocus?: boolean
  onPatch: (patch: Partial<LineDraft>) => void
  onPickItem: (row: ItemSearchRow) => void
  onClearItem: () => void
  onWarehouseChange: (id: number | null) => void
  onRemove: () => void
}

const CELL = 'px-2 py-1.5 align-top'

/**
 * One line of the journal.
 *
 * Each row owns its own pickers, and the messages about it sit under it rather
 * than in a banner at the bottom of the page — on a forty-line count, "line 27
 * is short by 3" is only useful if it is next to line 27.
 */
export function StockJournalRow({
  line,
  index,
  columns,
  warehouses,
  availability,
  checking,
  errors,
  warnings,
  usedSerialIds,
  disabled,
  autoFocus,
  onPatch,
  onPickItem,
  onClearItem,
  onWarehouseChange,
  onRemove,
}: StockJournalRowProps) {
  const hasError = errors.length > 0
  const blocking = warnings.some((w) => w.level === 'blocking')
  const warning = warnings.some((w) => w.level === 'warning')
  const generated = line.origin === 'bom'
  const amount = lineAmount(line.qty, line.rate)
  const baseQty = lineBaseQty(line)
  const messages = [...errors.map((e) => ({ level: 'blocking' as const, message: e.message })), ...warnings.map((w) => ({ level: w.level, message: w.message }))]
  const showBatch = line.item_id !== null && line.track_batch
  const showSerial = line.item_id !== null && line.track_serial && line.direction !== null

  const availabilityCell = () => {
    if (line.direction !== 'out' || !line.item_id) return <span className="text-[11px] text-gray-400">—</span>
    if (!availability) return <span className="text-[11px] text-gray-400">{checking ? 'checking…' : '—'}</span>
    return availability.ok ? (
      <span className="text-[11px] font-medium text-emerald-700">{formatQty(availability.available)} avail</span>
    ) : (
      <span className="text-[11px] font-semibold text-red-600">short {formatQty(shortBy(availability))}</span>
    )
  }

  const colSpan =
    5 + // #, item, warehouse, direction, qty
    (columns.batch ? 1 : 0) +
    (columns.unit ? 1 : 0) +
    (columns.rate ? 1 : 0) +
    (columns.amount ? 1 : 0) +
    (columns.remarks ? 1 : 0) +
    (columns.availability ? 1 : 0) +
    1 // delete

  return (
    <>
      <tr
        className={cx(
          'border-b border-gray-100 transition-colors',
          hasError || blocking ? 'bg-red-50/60' : warning ? 'bg-amber-50/40' : 'hover:bg-gray-50/60',
        )}
      >
        <td className={cx(CELL, 'w-10 text-center')}>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
            {index + 1}
            {generated ? (
              <Tooltip label="Drafted by the assistant — check it before posting.">
                <Sparkles className="h-3 w-3 text-primary" aria-label="Drafted by the assistant, needs review" />
              </Tooltip>
            ) : null}
          </span>
        </td>

        <td className={cx(CELL, 'min-w-[16rem]')}>
          <ItemSearchSelect
            itemId={line.item_id}
            itemName={line.item_name}
            itemSku={line.item_sku}
            warehouseId={line.warehouse_id}
            onPick={onPickItem}
            onClear={onClearItem}
            disabled={disabled}
            invalid={hasError && !line.item_id}
            autoFocus={autoFocus}
          />
        </td>

        <td className={cx(CELL, 'min-w-[9rem]')}>
          <WarehouseField
            value={line.warehouse_id}
            onChange={onWarehouseChange}
            warehouses={warehouses}
            disabled={disabled}
            invalid={hasError && line.warehouse_id === null}
            aria-label={`Warehouse for line ${index + 1}`}
          />
        </td>

        {columns.batch ? (
          <td className={cx(CELL, 'min-w-[9rem]')}>
            {/* An item can be both batch and serial tracked, so these stack
                rather than exclude each other; an untracked item says so. */}
            {showBatch || showSerial ? (
              <div className="flex flex-col gap-1">
                {showBatch ? (
                  <BatchSelect
                    itemId={line.item_id as number}
                    warehouseId={line.warehouse_id}
                    value={line.batch_id}
                    allowCreate={line.direction === 'in'}
                    disabled={disabled}
                    invalid={hasError && line.batch_id === null}
                    onChange={(b) =>
                      onPatch({
                        batch_id: b?.batch_id ?? null,
                        batch_no: b?.batch_no ?? null,
                        batch_expiry: b?.expiry_date ?? null,
                        // Serials belong to a batch; changing it invalidates them.
                        serials: [],
                      })
                    }
                  />
                ) : null}
                {showSerial ? (
                  <SerialSelect
                    itemId={line.item_id as number}
                    itemName={line.item_name}
                    warehouseId={line.warehouse_id}
                    batchId={line.batch_id}
                    direction={line.direction as 'in' | 'out'}
                    value={line.serials}
                    requiredCount={baseQty}
                    usedElsewhere={usedSerialIds}
                    disabled={disabled}
                    onChange={(serials) => onPatch({ serials })}
                  />
                ) : null}
              </div>
            ) : (
              <span className="text-[11px] text-gray-400">—</span>
            )}
          </td>
        ) : null}

        {columns.unit ? (
          <td className={cx(CELL, 'w-[5.5rem]')}>
            {line.units.length > 0 ? (
              <Select
                aria-label={`Unit for line ${index + 1}`}
                disabled={disabled || line.units.length === 1}
                value={line.unit_id ?? ''}
                onChange={(e) => onPatch({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
              >
                {line.units.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                    {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-[11px] text-gray-400">—</span>
            )}
          </td>
        ) : null}

        <td className={cx(CELL, 'w-[6.5rem]')}>
          <DirectionSelect
            value={line.direction}
            disabled={disabled}
            invalid={hasError && !line.direction}
            aria-label={`Direction for line ${index + 1}`}
            // Serials belong to a direction: the numbers in stock are not the
            // numbers awaiting receipt, so the selection cannot survive a flip.
            onChange={(direction) => onPatch({ direction, serials: [] })}
          />
        </td>

        <td className={cx(CELL, 'w-[6.5rem]')}>
          <Input
            inputMode="decimal"
            className="text-right tabular-nums"
            aria-label={`Quantity for line ${index + 1}`}
            disabled={disabled}
            invalid={hasError && (toNumber(line.qty) ?? 0) <= 0}
            value={line.qty}
            onChange={(e) =>
              onPatch({
                qty: e.target.value,
                amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount,
              })
            }
          />
        </td>

        {columns.rate ? (
          <td className={cx(CELL, 'w-[6.5rem]')}>
            <Input
              inputMode="decimal"
              className="text-right tabular-nums"
              aria-label={`Rate for line ${index + 1}`}
              disabled={disabled}
              value={line.rate}
              onChange={(e) => onPatch({ rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })}
            />
          </td>
        ) : null}

        {columns.amount ? (
          <td className={cx(CELL, 'w-[7rem] text-right')}>
            <span className="inline-block py-1.5 text-xs font-semibold tabular-nums text-gray-900">
              {amount === null ? '—' : formatQty(amount)}
            </span>
          </td>
        ) : null}

        {columns.remarks ? (
          <td className={cx(CELL, 'min-w-[9rem]')}>
            <Input
              aria-label={`Remarks for line ${index + 1}`}
              placeholder={line.direction === 'in' ? 'e.g. Adjustment' : 'e.g. Damaged'}
              maxLength={255}
              disabled={disabled}
              value={line.description}
              onChange={(e) => onPatch({ description: e.target.value })}
            />
          </td>
        ) : null}

        {columns.availability ? <td className={cx(CELL, 'w-[6.5rem] whitespace-nowrap')}>{availabilityCell()}</td> : null}

        <td className={cx(CELL, 'w-10 text-center')}>
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Delete line ${index + 1}`}
            title="Delete line"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </td>
      </tr>

      {messages.length > 0 ? (
        <tr className={cx(hasError || blocking ? 'bg-red-50/60' : 'bg-amber-50/40')}>
          <td />
          <td colSpan={colSpan - 1} className="px-2 pb-1.5">
            <ul className="space-y-0.5">
              {messages.map((m, i) => (
                <li
                  key={`${m.level}-${i}`}
                  className={cx(
                    'flex items-start gap-1 text-[11px] leading-snug',
                    m.level === 'blocking' ? 'text-red-700' : m.level === 'warning' ? 'text-amber-800' : 'text-gray-600',
                  )}
                >
                  {m.level === 'info' ? (
                    <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                  )}
                  <span>{m.message}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  )
}
