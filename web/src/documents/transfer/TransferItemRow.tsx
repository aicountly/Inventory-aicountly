import { ArrowRight, Copy, Package, Split, Trash2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { FormOptionWarehouse } from '../../services/items'
import type { BatchRow, ItemSearchRow } from '../../services/lookupApi'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import {
  destinationWarehouseFor,
  estimatedLineValue,
  estimatedUnitValue,
  formatEstimate,
  sourceWarehouseFor,
} from './transferModel'
import type { LineStock, TransferIssue } from './transferModel'

export interface TransferItemRowProps {
  index: number
  line: LineDraft
  header: HeaderDraft
  warehouses: FormOptionWarehouse[]
  stock: LineStock | undefined
  rates: ReadonlyMap<number, number> | null
  currencyCode: string | null
  issues: readonly TransferIssue[]
  disabled: boolean
  expanded: boolean
  autoFocus: boolean
  columnCount: number
  warehouseName: (id: number | null | undefined) => string
  onToggleExpand: () => void
  onChange: (patch: Partial<LineDraft>) => void
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  onDuplicate: () => void
  onRemove: () => void
  onBatchPicked: (batch: BatchRow | null) => void
}

const CELL = 'px-2 py-2 align-middle border-b border-gray-100'

function unitSymbolOf(line: LineDraft): string {
  const unit = line.units.find((u) => u.unit_id === line.unit_id)
  return unit?.unit_symbol ?? unit?.unit_name ?? ''
}

/** One transfer line. Pickers are the shared ones every document editor uses. */
export function TransferItemRow({
  index,
  line,
  header,
  warehouses,
  stock,
  rates,
  currencyCode,
  issues,
  disabled,
  expanded,
  autoFocus,
  columnCount,
  warehouseName,
  onToggleExpand,
  onChange,
  onPick,
  onClear,
  onDuplicate,
  onRemove,
  onBatchPicked,
}: TransferItemRowProps) {
  const hasError = issues.some((i) => i.level === 'error')
  const hasWarning = !hasError && issues.some((i) => i.level === 'warning')
  const from = sourceWarehouseFor(line, header)
  const to = destinationWarehouseFor(line, header)
  // An edited draft stores the resolved warehouse on every line, so "overridden"
  // has to mean "different from the header", not "present".
  const overridden = (line.from_warehouse_id !== null && line.from_warehouse_id !== header.from_warehouse_id) || (line.warehouse_id !== null && line.warehouse_id !== header.to_warehouse_id)
  const needsBase = lineBaseQty(line)
  const symbol = unitSymbolOf(line)
  const lineValue = estimatedLineValue(line, rates)
  const unitValue = estimatedUnitValue(line, rates)
  const rowId = `transfer-line-${line.key}`

  return (
    <>
      <tr
        className={cx(
          'transition-colors',
          hasError ? 'bg-red-50/60' : hasWarning ? 'bg-amber-50/40' : 'hover:bg-primary-light/20',
        )}
      >
        <td className={cx(CELL, 'text-xs font-medium text-gray-400 tabular-nums')}>{index + 1}</td>

        <td className={CELL}>
          {/* `overflow-hidden` caps the cell's min-content at the width the
              header row declares, so a long item name cannot push Est. value and
              the row actions off the card. Only once an item is chosen: while the
              typeahead is open its dropdown is a child of this box. */}
          <div className={cx('flex items-start gap-2.5', line.item_id !== null && 'overflow-hidden')}>
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400"
              aria-hidden
            >
              <Package className="h-4 w-4" />
            </span>
            <div className="st-item-name min-w-0 flex-1">
              {line.item_sku && line.item_id ? (
                <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-400">{line.item_sku}</span>
              ) : null}
              <LineItemPicker
                itemId={line.item_id}
                itemName={line.item_name}
                itemSku={null}
                warehouseId={from}
                onPick={onPick}
                onClear={onClear}
                disabled={disabled}
                compact
                autoFocus={autoFocus}
                invalid={hasError && !line.item_id}
              />
              <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={expanded}
                aria-controls={rowId}
                className={cx(
                  // `min-w-0` on both: the route text cannot wrap, so without it
                  // the row's minimum width is the full warehouse names and the
                  // columns to the right are pushed off the card.
                  'mt-1 flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-gray-100',
                  overridden ? 'font-semibold text-primary' : 'text-gray-400',
                )}
              >
                <Split className="h-3 w-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  {warehouseName(from) || 'source'} <ArrowRight className="inline h-2.5 w-2.5" aria-hidden />{' '}
                  {warehouseName(to) || 'destination'}
                </span>
                {overridden ? <span className="shrink-0">· row override</span> : null}
              </button>
            </div>
          </div>
        </td>

        <td className={CELL}>
          {!line.item_id ? (
            <span className="text-xs text-gray-400">—</span>
          ) : !line.track_batch && !line.track_serial ? (
            <span className="text-xs text-gray-400">Not tracked</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              {line.track_batch ? (
                <BatchPicker
                  itemId={line.item_id}
                  warehouseId={from}
                  value={line.batch_id}
                  onChange={(batch) => {
                    onBatchPicked(batch)
                    onChange({ batch_id: batch?.batch_id ?? null, batch_no: batch?.batch_no ?? null, serials: [] })
                  }}
                  allowCreate={false}
                  disabled={disabled}
                />
              ) : null}
              {line.track_serial ? (
                <SerialPicker
                  itemId={line.item_id}
                  itemName={line.item_name}
                  warehouseId={from}
                  batchId={line.batch_id}
                  direction="out"
                  value={line.serials}
                  onChange={(serials) => onChange({ serials })}
                  requiredCount={needsBase}
                  disabled={disabled}
                />
              ) : null}
            </div>
          )}
        </td>

        <td className={CELL}>
          {line.units.length > 0 ? (
            <Select
              value={line.unit_id ?? ''}
              disabled={disabled}
              aria-label={`Unit for line ${index + 1}`}
              onChange={(e) => onChange({ unit_id: e.target.value === '' ? null : Number(e.target.value), serials: [] })}
            >
              {line.units.map((u) => (
                <option key={u.unit_id} value={u.unit_id}>
                  {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                  {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>

        <td className={CELL}>
          <input
            className={cx(
              'aic block h-8 w-full rounded-lg border bg-white px-2.5 text-right text-sm tabular-nums text-gray-900 transition-colors focus:outline-none focus:ring-2 disabled:bg-gray-50',
              hasError ? 'border-red-300 focus:border-red-500 focus:ring-red-300/40' : 'border-gray-200 focus:border-primary focus:ring-primary/30',
            )}
            inputMode="decimal"
            value={line.qty}
            disabled={disabled}
            aria-label={`Quantity for line ${index + 1}`}
            aria-invalid={hasError || undefined}
            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, '') })}
          />
          {line.units.length > 0 && (line.units.find((u) => u.unit_id === line.unit_id)?.conversion_factor ?? 1) !== 1 ? (
            <span className="mt-0.5 block text-right text-[10px] text-gray-400">= {formatQty(needsBase)} base</span>
          ) : null}
        </td>

        <td className={CELL}>
          <AvailabilityCell stock={stock} symbol={symbol} />
        </td>

        <td className={cx(CELL, 'text-right')}>
          {rates === null ? (
            <span className="text-xs text-gray-400" title="Stock valuation is not part of your access profile.">
              —
            </span>
          ) : lineValue === null ? (
            <span className="text-xs text-gray-400">—</span>
          ) : (
            <>
              <strong className="block whitespace-nowrap text-xs font-semibold tabular-nums text-gray-900">
                {formatEstimate(lineValue, currencyCode)}
              </strong>
              {unitValue !== null ? (
                <span className="mt-0.5 block whitespace-nowrap text-[10px] tabular-nums text-gray-400">
                  ({formatEstimate(unitValue, currencyCode)} each)
                </span>
              ) : null}
            </>
          )}
        </td>

        <td className={CELL}>
          <div className="flex items-center justify-end gap-1">
            <Tooltip label="Duplicate this line">
              <Button
                variant="ghost"
                size="xs"
                icon={Copy}
                onClick={onDuplicate}
                disabled={disabled}
                aria-label={`Duplicate line ${index + 1}`}
              />
            </Tooltip>
            <Tooltip label="Remove this line">
              <Button
                variant="ghost"
                size="xs"
                icon={Trash2}
                onClick={onRemove}
                disabled={disabled}
                aria-label={`Remove line ${index + 1}`}
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
              />
            </Tooltip>
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr id={rowId} className="bg-gray-50/70">
          <td className="border-b border-gray-100" />
          <td className={cx(CELL, 'border-b')} colSpan={columnCount - 1}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[11rem] flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">From (this line)</span>
                <WarehouseSelect
                  value={line.from_warehouse_id}
                  onChange={(id) => onChange({ from_warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
                  warehouses={warehouses}
                  emptyLabel={`Header source${header.from_warehouse_id ? ` · ${warehouseName(header.from_warehouse_id)}` : ''}`}
                  disabled={disabled}
                />
              </label>
              <label className="flex min-w-[11rem] flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">To (this line)</span>
                <WarehouseSelect
                  value={line.warehouse_id}
                  onChange={(id) => onChange({ warehouse_id: id })}
                  warehouses={warehouses}
                  emptyLabel={`Header destination${header.to_warehouse_id ? ` · ${warehouseName(header.to_warehouse_id)}` : ''}`}
                  disabled={disabled}
                />
              </label>
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Line note</span>
                <input
                  className="aic block h-8 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50"
                  value={line.description}
                  disabled={disabled}
                  maxLength={255}
                  onChange={(e) => onChange({ description: e.target.value })}
                />
              </label>
            </div>
            {issues.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {issues.map((issue) => (
                  <li
                    key={issue.id}
                    className={cx('text-[11px] leading-snug', issue.level === 'error' ? 'text-red-600' : 'text-amber-700')}
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function AvailabilityCell({ stock, symbol }: { stock: LineStock | undefined; symbol: string }) {
  if (!stock || stock.state === 'no_item') return <span className="text-xs text-gray-400">—</span>
  if (stock.state === 'no_source') return <span className="text-xs text-gray-400">Select a source warehouse</span>
  if (stock.state === 'loading') return <Skeleton className="h-4 w-20" rounded="md" />

  const { buckets, short, tight, shortBy, requiredByOthers } = stock
  const tone = short ? 'text-red-600' : tight ? 'text-amber-600' : 'text-emerald-600'
  const label = (
    <div className="space-y-0.5">
      <div>On hand {formatQty(buckets.on_hand)}</div>
      <div>Reserved {formatQty(buckets.reserved)}</div>
      <div>Committed {formatQty(buckets.committed)}</div>
      <div className="font-semibold">Free to move {formatQty(buckets.available)}</div>
      {buckets.in_transit > 0 ? <div>In transit {formatQty(buckets.in_transit)}</div> : null}
      {buckets.expected > 0 ? <div>Expected {formatQty(buckets.expected)}</div> : null}
      {requiredByOthers > 0 ? <div>Other lines here take {formatQty(requiredByOthers)}</div> : null}
    </div>
  )

  return (
    <Tooltip label={label}>
      <span className="flex cursor-help flex-col">
        <span className={cx('whitespace-nowrap text-xs font-bold tabular-nums', tone)}>
          {formatQty(buckets.available)}
          {symbol ? ` ${symbol}` : ''}
        </span>
        {short ? (
          <span className="whitespace-nowrap text-[10px] font-semibold text-red-500">short by {formatQty(shortBy)}</span>
        ) : tight ? (
          <span className="whitespace-nowrap text-[10px] text-amber-600">nearly all of it</span>
        ) : null}
      </span>
    </Tooltip>
  )
}
