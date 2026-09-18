import { Plus, Ruler, Trash2 } from 'lucide-react'
import { UOM_ROLES } from '../../../services/items'
import type { ItemFormOptions } from '../../../services/items'
import { Input } from '../../../ui/Input'
import { AIC, cx } from '../../../ui/cx'
import { humanize, toNumber } from '../../../utils/format'
import type { ItemFormState, UnitLineDraft } from '../itemForm'
import { newUnitLine } from '../itemForm'
import { Field, FieldIconButton, MasterSelect, SectionCard, fieldDescribedBy } from './FormControls'
import type { MasterOption } from './FormControls'

export interface ItemUnitsSectionProps {
  form: ItemFormState
  set: <K extends keyof ItemFormState>(key: K, value: ItemFormState[K]) => void
  err: (key: string) => string | undefined
  readOnly: boolean
  options: ItemFormOptions | null
  optionsLoading: boolean
  optionsError: string | null
  onRetryOptions: () => void
  /** The page decides whether changing the base unit needs a confirmation. */
  onChangeBaseUnit: (nextUnitId: string) => void
}

export function ItemUnitsSection({
  form,
  set,
  err,
  readOnly,
  options,
  optionsLoading,
  optionsError,
  onRetryOptions,
  onChangeBaseUnit,
}: ItemUnitsSectionProps) {
  const units = options?.units ?? []
  const unitOptions: MasterOption[] = units.map((u) => ({
    value: String(u.unit_id),
    label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}`,
  }))
  const baseUnit = units.find((u) => String(u.unit_id) === form.unit_id) ?? null
  const baseSymbol = baseUnit?.unit_symbol ?? baseUnit?.unit_name ?? 'base unit'
  const alternateOptions = unitOptions.filter((o) => o.value !== form.unit_id)
  const shared = { disabled: readOnly, loading: optionsLoading, error: optionsError, onRetry: onRetryOptions }

  const patchLine = (key: string, patch: Partial<UnitLineDraft>) =>
    set('unitLines', form.unitLines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <SectionCard
      id="item-units"
      icon={Ruler}
      title="Units"
      description="Stock is kept in the base unit. Alternate units convert into it."
    >
      <div className="grid grid-cols-12 gap-3">
        <Field
          id="unit_id"
          label="Base unit"
          required
          error={err('unit_id')}
          hint="Every quantity and every valuation is held in this unit."
          className="col-span-12 md:col-span-4"
        >
          <MasterSelect
            id="unit_id"
            value={form.unit_id}
            onChange={onChangeBaseUnit}
            options={unitOptions}
            placeholder="Select…"
            emptyLabel="No units of measure yet."
            invalid={!!err('unit_id')}
            describedBy={fieldDescribedBy('unit_id', true)}
            {...shared}
          />
        </Field>

        <Field
          id="purchase_unit_id"
          label="Purchase unit"
          error={err('purchase_unit_id')}
          hint="Defaults to the base unit."
          className="col-span-12 sm:col-span-6 md:col-span-4"
        >
          <MasterSelect
            id="purchase_unit_id"
            value={form.purchase_unit_id}
            onChange={(v) => set('purchase_unit_id', v)}
            options={unitOptions}
            placeholder="Base unit"
            emptyLabel="No units of measure yet."
            describedBy={fieldDescribedBy('purchase_unit_id', true)}
            {...shared}
          />
        </Field>

        <Field
          id="sales_unit_id"
          label="Sales unit"
          error={err('sales_unit_id')}
          hint="Defaults to the base unit."
          className="col-span-12 sm:col-span-6 md:col-span-4"
        >
          <MasterSelect
            id="sales_unit_id"
            value={form.sales_unit_id}
            onChange={(v) => set('sales_unit_id', v)}
            options={unitOptions}
            placeholder="Base unit"
            emptyLabel="No units of measure yet."
            describedBy={fieldDescribedBy('sales_unit_id', true)}
            {...shared}
          />
        </Field>
      </div>

      <div className={cx(AIC, 'mt-4 rounded-xl border border-primary/15 bg-primary-light/25 p-3')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[0.8125rem] font-semibold text-gray-900">Alternate units</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              Enter how many base units make one of the alternate — a box of twelve pieces is 12.
            </p>
          </div>
        </div>

        {form.unitLines.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-primary/25 bg-white/70 px-3 py-3 text-center text-[11px] text-gray-500">
            No alternate units. This item is bought, sold and stocked in {baseUnit ? baseSymbol : 'its base unit'}.
          </p>
        ) : (
          <ul className={cx(AIC, 'mt-3 flex list-none flex-col gap-2 p-0')}>
            {form.unitLines.map((line, index) => {
              const lineError = err(`unitLines.${line.key}`)
              const factor = toNumber(line.conversion_factor)
              const altLabel = unitOptions.find((o) => o.value === line.unit_id)?.label ?? null
              const preview =
                altLabel && factor !== null && factor > 0 && baseUnit ? `1 ${altLabel} = ${factor} ${baseSymbol}` : null
              return (
                <li
                  key={line.key}
                  className={cx(
                    'rounded-xl border bg-white p-2.5',
                    lineError ? 'border-red-200' : 'border-gray-200',
                  )}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[8rem] flex-1">
                      <label htmlFor={`alt-unit-${line.key}`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Alternate unit {index + 1}
                      </label>
                      <MasterSelect
                        id={`alt-unit-${line.key}`}
                        value={line.unit_id}
                        onChange={(v) => patchLine(line.key, { unit_id: v })}
                        options={alternateOptions}
                        placeholder="Select…"
                        emptyLabel="No other units available."
                        invalid={!!lineError}
                        {...shared}
                      />
                    </div>
                    <span className="hidden pb-2 text-sm font-bold text-gray-400 sm:inline" aria-hidden>
                      =
                    </span>
                    <div className="w-24">
                      <label htmlFor={`alt-factor-${line.key}`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Quantity
                      </label>
                      <Input
                        id={`alt-factor-${line.key}`}
                        size="md"
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={line.conversion_factor}
                        disabled={readOnly}
                        invalid={!!lineError}
                        onChange={(e) => patchLine(line.key, { conversion_factor: e.target.value })}
                      />
                    </div>
                    <span className="pb-2 text-xs font-semibold text-gray-600">{baseSymbol}</span>
                    <div className="min-w-[8rem] flex-1">
                      <label htmlFor={`alt-role-${line.key}`} className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Role
                      </label>
                      <MasterSelect
                        id={`alt-role-${line.key}`}
                        value={line.uom_role}
                        onChange={(v) => patchLine(line.key, { uom_role: v })}
                        options={UOM_ROLES.filter((r) => r !== 'base').map((r) => ({ value: r, label: humanize(r) }))}
                        placeholder="— None —"
                        disabled={readOnly}
                      />
                    </div>
                    {!readOnly ? (
                      <div className="pb-px">
                        <FieldIconButton
                          icon={Trash2}
                          tone="danger"
                          label={`Remove alternate unit ${index + 1}`}
                          onClick={() => set('unitLines', form.unitLines.filter((l) => l.key !== line.key))}
                        />
                      </div>
                    ) : null}
                  </div>
                  {lineError ? (
                    <p className="mt-1.5 text-[11px] text-red-600">{lineError}</p>
                  ) : preview ? (
                    <p className="mt-1.5 text-[11px] font-medium text-gray-500">{preview}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {!readOnly ? (
          <button
            type="button"
            onClick={() => set('unitLines', [...form.unitLines, newUnitLine()])}
            disabled={!form.unit_id}
            className={cx(
              AIC,
              'mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-white/70 text-xs font-bold text-primary transition-colors',
              'hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50',
            )}
            title={form.unit_id ? undefined : 'Pick a base unit first'}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add alternate unit
          </button>
        ) : null}
      </div>
    </SectionCard>
  )
}

export default ItemUnitsSection
