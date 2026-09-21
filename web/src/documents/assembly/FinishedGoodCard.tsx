import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Hash, Info, PackagePlus } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { FormField } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'
import { BatchPicker } from '../BatchPicker'
import { ItemThumb } from '../LineCells'
import { LineItemPicker } from '../LineItemPicker'
import { SerialPicker } from '../SerialPicker'
import { WarehouseSelect } from '../WarehouseSelect'
import { unitOptionsFrom } from '../LineEditor'
import { lineBaseQty } from '../formModel'
import type { LineDraft } from '../formModel'
import type { AssemblyCostSummary, AssemblyErrors } from './assemblyModel'

export interface FinishedGoodCardProps {
  finished: LineDraft
  warehouses: FormOptionWarehouse[]
  defaultWarehouseId: number | null
  cost: AssemblyCostSummary
  costHidden: boolean
  costLoading: boolean
  /** Writes an amount in the company's own currency — see AssemblyPage. */
  formatAmount: (value: number) => string
  errors: AssemblyErrors
  disabled: boolean
  onChange: (patch: Partial<LineDraft>) => void
}

/**
 * Everything this assembly CREATES.
 *
 * Deliberately a card and not a row: one output, with its own tracking, its own warehouse and the
 * cost it will enter stock at, read as a unit. The cost panel underneath is the whole reason the
 * two halves sit side by side — it answers "what will this kit be worth" while the components
 * that decide the answer are still on screen.
 */
