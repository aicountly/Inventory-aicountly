import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { Badge } from '../../ui/Badge'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { formatMoney, formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { lineAmount, lineBaseQty, newLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { unitOptionsFrom } from '../LineEditor'
import type { DocumentTypeSpec } from '../registry'
import type { JobWorkMode } from './jobWorkModel'
import type { JobWorkModeSpec } from './jobWorkMode'

const CELL = 'px-2.5 py-2 align-middle'
const HEAD = 'px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 whitespace-nowrap'
const INPUT = 'h-8 px-2 text-sm'

export interface JobWorkLinesProps {
  spec: DocumentTypeSpec
  modeSpec: JobWorkModeSpec
  mode: JobWorkMode
  header: HeaderDraft
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  warehouses: FormOptionWarehouse[]
  availability: Record<string, AvailabilityCheckResult>
  checking: boolean
  /** Base quantity still open with this job worker, per item. */
  openByItem: ReadonlyMap<number, number>
  /** Draft keys the server named in a negative-stock block. */
  offendingKeys: ReadonlySet<string>
  /** Line keys that failed client validation, so the cell can say so. */
  invalidKeys: ReadonlySet<string>
  /** The line whose item box should take focus — the one just added. */
  autoFocusKey?: string | null
  disabled?: boolean
  toolbar?: ReactNode
  footer?: ReactNode
}

/**
 * The entry grid.
 *
 * Every picker in it is the one the other document editors already use
 * (item typeahead, batch, serial, warehouse) — the job-work screen changes the
 * columns and their order, not what a batch means. Column set follows the
 * direction: a dispatch asks what is available and what the challan says, a
 * receipt asks what is still open, what is coming back and what it cost.
 */
export function JobWorkLines(props: JobWorkLinesProps) {
  const { spec, modeSpec, mode, header, lines, onChange, warehouses, availability, checking, openByItem, offendingKeys, invalidKeys, autoFocusKey, disabled, toolbar, footer } = props
  const inward = mode === 'in'

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key))
  const add = () => onChange([...lines, newLine(spec, { warehouse_id: header.default_warehouse_id })])

  const pick = (line: LineDraft, row: ItemSearchRow) => {
    const units = unitOptionsFrom(row)
    const def = units.find((u) => u.is_default) ?? units[0]
    update(line.key, {
      item_id: row.item_id,
      item_name: row.print_name || row.item_name,
      item_sku: row.item_sku,
      track_batch: Number(row.track_batch) === 1,
      track_serial: Number(row.track_serial) === 1,
      units,
      unit_id: def?.unit_id ?? row.unit_id ?? null,
      warehouse_id: line.warehouse_id ?? row.default_warehouse_id ?? header.default_warehouse_id ?? null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })
  }

  const clear = (line: LineDraft) =>
    update(line.key, {
      item_id: null,
      item_name: '',
      item_sku: null,
      track_batch: false,
      track_serial: false,
      units: [],
      unit_id: null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })

  const columnCount = inward ? 14 : 12

  return (
    <div className={cx(AIC, 'jw-lines min-w-0')}>
      {toolbar ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{toolbar}</div> : null}

      {/*
        `relative`: an absolutely positioned descendant is only clipped by a
        scroll container that is also its containing block. Without this, the
        visually-hidden header labels inside the table sit at their real
        position — a thousand pixels to the right — outside every clip, and the
        whole PAGE scrolls sideways on a phone while the grid itself sits still.
      */}
      <div className="relative overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[68rem] border-collapse text-sm">
          <caption className="sr-only">{modeSpec.linesTitle}</caption>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th scope="col" className={cx(HEAD, 'w-10')}>
                #
              </th>
              <th scope="col" className={cx(HEAD, 'min-w-[15rem]')}>
                Item
              </th>
              {inward ? (
                <th scope="col" className={HEAD}>
                  Type
                </th>
              ) : null}
              <th scope="col" className={cx(HEAD, 'text-right')}>
                {inward ? 'Open' : 'Available'}
              </th>
              <th scope="col" className={cx(HEAD, 'text-right')}>
                {modeSpec.qtyLabel} <span className="text-red-600">*</span>
              </th>
              <th scope="col" className={HEAD}>
                Unit
              </th>
              <th scope="col" className={cx(HEAD, 'min-w-[9rem]')}>
                Warehouse
              </th>
              <th scope="col" className={HEAD}>
                Batch
              </th>
              <th scope="col" className={HEAD}>
                Serials
              </th>
              <th scope="col" className={cx(HEAD, 'text-right')}>
                Challan rate
              </th>
              <th scope="col" className={cx(HEAD, 'text-right')}>
                Challan value
              </th>
              {inward ? (
                <th scope="col" className={cx(HEAD, 'text-right')} title="Per base unit — what the goods coming back cost.">
                  Unit cost
                </th>
              ) : null}
              {inward ? (
                <th scope="col" className={cx(HEAD, 'text-right')}>
                  Inventory value
                </th>
              ) : null}
              <th scope="col" className={cx(HEAD, 'min-w-[8rem]')}>
                Remarks
              </th>
              <th scope="col" aria-label="Remove line" className={cx(HEAD, 'w-10')} />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-3 py-10 text-center">
                  <p className="text-sm font-semibold text-gray-900">No items added yet.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {inward
                      ? 'Add the finished goods coming back, or pull them from what is pending with this job worker.'
                      : 'Add the material going out to the job worker.'}
                  </p>
                  <button
                    type="button"
                    onClick={add}
                    disabled={disabled}
                    className="aic mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add item
                  </button>
                </td>
              </tr>
            ) : null}
            {lines.map((line, index) => (
              <JobWorkLineRow
                key={line.key}
                index={index}
                line={line}
                inward={inward}
                header={header}
                warehouses={warehouses}
                availability={availability[line.key]}
                checking={checking}
                openQty={line.item_id !== null ? (openByItem.get(line.item_id) ?? null) : null}
                offending={offendingKeys.has(line.key)}
                invalid={invalidKeys.has(line.key)}
                autoFocus={autoFocusKey === line.key}
                disabled={disabled}
                onPick={pick}
                onClear={clear}
                onUpdate={update}
                onRemove={remove}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="aic inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary disabled:opacity-60"
          title="Add item (Alt+A)"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add item
        </button>
        {footer}
      </div>
    </div>
  )
}

interface RowProps {
  index: number
  line: LineDraft
  inward: boolean
  header: HeaderDraft
  warehouses: FormOptionWarehouse[]
  availability: AvailabilityCheckResult | undefined
  checking: boolean
  openQty: number | null
  offending: boolean
  invalid: boolean
  autoFocus: boolean
  disabled?: boolean
  onPick: (line: LineDraft, row: ItemSearchRow) => void
  onClear: (line: LineDraft) => void
  onUpdate: (key: string, patch: Partial<LineDraft>) => void
  onRemove: (key: string) => void
}

/**
 * One row, memoised on its own line.
 *
 * A job-work document routinely runs to dozens of lines, each carrying an
 * async typeahead, a batch picker and a serial picker. Re-rendering all of
 * them on every keystroke in one quantity cell is what made the old grid feel
 * heavy; the row only re-renders when its own line, its own availability or
 * the shared disabled flag changes.
 */
const JobWorkLineRow = memo(function JobWorkLineRow({
  index,
  line,
  inward,
  header,
  warehouses,
  availability,
  checking,
  openQty,
  offending,
  invalid,
  autoFocus,
  disabled,
  onPick,
  onClear,
  onUpdate,
  onRemove,
}: RowProps) {
  const generated = line.origin !== 'manual'
  const isOut = line.direction === 'out'
  const baseQty = lineBaseQty(line)
  const value = useMemo(() => lineAmount(line.qty, line.rate), [line.qty, line.rate])
  const inventoryValue = useMemo(() => lineAmount(baseQty, line.valuation_rate), [baseQty, line.valuation_rate])
  const short = availability && !availability.ok

  return (
    <tr
      className={cx(
        'border-b border-gray-100 last:border-b-0 transition-colors hover:bg-gray-50/70',
        offending && 'bg-red-50/60 hover:bg-red-50',
        !offending && generated && 'bg-sky-50/60',
      )}
    >
      <td className={cx(CELL, 'text-xs tabular-nums text-gray-400')}>{index + 1}</td>

      <td className={CELL}>
        <LineItemPicker
          itemId={line.item_id}
          itemName={line.item_name}
          itemSku={line.item_sku}
          warehouseId={line.warehouse_id ?? header.default_warehouse_id}
          onPick={(row) => onPick(line, row)}
          onClear={() => onClear(line)}
          disabled={disabled || generated}
          invalid={invalid}
          autoFocus={autoFocus}
        />
        {generated ? (
          <Badge tone="info" size="xs" className="mt-1">
            From settlement
          </Badge>
        ) : null}
        {line.description && generated ? <p className="mt-0.5 text-[11px] text-gray-500">{line.description}</p> : null}
      </td>

      {inward ? (
        <td className={CELL}>
          <select
            value={line.direction ?? ''}
            disabled={disabled || generated}
            aria-label={`Line ${index + 1} type`}
            onChange={(e) => onUpdate(line.key, { direction: e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null, serials: [] })}
            className={cx(FIELD_BASE, FIELD_OK, INPUT, 'w-28 min-w-[7rem]')}
          >
            <option value="in">Received</option>
            <option value="out">Consumed</option>
          </select>
        </td>
      ) : null}

      <td className={cx(CELL, 'text-right text-xs tabular-nums')}>
        {inward ? (
          openQty === null || openQty <= 0 ? (
            <span className="text-gray-400">—</span>
          ) : (
            <span className="text-gray-700" title="Still open with this job worker for this item">
              {formatQty(openQty)}
            </span>
          )
        ) : !line.item_id ? (
          <span className="text-gray-400">—</span>
        ) : availability ? (
          <span className={short ? 'font-semibold text-red-600' : 'text-emerald-700'}>
            {formatQty(availability.available)}
            {short ? <span className="block text-[10px] font-normal">short {formatQty(shortBy(availability))}</span> : null}
          </span>
        ) : (
          <span className="text-gray-400">{checking ? '…' : '—'}</span>
        )}
      </td>

      <td className={CELL}>
        <input
          inputMode="decimal"
          value={line.qty}
          disabled={disabled}
          aria-label={`Line ${index + 1} quantity`}
          aria-invalid={invalid || undefined}
          onChange={(e) => onUpdate(line.key, { qty: e.target.value, amount: line.rate ? String(lineAmount(e.target.value, line.rate) ?? '') : line.amount })}
          className={cx(FIELD_BASE, invalid || short ? FIELD_INVALID : FIELD_OK, INPUT, 'w-20 min-w-[5rem] text-right tabular-nums')}
        />
      </td>

      <td className={CELL}>
        {line.units.length > 0 ? (
          <select
            value={line.unit_id ?? ''}
            disabled={disabled}
            aria-label={`Line ${index + 1} unit`}
            onChange={(e) => onUpdate(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}
            className={cx(FIELD_BASE, FIELD_OK, INPUT, 'w-20 min-w-[4.75rem]')}
          >
            {line.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.unit_symbol ?? u.unit_name ?? u.unit_id}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      <td className={CELL}>
        <WarehouseSelect
          value={line.warehouse_id}
          onChange={(id) => onUpdate(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
          warehouses={warehouses}
          disabled={disabled}
        />
      </td>

      <td className={CELL}>
        {line.item_id && line.track_batch ? (
          <BatchPicker
            itemId={line.item_id}
            warehouseId={line.warehouse_id}
            value={line.batch_id}
            onChange={(b) => onUpdate(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null, metadata: b?.expiry_date ? { ...(line.metadata ?? {}), batch_expiry_date: b.expiry_date } : stripExpiry(line.metadata) })}
            allowCreate={line.direction === 'in'}
            disabled={disabled}
          />
        ) : (
          <span className="text-xs text-gray-400">{line.batch_no ?? '—'}</span>
        )}
      </td>

      <td className={CELL}>
        {line.item_id && line.track_serial && line.direction ? (
          <SerialPicker
            itemId={line.item_id}
            itemName={line.item_name}
            warehouseId={line.warehouse_id}
            batchId={line.batch_id}
            direction={line.direction}
            value={line.serials}
            onChange={(serials) => onUpdate(line.key, { serials })}
            requiredCount={baseQty}
            disabled={disabled}
          />
        ) : (
          <span className="text-xs text-gray-400">{line.serials.length > 0 ? line.serials.length : '—'}</span>
        )}
      </td>

      <td className={CELL}>
        <input
          inputMode="decimal"
          value={line.rate}
          disabled={disabled}
          aria-label={`Line ${index + 1} challan rate`}
          onChange={(e) => onUpdate(line.key, { rate: e.target.value, amount: String(lineAmount(line.qty, e.target.value) ?? '') })}
          className={cx(FIELD_BASE, FIELD_OK, INPUT, 'w-24 min-w-[6rem] text-right tabular-nums')}
        />
      </td>

      <td className={cx(CELL, 'text-right text-xs tabular-nums text-gray-700')}>
        {value === null ? <span className="text-gray-400">—</span> : formatMoney(value)}
      </td>

      {inward ? (
        <td className={CELL}>
          {isOut ? (
            // The engine costs what the job worker consumed out of the layers
            // the material is already sitting on; typing a figure here would be
            // a second, contradictory basis for the same stock.
            <span className="block w-24 text-right text-xs text-gray-400" title="Costed by the valuation engine when this posts.">
              engine
            </span>
          ) : (
            <input
              inputMode="decimal"
              value={line.valuation_rate}
              disabled={disabled}
              aria-label={`Line ${index + 1} unit cost`}
              aria-invalid={invalid || undefined}
              onChange={(e) => onUpdate(line.key, { valuation_rate: e.target.value })}
              className={cx(FIELD_BASE, invalid ? FIELD_INVALID : FIELD_OK, INPUT, 'w-24 min-w-[6rem] text-right tabular-nums')}
            />
          )}
        </td>
      ) : null}

      {inward ? (
        <td className={cx(CELL, 'text-right text-xs tabular-nums')}>
          {isOut ? (
            <span className="text-gray-400" title="Priced on posting from the cost layers.">
              Pending valuation
            </span>
          ) : inventoryValue === null ? (
            <span className="text-gray-400">—</span>
          ) : (
            <span className="font-medium text-gray-900">{formatMoney(inventoryValue)}</span>
          )}
        </td>
      ) : null}

      <td className={CELL}>
        <input
          type="text"
          value={line.description}
          disabled={disabled}
          maxLength={512}
          aria-label={`Line ${index + 1} remarks`}
          placeholder="—"
          onChange={(e) => onUpdate(line.key, { description: e.target.value })}
          className={cx(FIELD_BASE, FIELD_OK, INPUT, 'w-32 min-w-[8rem]')}
        />
      </td>

      <td className={CELL}>
        <button
          type="button"
          onClick={() => onRemove(line.key)}
          disabled={disabled}
          aria-label={`Remove line ${index + 1}`}
          title={generated ? 'Remove this line — untick the settlement to stop it coming back' : 'Remove this line'}
          className="aic inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </td>
    </tr>
  )
})

function stripExpiry(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null
  const { batch_expiry_date: _dropped, ...rest } = metadata
  return Object.keys(rest).length ? rest : null
}
