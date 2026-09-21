/**
 * The serial workspace: one row per serial number, scanner first.
 *
 * The row is deliberately NOT the document line. A line posts one item / warehouse / batch /
 * direction with a quantity and a list of serials; an operator holding forty laptops wants to
 * scan forty labels, not to work out that those forty are three lines. `toPayloadLines` does
 * the folding on save, and the summary panel shows the resulting line count so nothing about
 * it is hidden.
 */

import { memo, useCallback } from 'react'
import { AlertTriangle, Check, Package, Plus, ScanLine, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Spinner } from '../../ui/Spinner'
import { StatusBadge } from '../../ui/StatusBadge'
import { AIC, cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { LineItemPicker } from '../LineItemPicker'
import type { SerialRowDraft } from './model'

export interface SerialGridProps {
  rows: SerialRowDraft[]
  warehouses: FormOptionWarehouse[]
  /** Row key → the first blocking message for that row. */
  issues: ReadonlyMap<string, string>
  disabled: boolean
  onPatch: (key: string, patch: Partial<SerialRowDraft>) => void
  onRemove: (key: string) => void
  /** Serial column committed (blur / Enter) — run the live lookup. */
  onCommitSerial: (key: string, value: string) => void
  onPickItem: (key: string, row: ItemSearchRow) => void
  onClearItem: (key: string) => void
  onAddRow: () => void
  onScanRow: (key: string) => void
  /** Focus tracking, so the contextual panel follows the caret. */
  onFocusRow: (key: string) => void
  registerSerialInput: (key: string, el: HTMLInputElement | null) => void
}

const HEAD_CLS = 'px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 whitespace-nowrap'

export function SerialGrid(props: SerialGridProps) {
  const { rows, onAddRow, disabled } = props
  return (
    <div className={cx(AIC, 'rounded-xl border border-gray-200 overflow-hidden')}>
      {/*
        `relative` is load-bearing, not decoration.
        Without a positioned ancestor the table's scrollable overflow propagates all the way to
        the initial containing block, so a 62rem grid made the whole PAGE scroll sideways on a
        phone even though the wrapper itself scrolled correctly. Making the scroller a
        containing block confines the overflow to it. Verified at 390 / 768 / 1280.
      */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse min-w-[62rem]">
          <caption className="sr-only">Serial numbers being adjusted</caption>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th scope="col" className={cx(HEAD_CLS, 'w-9')}>
                #
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'min-w-[13rem]')}>
                Item
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'min-w-[12rem]')}>
                Serial number
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'min-w-[9rem]')}>
                Warehouse
              </th>
              <th scope="col" className={HEAD_CLS}>
                Batch
              </th>
              <th scope="col" className={HEAD_CLS}>
                Status
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'w-24')}>
                Dir.
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'min-w-[8rem]')}>
                Remarks
              </th>
              <th scope="col" className={cx(HEAD_CLS, 'w-12 text-right')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <SerialRow key={row.key} row={row} index={index} issue={props.issues.get(row.key) ?? null} {...props} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-2 border-t border-gray-100 bg-gray-50/50">
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={onAddRow}
          disabled={disabled}
          block
          kbd="Alt+A"
          className="border-dashed"
        >
          Add another line
        </Button>
      </div>
    </div>
  )
}

interface SerialRowProps extends SerialGridProps {
  row: SerialRowDraft
  index: number
  issue: string | null
}

const CELL = 'px-2.5 py-1.5 align-middle border-b border-gray-100'

