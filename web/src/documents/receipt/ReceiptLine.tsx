import { Copy, Hash, Trash2, TriangleAlert } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { SerialPicker } from '../SerialPicker'
import { lineAmount, lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import { ReceiptBatchPicker } from './ReceiptBatchPicker'
import { ReceiptItemPicker } from './ReceiptItemPicker'
import { WarehousePicker } from './WarehousePicker'
import { lineAmountOf } from './receiptModel'
import type { LineField, LineIssue } from './receiptModel'

export interface ReceiptLineProps {
  line: LineDraft
  /** 1-based, as the grid numbers it. */
  row: number
  issues: Partial<Record<LineField, LineIssue>>
  warehouses: FormOptionWarehouse[]
  /** Falls back here when the line has no warehouse of its own. */
  headerWarehouseId: number | null
  disabled?: boolean
  onPatch: (patch: Partial<LineDraft>) => void
  onPickItem: (item: ItemSearchRow) => void
  onClearItem: () => void
  onRemove: () => void
  onDuplicate: () => void
  /** Enter on the last field of the row: move on to the next one. */
  onAdvance: () => void
  itemInputRef?: RefObject<HTMLInputElement | null>
}

const ORIGIN_LABEL: Record<string, string> = {
  purchase_order: 'From PO',
  ai_invoice: 'From invoice',
  import: 'Imported',
  scan: 'Scanned',
}

function sourceTag(line: LineDraft): string | null {
  const source = (line.metadata as { source?: string } | null)?.source
  return source ? (ORIGIN_LABEL[source] ?? null) : null
}

/** Every editable control of one line, so the table row and the phone card share them. */
function controls(props: ReceiptLineProps, describedBy: string | undefined) {
  const { line, issues, warehouses, headerWarehouseId, disabled, onPatch, onPickItem, onClearItem, onAdvance, itemInputRef, row } = props
  const warehouseId = line.warehouse_id ?? headerWarehouseId
  const invalid = (field: LineField) => issues[field]?.level === 'error'
  const described = describedBy ? { 'aria-describedby': describedBy } : {}

  const item = (
    <ReceiptItemPicker
      itemId={line.item_id}
      itemName={line.item_name}
      itemSku={line.item_sku}
      warehouseId={warehouseId}
      onPick={onPickItem}
      onClear={onClearItem}
      disabled={disabled}
      invalid={invalid('item')}
      inputRef={itemInputRef}
    />
  )

  const warehouse = (
    <WarehousePicker
      value={line.warehouse_id}
      warehouses={warehouses}
      disabled={disabled}
      invalid={invalid('warehouse')}
      aria-label={`Warehouse for line ${row}`}
      emptyLabel={headerWarehouseId ? 'Default' : 'Select warehouse'}
      onChange={(id) => onPatch({ warehouse_id: id, batch_id: null, batch_no: null, batch_expiry: null, serials: [] })}
    />
  )

  const batch =
    line.item_id && line.track_batch ? (
      <ReceiptBatchPicker
        itemId={line.item_id}
        warehouseId={warehouseId}
        value={line.batch_id}
        disabled={disabled}
        invalid={invalid('batch')}
        onChange={(b) => onPatch({ batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null, batch_expiry: b?.expiry_date ?? null })}
      />
    ) : (
      <span className="text-xs text-gray-400">{line.batch_no ?? 'Not tracked'}</span>
    )

  const unit =
    line.units.length > 0 ? (
      <Select
        size="md"
        aria-label={`Unit for line ${row}`}
        value={line.unit_id ?? ''}
        disabled={disabled}
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
      <span className="text-xs text-gray-400">—</span>
    )

  const qty = (
    <Input
      size="md"
      className="text-right tabular-nums"
      inputMode="decimal"
      aria-label={`Quantity for line ${row}`}
      invalid={invalid('qty')}
      value={line.qty}
      disabled={disabled}
      {...described}
      onChange={(e) => onPatch({ qty: e.target.value, amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount })}
    />
  )

  const rate = (
    <Input
      size="md"
      className="text-right tabular-nums"
      inputMode="decimal"
      aria-label={`Rate for line ${row}`}
      invalid={invalid('rate')}
      value={line.rate}
      disabled={disabled}
      {...described}
      onChange={(e) => onPatch({ rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onAdvance()
        }
      }}
    />
  )

  const amount = (
    <Input
      size="md"
      className="text-right tabular-nums bg-gray-50 font-medium"
      inputMode="decimal"
      aria-label={`Amount for line ${row}`}
      title="Quantity × rate. Type over it to match the invoice."
      value={line.amount}
      disabled={disabled}
      placeholder={formatMoney(lineAmountOf(line), '0.00')}
      onChange={(e) => onPatch({ amount: e.target.value })}
    />
  )

  const serials =
    line.item_id && line.track_serial ? (
      <SerialPicker
        itemId={line.item_id}
        itemName={line.item_name}
        warehouseId={warehouseId}
        batchId={line.batch_id}
        direction="in"
        value={line.serials}
        onChange={(next) => onPatch({ serials: next })}
        requiredCount={lineBaseQty(line)}
        disabled={disabled}
        renderTrigger={(open, state) => (
          <button
            type="button"
            onClick={open}
            disabled={disabled}
            aria-label={`Serial numbers for line ${row}: ${state.count} of ${state.required}`}
            className={cx(
              'inline-flex items-center gap-1 h-9 px-2 rounded-lg border text-xs font-medium tabular-nums transition-colors',
              state.mismatch
                ? 'border-red-300 bg-red-50 text-red-700'
                : state.count > 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-primary/40',
            )}
          >
            <Hash className="w-3.5 h-3.5" aria-hidden />
            {state.count}
            {state.required > 0 ? `/${state.required}` : ''}
          </button>
        )}
      />
    ) : (
      <span className="text-xs text-gray-400">—</span>
    )

  const expiry = line.batch_expiry ? (
    <span className="text-xs tabular-nums text-gray-700">{formatDate(line.batch_expiry)}</span>
  ) : (
    <span className="text-xs text-gray-400">—</span>
  )

  return { item, warehouse, batch, unit, qty, rate, amount, serials, expiry }
}

function rowActions({ disabled, onDuplicate, onRemove, row }: ReceiptLineProps) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Tooltip label="Duplicate line">
        <button
          type="button"
          onClick={onDuplicate}
          disabled={disabled}
          aria-label={`Duplicate line ${row}`}
          className="w-8 h-8 grid place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-colors disabled:opacity-50"
        >
          <Copy className="w-4 h-4" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label="Remove line">
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove line ${row}`}
          className="w-8 h-8 grid place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" aria-hidden />
        </button>
      </Tooltip>
    </div>
  )
}

function issueList(issues: Partial<Record<LineField, LineIssue>>): LineIssue[] {
  return Object.values(issues).filter((i): i is LineIssue => Boolean(i))
}

function IssueLines({ id, issues }: { id: string; issues: LineIssue[] }) {
  return (
    <div id={id} className="flex flex-col gap-0.5">
      {issues.map((issue) => (
        <span
          key={`${issue.field}-${issue.level}`}
          className={cx(
            'inline-flex items-start gap-1 text-[11px] font-medium',
            issue.level === 'error' ? 'text-red-600' : 'text-amber-700',
          )}
        >
          <TriangleAlert className="w-3 h-3 mt-px shrink-0" aria-hidden />
          <span>{issue.message}</span>
        </span>
      ))}
    </div>
  )
}

/** One line of the desktop grid, plus its messages on a row of their own. */
export function ReceiptLineRow(props: ReceiptLineProps) {
  const { line, row, issues } = props
  const list = issueList(issues)
  const messageId = list.length ? `mr-line-${line.key}-msg` : undefined
  const c = controls(props, messageId)
  const tag = sourceTag(line)
  const hasError = list.some((i) => i.level === 'error')

  return (
    <>
      <tr className={cx(hasError ? 'bg-red-50/40' : 'hover:bg-gray-50/60', 'transition-colors')}>
        <td className="px-2 py-1.5 align-middle text-xs text-gray-500 tabular-nums">
          {row}
          {tag ? <span className="block text-[10px] font-semibold uppercase tracking-wide text-sky-700">{tag}</span> : null}
        </td>
        <td className="px-2 py-1.5 align-middle min-w-[15rem]">{c.item}</td>
        <td className="px-2 py-1.5 align-middle min-w-[9rem]">{c.warehouse}</td>
        <td className="px-2 py-1.5 align-middle min-w-[9rem]">{c.batch}</td>
        <td className="px-2 py-1.5 align-middle w-[6.5rem]">{c.unit}</td>
        <td className="px-2 py-1.5 align-middle w-[6.5rem]">{c.qty}</td>
        <td className="px-2 py-1.5 align-middle w-[7rem]">{c.rate}</td>
        <td className="px-2 py-1.5 align-middle w-[8rem]">{c.amount}</td>
        <td className="px-2 py-1.5 align-middle w-[5.5rem]">{c.serials}</td>
        <td className="px-2 py-1.5 align-middle w-[6.5rem] whitespace-nowrap">{c.expiry}</td>
        <td className="px-2 py-1.5 align-middle w-[5rem]">{rowActions(props)}</td>
      </tr>
      {messageId ? (
        <tr className={hasError ? 'bg-red-50/40' : undefined}>
          <td />
          <td colSpan={10} className="px-2 pb-2 pt-0">
            <IssueLines id={messageId} issues={list} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </div>
  )
}

/** The same line on a phone: a card, because a ten-column grid is not readable at 390px. */
export function ReceiptLineCard(props: ReceiptLineProps) {
  const { line, row, issues } = props
  const list = issueList(issues)
  const messageId = list.length ? `mr-card-${line.key}-msg` : undefined
  const c = controls(props, messageId)
  const tag = sourceTag(line)
  const hasError = list.some((i) => i.level === 'error')

  return (
    <div
      className={cx(
        AIC,
        'rounded-xl border p-3',
        hasError ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-white',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold text-gray-500 tabular-nums">#{row}</span>
        {tag ? <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">{tag}</span> : null}
        <div className="ml-auto">{rowActions(props)}</div>
      </div>
      <div className="mb-2">{c.item}</div>
      <div className="grid grid-cols-2 gap-2">
        <Cell label="Warehouse">{c.warehouse}</Cell>
        <Cell label="Batch / lot">{c.batch}</Cell>
        <Cell label="Unit">{c.unit}</Cell>
        <Cell label="Quantity">{c.qty}</Cell>
        <Cell label="Rate">{c.rate}</Cell>
        <Cell label="Amount">{c.amount}</Cell>
        <Cell label="Serials">{c.serials}</Cell>
        <Cell label="Expiry">{c.expiry}</Cell>
      </div>
      {messageId ? (
        <div className="mt-2">
          <IssueLines id={messageId} issues={list} />
        </div>
      ) : null}
    </div>
  )
}
