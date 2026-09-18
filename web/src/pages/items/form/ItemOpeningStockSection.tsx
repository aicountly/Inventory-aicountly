import { PackageCheck, Plus, Trash2 } from 'lucide-react'
import type { FormOptionUnit, ItemFormOptions } from '../../../services/items'
import { Input } from '../../../ui/Input'
import { AIC, cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'
import type { ItemFormState, OpeningDraft } from '../itemForm'
import { newOpening, openingValue } from '../itemForm'
import { Field, FieldIconButton, MasterSelect, SectionCard } from './FormControls'
import type { MasterOption } from './FormControls'

export interface ItemOpeningStockSectionProps {
  form: ItemFormState
  err: (key: string) => string | undefined
  readOnly: boolean
  options: ItemFormOptions | null
  /** Base unit plus this item's alternates — the only units an opening may be in. */
  itemUnits: FormOptionUnit[]
  /** Carried-forward FY the rows belong to; 0 = the inception opening. */
  effectiveFyId: number
  fyLabel: string | null
  onChange: (rows: OpeningDraft[]) => void
  currencyCode: string | null
}

/**
 * Opening stock per warehouse, unchanged in meaning from the old table — the
 * same rows, the same units, the same `PUT /v1/items/{id}/openings` payload.
 * Only the shape is new: a row is a card, so the same markup reads on a phone.
 */
export function ItemOpeningStockSection({
  form,
  err,
  readOnly,
  options,
  itemUnits,
  effectiveFyId,
  fyLabel,
  onChange,
  currencyCode,
}: ItemOpeningStockSectionProps) {
  const warehouses: MasterOption[] = (options?.warehouses ?? []).map((w) => ({ value: String(w.warehouse_id), label: w.warehouse_name }))
  const unitOptions: MasterOption[] = itemUnits.map((u) => ({ value: String(u.unit_id), label: u.unit_symbol ?? u.unit_name }))
  const total = form.openings.reduce((sum, o) => sum + openingValue(o.opening_qty, o.opening_valuation_rate), 0)

  const patch = (key: string, next: Partial<OpeningDraft>) =>
    onChange(form.openings.map((o) => (o.key === key ? { ...o, ...next } : o)))

  return (
    <SectionCard
      id="item-openings"
      icon={PackageCheck}
      title="Opening stock"
      description={
        effectiveFyId > 0
          ? `Carried-forward opening for ${fyLabel ?? `FY #${effectiveFyId}`}: the year-end close has run into this year, so it opens only on these rows.`
          : 'Inception opening: applies to every financial year the year-end close has not run into. One row per warehouse; leave the warehouse empty for a company-level opening.'
      }
    >
      {form.openings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-center text-[11px] text-gray-500">
          No opening stock. Add a row for each warehouse that already holds this item.
        </p>
      ) : (
        <ul className={cx(AIC, 'flex list-none flex-col gap-2 p-0')}>
          {form.openings.map((row, index) => {
            const rowError = err(`openings.${row.key}`)
            const value = openingValue(row.opening_qty, row.opening_valuation_rate)
            return (
              <li key={row.key} className={cx('rounded-xl border bg-white p-2.5', rowError ? 'border-red-200' : 'border-gray-200')}>
                <div className="grid grid-cols-12 items-end gap-2">
                  <Field id={`opening-wh-${row.key}`} label={`Warehouse ${index + 1}`} className="col-span-12 sm:col-span-4">
                    <MasterSelect
                      id={`opening-wh-${row.key}`}
                      value={row.warehouse_id}
                      onChange={(v) => patch(row.key, { warehouse_id: v })}
                      options={warehouses}
                      placeholder="Company level"
                      emptyLabel="No warehouses yet."
                      disabled={readOnly}
                    />
                  </Field>
                  <Field id={`opening-unit-${row.key}`} label="Unit" className="col-span-6 sm:col-span-2">
                    <MasterSelect
                      id={`opening-unit-${row.key}`}
                      value={row.unit_id}
                      onChange={(v) => patch(row.key, { unit_id: v })}
                      options={unitOptions}
                      placeholder="Select…"
                      emptyLabel="Pick a base unit first."
                      invalid={!!rowError}
                      disabled={readOnly}
                    />
                  </Field>
                  <Field id={`opening-qty-${row.key}`} label="Quantity" className="col-span-6 sm:col-span-2">
                    <Input
                      id={`opening-qty-${row.key}`}
                      size="md"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={row.opening_qty}
                      disabled={readOnly}
                      invalid={!!rowError}
                      onChange={(e) => patch(row.key, { opening_qty: e.target.value })}
                    />
                  </Field>
                  <Field id={`opening-rate-${row.key}`} label={currencyCode ? `Rate (${currencyCode})` : 'Rate'} className="col-span-6 sm:col-span-2">
                    <Input
                      id={`opening-rate-${row.key}`}
                      size="md"
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={row.opening_valuation_rate}
                      disabled={readOnly}
                      onChange={(e) => patch(row.key, { opening_valuation_rate: e.target.value })}
                    />
                  </Field>
                  <div className="col-span-6 sm:col-span-2 flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Value</span>
                      <strong className="mt-1 block truncate text-sm font-semibold tabular-nums text-gray-900">{formatQty(value, '0')}</strong>
                    </div>
                    {!readOnly ? (
                      <FieldIconButton
                        icon={Trash2}
                        tone="danger"
                        label={`Remove opening row ${index + 1}`}
                        onClick={() => onChange(form.openings.filter((o) => o.key !== row.key))}
                      />
                    ) : null}
                  </div>
                </div>
                {rowError ? <p className="mt-1.5 text-[11px] text-red-600">{rowError}</p> : null}
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange([...form.openings, newOpening(form.unit_id)])}
            disabled={!form.unit_id}
            title={form.unit_id ? undefined : 'Pick a base unit first'}
            className={cx(
              AIC,
              'inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-white px-3 text-xs font-bold text-primary transition-colors',
              'hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add opening row
          </button>
          {form.openings.length > 0 ? (
            <span className="text-[11px] text-gray-500">
              Total value <strong className="font-semibold tabular-nums text-gray-900">{formatQty(total, '0')}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  )
}

export default ItemOpeningStockSection
