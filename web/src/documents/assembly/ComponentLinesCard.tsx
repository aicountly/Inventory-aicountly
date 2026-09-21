import { useCallback, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { FileDown, Hash, Layers, ListPlus, PackageMinus, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { CellMessage, NumberCell, PickedItemCell } from '../LineCells'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { unitOptionsFrom } from '../LineEditor'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import type { AssemblyCostSummary, AssemblyErrors } from './assemblyModel'

export interface ComponentLinesCardProps {
  components: LineDraft[]
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  availability: Record<string, AvailabilityCheckResult>
  checkingAvailability: boolean
  cost: AssemblyCostSummary
  costHidden: boolean
  /** Writes an amount in the company's own currency — see AssemblyPage. */
  formatAmount: (value: number) => string
  errors: AssemblyErrors
  offendingKeys: ReadonlySet<string>
  disabled: boolean
  loading: boolean
  onChange: (components: LineDraft[]) => void
  /** Appends one blank row. Owned by the page so every new line is built by `newComponentLine`. */
  onAddRow: () => void
  onImportBom: () => void
  onAddMultiple: () => void
  /** Rendered under the table — the availability panel. */
  footer?: ReactNode
}

const HEAD_CELL = 'px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap'
const BODY_CELL = 'px-2 py-1.5 align-top'

/** The controls Enter walks, in the order the browser reports them. */
const ENTRY_FIELDS = 'input[role="combobox"], input[inputmode="decimal"], select'

/** Stable id of a row's quantity field, so picking an item can put the caret in it. */
function qtyFieldId(key: string): string {
  return `assembly-qty-${key}`
}

/**
 * Everything this assembly CONSUMES.
 *
 * One row per component, optimised for entry rather than for reading: Enter walks the row and
 * then starts the next one, picking an item jumps straight to its quantity, and the availability
 * of what the row is about to take out sits under the item name where the quantity is typed —
 * not in a column at the far right of a table that scrolls sideways.
 *
 * The cells themselves come from `documents/LineCells`, the same ones the disassembly workspace
 * draws, so the two sides of the same idea look and behave alike.
 */
export function ComponentLinesCard({
  components,
  warehouses,
  defaultWarehouseId,
  availability,
  checkingAvailability,
  cost,
  costHidden,
  formatAmount,
  errors,
  offendingKeys,
  disabled,
  loading,
  onChange,
  onAddRow,
  onImportBom,
  onAddMultiple,
  footer,
}: ComponentLinesCardProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const costByKey = new Map(cost.rows.map((r) => [r.key, r]))

  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(components.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const remove = (key: string) => onChange(components.filter((l) => l.key !== key))

  const focusQty = useCallback((key: string) => {
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector<HTMLInputElement>(`[id="${qtyFieldId(key)}"]`)?.focus()
    })
  }, [])

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
      warehouse_id: line.warehouse_id ?? row.default_warehouse_id ?? defaultWarehouseId ?? null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })
    focusQty(line.key)
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

  /**
   * Enter walks the row.
   *
   * The typeahead calls preventDefault when Enter picks a suggestion, so a prevented event is one
   * that has already been answered and is left alone. At the end of the last row Enter opens a
   * new one, which is how a keyboard-only user adds the fifth component without reaching for the
   * mouse.
   */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || disabled) return
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return
    const body = bodyRef.current
    if (!body) return
    // DOM order IS entry order: the typeahead, then batch, warehouse, quantity and unit of each
    // row. Selected by what the controls ARE rather than by a marker attribute, so a cell that
    // swaps one field for another (a tracked item growing a batch dropdown) stays in the walk.
    const fields = [...body.querySelectorAll<HTMLElement>(ENTRY_FIELDS)].filter(
      (el) => !(el as HTMLInputElement).disabled,
    )
    const index = fields.indexOf(target)
    if (index === -1) return
    e.preventDefault()
    const next = fields[index + 1]
    if (next) {
      next.focus()
      return
    }
    addRow()
  }

  /** Adds a row and puts the caret in its item field, so Enter keeps typing rather than stopping. */
  const addRow = () => {
    onAddRow()
    requestAnimationFrame(() => {
      const fields = bodyRef.current?.querySelectorAll<HTMLElement>('input[role="combobox"]')
      fields?.[fields.length - 1]?.focus()
    })
  }

  const availabilityChip = (line: LineDraft) => {
    if (!line.item_id) return null
    const result = availability[line.key]
    if (!result) {
      return checkingAvailability ? (
        <span className="text-[10px] text-gray-400">checking availability…</span>
      ) : null
    }
    return result.ok ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        {formatQty(result.available)} available
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
        short by {formatQty(shortBy(result))}
      </span>
    )
  }

  return (
    <section
      aria-labelledby="assembly-components-heading"
      className={cx(AIC, 'flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white shadow-card')}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600" aria-hidden>
            <PackageMinus className="h-4 w-4" />
          </span>
          <h2 id="assembly-components-heading" className="truncate text-sm font-semibold text-gray-900">
            Components (materials out)
          </h2>
          <Badge tone="danger" size="xs" className="normal-case">
            Consumed from stock
          </Badge>
        </div>
        <Button variant="outline" size="xs" icon={FileDown} onClick={onImportBom} disabled={disabled}>
          Import from BOM
        </Button>
      </header>

      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse">
          <caption className="sr-only">Components consumed by this assembly</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className={cx(HEAD_CELL, 'w-8')}>
                #
              </th>
              <th scope="col" className={cx(HEAD_CELL, 'min-w-[14rem]')}>
                Item / component
              </th>
              <th scope="col" className={cx(HEAD_CELL, 'min-w-[9rem]')}>
                Batch / serial
              </th>
              <th scope="col" className={cx(HEAD_CELL, 'min-w-[9rem]')}>
                Warehouse
              </th>
              <th scope="col" className={cx(HEAD_CELL, 'w-24 text-right')}>
                Qty
              </th>
              <th scope="col" className={cx(HEAD_CELL, 'w-24')}>
                Unit
              </th>
              {!costHidden ? (
                <>
                  <th scope="col" className={cx(HEAD_CELL, 'w-28 text-right')}>
                    Unit cost
                  </th>
                  <th scope="col" className={cx(HEAD_CELL, 'w-28 text-right')}>
                    Amount
                  </th>
                </>
              ) : null}
              <th scope="col" className={cx(HEAD_CELL, 'w-10')}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onBodyKeyDown} className="divide-y divide-gray-100">
            {loading && components.length === 0
              ? Array.from({ length: 2 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td className={BODY_CELL} colSpan={costHidden ? 7 : 9}>
                      <Skeleton height="h-8" />
                    </td>
                  </tr>
                ))
              : null}
            {!loading && components.length === 0 ? (
              <tr>
                <td className={cx(BODY_CELL, 'py-6 text-center')} colSpan={costHidden ? 7 : 9}>
                  <p className="text-sm font-semibold text-gray-900">No components yet</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Add the materials this assembly consumes, or import them from a bill of materials.
                  </p>
                </td>
              </tr>
            ) : null}
            {components.map((line, index) => {
              const rowErrors = errors.components[line.key] ?? {}
              const rowCost = costByKey.get(line.key)
              const offending = offendingKeys.has(line.key)
              return (
                <tr
                  key={line.key}
                  className={cx('align-top transition-colors', offending ? 'bg-red-50/60' : 'hover:bg-gray-50/60')}
                >
                  <td className={cx(BODY_CELL, 'pt-3 text-xs text-gray-400')}>{index + 1}</td>

                  <td className={BODY_CELL}>
                    {line.item_id === null ? (
                      <LineItemPicker
                        itemId={null}
                        itemName=""
                        itemSku={null}
                        warehouseId={line.warehouse_id ?? defaultWarehouseId}
                        onPick={(row) => pick(line, row)}
                        onClear={() => clear(line)}
                        disabled={disabled}
                        invalid={Boolean(rowErrors.item_id) || offending}
                      />
                    ) : (
                      <PickedItemCell line={line} tone="sky" onChangeItem={() => clear(line)} disabled={disabled} />
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {availabilityChip(line)}
                      {line.origin === 'bom' ? (
                        <Badge tone="info" size="xs">
                          BOM
                        </Badge>
                      ) : null}
                    </div>
                    {rowErrors.item_id ? <CellMessage message={rowErrors.item_id} severity="error" /> : null}
                  </td>

                  <td className={BODY_CELL}>
                    {line.item_id && line.track_batch ? (
                      <BatchPicker
                        variant="field"
                        itemId={line.item_id}
                        warehouseId={line.warehouse_id ?? defaultWarehouseId}
                        value={line.batch_id}
                        invalid={Boolean(rowErrors.batch_id)}
                        onChange={(b) => update(line.key, { batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null, serials: [] })}
                        allowCreate={false}
                        disabled={disabled}
                      />
                    ) : null}
                    {line.item_id && line.track_serial ? (
                      <div className={line.track_batch ? 'mt-1.5' : undefined}>
                        <SerialPicker
                          itemId={line.item_id}
                          itemName={line.item_name}
                          warehouseId={line.warehouse_id ?? defaultWarehouseId}
                          batchId={line.batch_id}
                          direction="out"
                          value={line.serials}
                          onChange={(serials) => update(line.key, { serials })}
                          requiredCount={lineBaseQty(line)}
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
                    {line.item_id && !line.track_batch && !line.track_serial ? (
                      <span className="inline-flex h-8 items-center text-xs text-gray-400">Not tracked</span>
                    ) : null}
                    {!line.item_id ? <span className="inline-flex h-8 items-center text-xs text-gray-300">—</span> : null}
                    {rowErrors.batch_id ? <CellMessage message={rowErrors.batch_id} severity="error" /> : null}
                    {rowErrors.serials ? <CellMessage message={rowErrors.serials} severity="error" /> : null}
                  </td>

                  <td className={BODY_CELL}>
                    <WarehouseSelect
                      variant="field"
                      value={line.warehouse_id}
                      aria-label={`Warehouse for component ${index + 1}`}
                      onChange={(id) => update(line.key, { warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
                      warehouses={warehouses}
                      emptyLabel="Use assembly warehouse"
                      disabled={disabled}
                      invalid={Boolean(rowErrors.warehouse_id)}
                    />
                    {rowErrors.warehouse_id ? <CellMessage message={rowErrors.warehouse_id} severity="error" /> : null}
                  </td>

                  <td className={BODY_CELL}>
                    <NumberCell
                      id={qtyFieldId(line.key)}
                      ariaLabel={`Quantity for component ${index + 1}`}
                      value={line.qty}
                      disabled={disabled}
                      invalid={Boolean(rowErrors.qty)}
                      onChange={(v) => update(line.key, { qty: v })}
                    />
                    {rowErrors.qty ? <CellMessage message={rowErrors.qty} severity="error" /> : null}
                  </td>

                  <td className={BODY_CELL}>
                    {line.units.length > 0 ? (
                      <Select
                        aria-label={`Unit for component ${index + 1}`}
                        value={line.unit_id ?? ''}
                        disabled={disabled || line.units.length === 1}
                        onChange={(e) => update(line.key, { unit_id: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        {line.units.map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                            {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="inline-flex h-8 items-center text-xs text-gray-300">—</span>
                    )}
                  </td>

                  {!costHidden ? (
                    <>
                      <td className={cx(BODY_CELL, 'pt-2.5 text-right text-sm tabular-nums text-gray-700')}>
                        {rowCost?.enteredUnitCost != null ? (
                          formatAmount(rowCost.enteredUnitCost)
                        ) : line.item_id ? (
                          <span className="text-xs text-gray-400" title="No cost on record for this item yet">
                            no cost
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className={cx(BODY_CELL, 'pt-2.5 text-right text-sm font-semibold tabular-nums text-gray-900')}>
                        {rowCost?.amount != null ? formatAmount(rowCost.amount) : <span className="text-gray-300">—</span>}
                      </td>
                    </>
                  ) : null}

                  <td className={cx(BODY_CELL, 'pt-2')}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove component ${index + 1}`}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => remove(line.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button variant="outline" size="xs" icon={Plus} onClick={addRow} disabled={disabled}>
          Add component
        </Button>
        <Button variant="ghost" size="xs" icon={ListPlus} onClick={onAddMultiple} disabled={disabled}>
          Add multiple items
        </Button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-500">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          {cost.rows.length} component{cost.rows.length === 1 ? '' : 's'}
          {!costHidden && cost.componentCost > 0 ? (
            <>
              <span aria-hidden>·</span>
              <strong className="font-semibold tabular-nums text-gray-800">{formatAmount(cost.componentCost)}</strong>
            </>
          ) : null}
        </span>
      </div>

      {footer ? <div className="border-t border-gray-100 px-4 py-3">{footer}</div> : null}
    </section>
  )
}

export default ComponentLinesCard
