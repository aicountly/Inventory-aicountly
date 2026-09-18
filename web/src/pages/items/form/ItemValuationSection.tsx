import { Barcode, BellRing, CalendarClock, Layers, ShieldAlert } from 'lucide-react'
import type { ItemFormOptions } from '../../../services/items'
import { Input } from '../../../ui/Input'
import { Select } from '../../../ui/Select'
import { humanize } from '../../../utils/format'
import type { ItemFormState } from '../itemForm'
import { Field, MasterSelect, SectionCard, TrackingTile, fieldDescribedBy } from './FormControls'
import type { MasterOption } from './FormControls'

export interface ItemValuationSectionProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  err: (key: string) => string | undefined
  readOnly: boolean
  options: ItemFormOptions | null
  currencyCode: string | null
  /** Edit mode: a method change on an item with movements re-costs its history. */
  isEdit: boolean
}

export function ItemValuationSection({ form, set, err, readOnly, options, currencyCode, isEdit }: ItemValuationSectionProps) {
  const methods = options?.valuation_methods ?? ['FIFO', 'LIFO', 'WAC']
  const policies = options?.negative_stock_policies ?? ['allow', 'warn', 'block']

  return (
    <SectionCard
      id="item-valuation"
      icon={Layers}
      title="Valuation and tracking"
      description="How stock of this item is costed, and what is traced through it."
    >
      <div className="grid grid-cols-12 gap-3">
        <Field
          id="valuation_method"
          label="Valuation method"
          error={err('valuation_method')}
          hint={isEdit ? 'Changing it on an item with movements re-costs its history.' : "Defaults to this company's method."}
          className="col-span-12 sm:col-span-6 md:col-span-4"
        >
          <Select
            id="valuation_method"
            size="md"
            value={form.valuation_method}
            disabled={readOnly}
            invalid={!!err('valuation_method')}
            aria-describedby={fieldDescribedBy('valuation_method', true)}
            onChange={(e) => set('valuation_method', e.target.value)}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="standard_cost"
          label={currencyCode ? `Standard cost (${currencyCode})` : 'Standard cost'}
          error={err('standard_cost')}
          hint="A reference cost per base unit. It does not replace the valuation method."
          className="col-span-12 sm:col-span-6 md:col-span-4"
        >
          <Input
            id="standard_cost"
            size="md"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className="text-right tabular-nums"
            value={form.standard_cost}
            disabled={readOnly}
            invalid={!!err('standard_cost')}
            aria-describedby={fieldDescribedBy('standard_cost', true)}
            onChange={(e) => set('standard_cost', e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <TrackingTile
          icon={ShieldAlert}
          title="Negative stock"
          description="What happens when an issue would take this item below zero."
        >
          <Select
            size="sm"
            aria-label="Negative stock policy"
            value={form.negative_stock_policy}
            disabled={readOnly}
            onChange={(e) => set('negative_stock_policy', e.target.value)}
          >
            <option value="">Company policy</option>
            {policies.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </Select>
        </TrackingTile>

        <TrackingTile
          icon={Layers}
          title="Track batches"
          description="Hold quantities and expiry batch by batch."
          checked={form.track_batch}
          onChange={(v) => set('track_batch', v)}
          disabled={readOnly}
        />

        <TrackingTile
          icon={Barcode}
          title="Track serials"
          description="Every unit carries its own serial number."
          checked={form.track_serial}
          onChange={(v) => set('track_serial', v)}
          disabled={readOnly}
        />

        <TrackingTile
          icon={CalendarClock}
          title="Track expiry"
          description="Record expiry dates against this item's batches."
          checked={form.track_expiry}
          onChange={(v) => set('track_expiry', v)}
          disabled={readOnly}
        >
          <div>
            <label htmlFor="shelf_life_days" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Shelf life (days)
            </label>
            <Input
              id="shelf_life_days"
              size="sm"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="text-right tabular-nums"
              value={form.shelf_life_days}
              disabled={readOnly}
              invalid={!!err('shelf_life_days')}
              aria-describedby="shelf_life_days-hint"
              onChange={(e) => set('shelf_life_days', e.target.value)}
            />
            <p id="shelf_life_days-hint" className={err('shelf_life_days') ? 'mt-1 text-[11px] text-red-600' : 'mt-1 text-[10px] text-gray-500'}>
              {err('shelf_life_days') ?? 'Fills a batch expiry from its manufacturing date.'}
            </p>
          </div>
        </TrackingTile>
      </div>
    </SectionCard>
  )
}

export interface ItemStockLevelsSectionProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  err: (key: string) => string | undefined
  readOnly: boolean
  options: ItemFormOptions | null
  optionsLoading: boolean
  optionsError: string | null
  onRetryOptions: () => void
}

const LEVEL_FIELDS: { key: keyof ItemFormState; label: string; hint: string; step?: number }[] = [
  { key: 'min_stock_qty', label: 'Minimum', hint: 'Below this the item is short.' },
  { key: 'max_stock_qty', label: 'Maximum', hint: 'Above this it is overstocked.' },
  { key: 'reorder_point_qty', label: 'Reorder point', hint: 'The replenishment report lists items at or below it.' },
  { key: 'reorder_qty', label: 'Reorder quantity', hint: 'How much to order when it is reached.' },
  { key: 'safety_stock_qty', label: 'Safety stock', hint: 'The buffer held against demand swings.' },
  { key: 'lead_time_days', label: 'Lead time (days)', hint: 'Days from order to receipt.', step: 1 },
]

/** Reorder rules and the default warehouse — stock items only, as before. */
export function ItemStockLevelsSection({ form, set, err, readOnly, options, optionsLoading, optionsError, onRetryOptions }: ItemStockLevelsSectionProps) {
  const warehouses: MasterOption[] = (options?.warehouses ?? []).map((w) => ({ value: String(w.warehouse_id), label: w.warehouse_name }))

  return (
    <SectionCard
      id="item-levels"
      icon={BellRing}
      title="Stock levels"
      description="What counts as short, as overstocked, and when to reorder."
    >
      <div className="grid grid-cols-12 gap-3">
        {LEVEL_FIELDS.map((f) => (
          <Field key={String(f.key)} id={String(f.key)} label={f.label} error={err(String(f.key))} hint={f.hint} className="col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3">
            <Input
              id={String(f.key)}
              size="md"
              type="number"
              min={0}
              step={f.step ?? 'any'}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={String(form[f.key] ?? '')}
              disabled={readOnly}
              invalid={!!err(String(f.key))}
              aria-describedby={fieldDescribedBy(String(f.key), true)}
              onChange={(e) => set(f.key, e.target.value as ItemFormState[typeof f.key])}
            />
          </Field>
        ))}

        <Field
          id="default_warehouse_id"
          label="Default warehouse"
          error={err('default_warehouse_id')}
          hint="Pre-selected on documents that move this item."
          className="col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3"
        >
          <MasterSelect
            id="default_warehouse_id"
            value={form.default_warehouse_id}
            onChange={(v) => set('default_warehouse_id', v)}
            options={warehouses}
            placeholder="— None —"
            emptyLabel="No warehouses yet."
            disabled={readOnly}
            loading={optionsLoading}
            error={optionsError}
            onRetry={onRetryOptions}
            describedBy={fieldDescribedBy('default_warehouse_id', true)}
          />
        </Field>
      </div>
    </SectionCard>
  )
}