const SerialRow = memo(function SerialRow({
  row,
  index,
  issue,
  warehouses,
  disabled,
  onPatch,
  onRemove,
  onCommitSerial,
  onPickItem,
  onClearItem,
  onScanRow,
  onFocusRow,
  registerSerialInput,
}: SerialRowProps) {
  const setSerialRef = useCallback((el: HTMLInputElement | null) => registerSerialInput(row.key, el), [registerSerialInput, row.key])
  const bad = row.check === 'error' || issue !== null
  const warn = row.check === 'warning'

  return (
    <tr
      className={cx(
        'transition-colors',
        bad ? 'bg-red-50/60' : warn ? 'bg-amber-50/60' : 'hover:bg-gray-50/70',
      )}
      onFocus={() => onFocusRow(row.key)}
    >
      <td className={cx(CELL, 'text-[11px] text-gray-400 tabular-nums')}>{index + 1}</td>

      {/* Item — filled in from the serial, or picked directly when starting item-first. */}
      <td className={CELL}>
        {row.item_id !== null ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 grid place-items-center shrink-0">
              <Package className="w-4 h-4 text-gray-400" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-gray-900 truncate">{row.item_name}</span>
              <span className="block text-[10.5px] text-gray-500 truncate">
                {row.item_sku ? `SKU: ${row.item_sku}` : `Item #${row.item_id}`}
                {row.qty !== 1 ? ` · qty ${row.qty}` : ''}
              </span>
            </span>
            {row.serial_id === null && !disabled ? (
              <button
                type="button"
                className="ml-auto shrink-0 text-[11px] text-gray-500 hover:text-primary hover:underline"
                onClick={() => onClearItem(row.key)}
              >
                Change
              </button>
            ) : null}
          </div>
        ) : (
          <LineItemPicker
            itemId={null}
            itemName=""
            itemSku={null}
            warehouseId={row.warehouse_id}
            onPick={(picked) => onPickItem(row.key, picked)}
            onClear={() => onClearItem(row.key)}
            disabled={disabled}
            invalid={issue !== null}
          />
        )}
      </td>

      {/* Serial number — the scanner's landing strip. */}
      <td className={CELL}>
        <div className="relative">
          <Input
            ref={setSerialRef}
            value={row.serial_no}
            disabled={disabled}
            invalid={bad}
            aria-label={`Serial number, line ${index + 1}`}
            placeholder="Scan or enter serial no."
            autoComplete="off"
            spellCheck={false}
            className="font-mono pr-8"
            onChange={(e) => onPatch(row.key, { serial_no: e.target.value, check: 'idle', message: null })}
            onBlur={(e) => onCommitSerial(row.key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommitSerial(row.key, e.currentTarget.value)
              }
            }}
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
            {row.check === 'checking' ? (
              <Spinner size="xs" label="Checking serial number" />
            ) : row.check === 'ok' ? (
              <Check className="w-4 h-4 text-emerald-600" aria-label="Serial found" />
            ) : row.check === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-500" aria-label="Serial needs review" />
            ) : row.check === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-red-500" aria-label="Serial problem" />
            ) : (
              <button
                type="button"
                className="p-0.5 text-gray-400 hover:text-primary disabled:opacity-50"
                aria-label={`Scan into line ${index + 1}`}
                disabled={disabled}
                onClick={() => onScanRow(row.key)}
              >
                <ScanLine className="w-4 h-4" aria-hidden />
              </button>
            )}
          </span>
        </div>
        {/*
          aria-live so a screen reader hears the result of a lookup it never saw start.
          `polite`: a scanner operator running down a rack must not be interrupted mid-scan.
        */}
        {issue ?? row.message ? (
          <p
            aria-live="polite"
            className={cx('mt-1 text-[10.5px] leading-tight', bad ? 'text-red-600' : 'text-amber-700')}
          >
            {issue ?? row.message}
          </p>
        ) : null}
      </td>

      {/* Warehouse — pre-filled from the serial, editable because the line posts against it. */}
      <td className={CELL}>
        <Select
          value={row.warehouse_id ?? ''}
          disabled={disabled}
          aria-label={`Warehouse, line ${index + 1}`}
          onChange={(e) => onPatch(row.key, { warehouse_id: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Default</option>
          {row.warehouse_id !== null && !warehouses.some((w) => w.warehouse_id === row.warehouse_id) ? (
            <option value={row.warehouse_id}>{row.warehouse_name ?? `Warehouse #${row.warehouse_id}`}</option>
          ) : null}
          {warehouses.map((w) => (
            <option key={w.warehouse_id} value={w.warehouse_id}>
              {w.warehouse_name}
            </option>
          ))}
        </Select>
      </td>

      <td className={cx(CELL, 'text-[11.5px] text-gray-600 whitespace-nowrap')}>{row.batch_no ?? <span className="text-gray-300">—</span>}</td>

      <td className={CELL}>
        {row.current_status ? (
          <StatusBadge value={row.current_status} size="xs" />
        ) : (
          <span className="text-gray-300 text-[11.5px]">—</span>
        )}
      </td>

      <td className={CELL}>
        <Select
          value={row.direction ?? ''}
          disabled={disabled}
          invalid={!row.direction}
          aria-label={`Direction, line ${index + 1}`}
          onChange={(e) => onPatch(row.key, { direction: e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null })}
        >
          <option value="">—</option>
          <option value="out">Out</option>
          <option value="in">In</option>
        </Select>
      </td>

      <td className={CELL}>
        <Input
          value={row.remarks}
          disabled={disabled}
          aria-label={`Remarks, line ${index + 1}`}
          placeholder="Optional"
          onChange={(e) => onPatch(row.key, { remarks: e.target.value })}
        />
      </td>

      <td className={cx(CELL, 'text-right')}>
        <Button
          variant="ghost"
          size="xs"
          icon={Trash2}
          disabled={disabled}
          aria-label={`Remove line ${index + 1}${row.serial_no ? ` (${row.serial_no})` : ''}`}
          className="text-gray-400 hover:text-red-600"
          onClick={() => onRemove(row.key)}
        />
      </td>
    </tr>
  )
})