export function FinishedGoodCard({
  finished,
  warehouses,
  defaultWarehouseId,
  cost,
  costHidden,
  costLoading,
  formatAmount,
  errors,
  disabled,
  onChange,
}: FinishedGoodCardProps) {
  const ids = useId()

  const pick = (row: ItemSearchRow) => {
    const units = unitOptionsFrom(row)
    const def = units.find((u) => u.is_default) ?? units[0]
    onChange({
      item_id: row.item_id,
      item_name: row.print_name || row.item_name,
      item_sku: row.item_sku,
      track_batch: Number(row.track_batch) === 1,
      track_serial: Number(row.track_serial) === 1,
      units,
      unit_id: def?.unit_id ?? row.unit_id ?? null,
      warehouse_id: finished.warehouse_id ?? row.default_warehouse_id ?? defaultWarehouseId ?? null,
      batch_id: null,
      batch_no: null,
      serials: [],
    })
  }

  const clear = () =>
    onChange({
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

  const unit = finished.units.find((u) => u.unit_id === finished.unit_id)

  return (
    <section
      aria-labelledby="assembly-finished-heading"
      className={cx(AIC, 'flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white shadow-card')}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600" aria-hidden>
          <PackagePlus className="h-4 w-4" />
        </span>
        <h2 id="assembly-finished-heading" className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
          Assembled item (finished good)
        </h2>
        <Badge tone="success" size="xs" className="normal-case">
          Created to stock
        </Badge>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {finished.item_id === null ? (
          <FormField label="Item" htmlFor={`${ids}-item`} required error={errors.finished.item_id}>
            <LineItemPicker
              itemId={null}
              itemName=""
              itemSku={null}
              warehouseId={finished.warehouse_id ?? defaultWarehouseId}
              onPick={pick}
              onClear={clear}
              disabled={disabled}
              invalid={Boolean(errors.finished.item_id)}
            />
          </FormField>
        ) : (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Item<span className="ml-0.5 text-red-500" aria-hidden>*</span>
            </p>
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-2.5">
              <ItemThumb name={finished.item_name || '?'} tone="primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{finished.item_name}</p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {[finished.item_sku, finished.track_batch ? 'batch tracked' : null, finished.track_serial ? 'serial tracked' : null]
                    .filter(Boolean)
                    .join(' · ') || 'Finished good'}
                </p>
                <div className="mt-1 flex items-center gap-2.5">
                  <Link
                    to={`/items/${finished.item_id}`}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    View details
                  </Link>
                  {!disabled ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-gray-500 hover:text-primary hover:underline"
                      onClick={clear}
                    >
                      Change item
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {errors.finished.item_id ? <p className="mt-1 text-[11px] text-red-600">{errors.finished.item_id}</p> : null}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Batch / serial"
            htmlFor={`${ids}-batch`}
            error={errors.finished.batch_id ?? errors.finished.serials}
            hint={!finished.track_batch && !finished.track_serial && finished.item_id ? 'This item is not tracked.' : undefined}
            className="sm:col-span-2"
          >
            {finished.item_id && finished.track_batch ? (
              <BatchPicker
                variant="field"
                autoLabel="AUTO — new batch on posting"
                itemId={finished.item_id}
                warehouseId={finished.warehouse_id ?? defaultWarehouseId}
                value={finished.batch_id}
                invalid={Boolean(errors.finished.batch_id)}
                onChange={(b) => onChange({ batch_id: b?.batch_id ?? null, batch_no: b?.batch_no ?? null })}
                allowCreate
                disabled={disabled}
              />
            ) : null}
            {finished.item_id && finished.track_serial ? (
              <div className={finished.track_batch ? 'mt-1' : undefined}>
                <SerialPicker
                  itemId={finished.item_id}
                  itemName={finished.item_name}
                  warehouseId={finished.warehouse_id ?? defaultWarehouseId}
                  batchId={finished.batch_id}
                  direction="in"
                  value={finished.serials}
                  onChange={(serials) => onChange({ serials })}
                  requiredCount={lineBaseQty(finished)}
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
            {!finished.item_id || (!finished.track_batch && !finished.track_serial) ? (
              <Input
                id={`${ids}-batch`}
                value={finished.batch_no ?? ''}
                placeholder={finished.item_id ? 'Not tracked' : 'Pick an item first'}
                disabled
                aria-describedby={undefined}
              />
            ) : null}
          </FormField>

          <FormField label="Warehouse" htmlFor={`${ids}-wh`} required error={errors.finished.warehouse_id}>
            <WarehouseSelect
              id={`${ids}-wh`}
              variant="field"
              value={finished.warehouse_id}
              onChange={(id) => onChange({ warehouse_id: id, batch_id: null, batch_no: null, serials: [] })}
              warehouses={warehouses}
              emptyLabel="Use assembly warehouse"
              disabled={disabled}
              invalid={Boolean(errors.finished.warehouse_id)}
            />
          </FormField>

          <FormField label="Quantity" htmlFor={`${ids}-qty`} required error={errors.finished.qty}>
            <Input
              id={`${ids}-qty`}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={finished.qty}
              disabled={disabled}
              invalid={Boolean(errors.finished.qty)}
              onChange={(e) => onChange({ qty: e.target.value })}
            />
          </FormField>

          <FormField
            label="Unit"
            htmlFor={`${ids}-unit`}
            required
            className="sm:col-span-2"
            hint={unit && unit.conversion_factor !== 1 ? `1 ${unit.unit_symbol ?? ''} = ${formatQty(unit.conversion_factor)} base units` : undefined}
          >
            {finished.units.length > 0 ? (
              <Select
                id={`${ids}-unit`}
                value={finished.unit_id ?? ''}
                disabled={disabled || finished.units.length === 1}
                onChange={(e) => onChange({ unit_id: e.target.value === '' ? null : Number(e.target.value) })}
              >
                {finished.units.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.unit_symbol ?? u.unit_name ?? u.unit_id}
                    {u.conversion_factor !== 1 ? ` ×${formatQty(u.conversion_factor)}` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={`${ids}-unit`} value="" placeholder="From the item" disabled />
            )}
          </FormField>
        </div>

        {!costHidden ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                Expected cost
                <Tooltip label="Estimated inventory cost derived from the components consumed. The final valuation is decided by the company's configured valuation method when the document posts.">
                  <span className="inline-flex cursor-help text-emerald-600">
                    <Info className="h-3 w-3" aria-hidden />
                    <span className="sr-only">
                      Estimated inventory cost derived from the components consumed. The final valuation is decided by
                      the configured valuation method when the document posts.
                    </span>
                  </span>
                </Tooltip>
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-emerald-700">
                {cost.partial
                  ? `${cost.unpricedLines} component${cost.unpricedLines === 1 ? '' : 's'} have no cost on record, so this is a floor.`
                  : 'Auto-calculated from the components consumed.'}
              </p>
            </div>
            <p className="shrink-0 text-lg font-bold tabular-nums text-emerald-700">
              {costLoading ? (
                <span className="text-sm font-medium text-emerald-600">Calculating…</span>
              ) : (
                formatAmount(cost.expectedCost)
              )}
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[11px] leading-snug text-gray-600">
            Inventory cost is not shown: your profile does not hold the stock valuation permission. The document still
            posts at the cost the valuation method resolves.
          </p>
        )}
      </div>
    </section>
  )
}

export default FinishedGoodCard
