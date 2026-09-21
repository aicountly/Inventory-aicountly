import { AlertTriangle, Boxes, CalendarClock, Layers, Plus, ShieldCheck, Trash2, Warehouse } from 'lucide-react'
import type { ItemFormOptions } from '../../services/items'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import { formatQty, humanize } from '../../utils/format'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { FieldNote, NumberField, SelectField, SubPanel, ToggleField } from './ItemWorkspaceKit'
import { newOpening, openingValue } from './itemForm'
import type { OpeningDraft } from './itemForm'

/**
 * Tracking, levels, the default location and the opening balance.
 *
 * ## Progressive disclosure, without hiding anything that is set
 *
 * Shelf life only appears once expiry is tracked, because a shelf life on an item nobody dates is
 * a number that never gets used. The rule is one-way: a field is revealed by its switch, never
 * hidden while it holds a value that would be saved — turning expiry off leaves the shelf life
 * visible so the user can see what they are about to stop using.
 *
 * ## Opening stock
 *
 * Untouched from the old screen, including the carried-forward / inception distinction, which is
 * the API's (`effective_fy_id`) and not a display choice. Editing a row marks openings dirty, and
 * only then does the page issue the separate `PUT /items/{id}/openings`.
 */
export interface ItemStockLocationsCardProps extends ItemCardBaseProps {
  options: ItemFormOptions | null
  /** Units on this item — openings may only be entered in one of them. */
  itemUnits: { unit_id: number; unit_name: string; unit_symbol: string | null }[]
  openings: OpeningDraft[]
  onOpeningsChange: (rows: OpeningDraft[]) => void
  /** Copy for the opening panel: which financial year these rows open. */
  openingScopeNote: string
  /** Null when the company's base currency is not readable here. */
  currencySymbol: string | null
}

export function ItemStockLocationsCard({
  form,
  set,
  err,
  readOnly,
  registerSection,
  options,
  itemUnits,
  openings,
  onOpeningsChange,
  openingScopeNote,
  currencySymbol,
}: ItemStockLocationsCardProps) {
  const isStock = form.item_type === 'stock'
  const warehouseOpts = (options?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name }))
  const expiryWithoutBatch = form.track_expiry && !form.track_batch
  const patchOpening = (key: string, patch: Partial<OpeningDraft>) =>
    onOpeningsChange(openings.map((o) => (o.key === key ? { ...o, ...patch } : o)))

  return (
    <ItemSectionCard
      id="stock"
      title="Stock & Locations"
      description="Configure inventory tracking, stock levels and where this item lives"
      icon={Boxes}
      register={registerSection}
    >
      {!isStock ? (
        <FieldNote tone="info">
          This is a <strong>{humanize(form.item_type)}</strong> item, so it holds no quantity. Tracking, stock levels
          and opening balances apply to stock items only — switch the item type in Basic Details to configure them.
        </FieldNote>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <ToggleField
              name="track_batch"
              label="Track batches"
              icon={Layers}
              description="Every receipt and issue identifies a batch."
              checked={form.track_batch}
              disabled={readOnly}
              onChange={(v) => set('track_batch', v)}
            />
            <ToggleField
              name="track_serial"
              label="Track serial numbers"
              icon={ShieldCheck}
              description="Each unit is registered and followed individually."
              checked={form.track_serial}
              disabled={readOnly}
              onChange={(v) => set('track_serial', v)}
            />
            <ToggleField
              name="track_expiry"
              label="Track expiry"
              icon={CalendarClock}
              description="Batches carry a manufacturing and expiry date."
              checked={form.track_expiry}
              disabled={readOnly}
              onChange={(v) => set('track_expiry', v)}
            />
          </div>

          {expiryWithoutBatch ? (
            <FieldNote tone="danger" icon={AlertTriangle} className="mt-3">
              <strong>Expiry is tracked but batches are not.</strong> An expiry date belongs to a batch — without batch
              tracking there is nothing for a date to attach to. Turn on batch tracking as well.
            </FieldNote>
          ) : null}

          <FormGrid cols={3} gap="md" className="mt-4">
            {form.track_expiry || form.shelf_life_days ? (
              <NumberField
                name="shelf_life_days"
                label="Shelf life"
                value={form.shelf_life_days}
                step={1}
                suffix="days"
                disabled={readOnly}
                error={err('shelf_life_days')}
                hint="Fills a batch expiry from its manufacturing date."
                onChange={(v) => set('shelf_life_days', v)}
              />
            ) : null}
            <SelectField
              name="negative_stock_policy"
              label="Negative stock"
              value={form.negative_stock_policy}
              disabled={readOnly}
              error={err('negative_stock_policy')}
              emptyLabel="Company policy"
              options={(options?.negative_stock_policies ?? ['allow', 'warn', 'block']).map((p) => ({
                value: p,
                label: humanize(p),
              }))}
              onChange={(v) => set('negative_stock_policy', v)}
              hint="Overrides the company default for this item only."
            />
            <SelectField
              name="default_warehouse_id"
              label="Default warehouse"
              value={form.default_warehouse_id}
              disabled={readOnly}
              error={err('default_warehouse_id')}
              options={warehouseOpts}
              onChange={(v) => set('default_warehouse_id', v)}
              hint="Pre-selected on new documents."
            />
          </FormGrid>

          <SubPanel className="mt-4" title="Stock levels" description="What replenishment reports compare the balance against">
            <div className="p-3">
              <FormGrid cols={3} gap="md">
                <NumberField
                  name="min_stock_qty"
                  label="Minimum"
                  value={form.min_stock_qty}
                  disabled={readOnly}
                  error={err('min_stock_qty')}
                  onChange={(v) => set('min_stock_qty', v)}
                />
                <NumberField
                  name="max_stock_qty"
                  label="Maximum"
                  value={form.max_stock_qty}
                  disabled={readOnly}
                  error={err('max_stock_qty')}
                  onChange={(v) => set('max_stock_qty', v)}
                />
                <NumberField
                  name="reorder_point_qty"
                  label="Reorder point"
                  value={form.reorder_point_qty}
                  disabled={readOnly}
                  error={err('reorder_point_qty')}
                  onChange={(v) => set('reorder_point_qty', v)}
                />
                <NumberField
                  name="reorder_qty"
                  label="Reorder quantity"
                  value={form.reorder_qty}
                  disabled={readOnly}
                  error={err('reorder_qty')}
                  onChange={(v) => set('reorder_qty', v)}
                />
                <NumberField
                  name="safety_stock_qty"
                  label="Safety stock"
                  value={form.safety_stock_qty}
                  disabled={readOnly}
                  error={err('safety_stock_qty')}
                  onChange={(v) => set('safety_stock_qty', v)}
                />
                <NumberField
                  name="lead_time_days"
                  label="Lead time"
                  value={form.lead_time_days}
                  step={1}
                  suffix="days"
                  disabled={readOnly}
                  error={err('lead_time_days')}
                  onChange={(v) => set('lead_time_days', v)}
                />
              </FormGrid>
            </div>
          </SubPanel>

          <SubPanel
            className="mt-4"
            title="Opening stock"
            description={openingScopeNote}
            action={
              openings.length > 0 ? (
                <span className="text-[11px] font-semibold tabular-nums text-gray-600">
                  Total {currencySymbol ? `${currencySymbol} ` : ''}
                  {formatQty(
                    openings.reduce((sum, o) => sum + openingValue(o.opening_qty, o.opening_valuation_rate), 0),
                    '0',
                  )}
                </span>
              ) : null
            }
          >
            <div className="overflow-x-auto">
              <table className={cx(AIC, 'w-full min-w-[42rem] border-collapse')}>
                <thead>
                  <tr className="bg-white">
                    {['Warehouse', 'Unit'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                    {['Quantity', 'Rate', 'Value'].map((h) => (
                      <th key={h} className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                    {!readOnly ? <th className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {openings.length === 0 ? (
                    <tr>
                      <td colSpan={readOnly ? 5 : 6} className="border-t border-gray-100 px-3 py-6 text-center text-xs text-gray-500">
                        No opening stock.
                      </td>
                    </tr>
                  ) : null}
                  {openings.map((o, index) => {
                    const error = err(`openings.${o.key}`)
                    return (
                      <tr key={o.key} className={cx('border-t border-gray-100', error && 'bg-red-50/40')}>
                        <td className="px-3 py-2">
                          <Select
                            size="md"
                            aria-label={`Warehouse for opening row ${index + 1}`}
                            value={o.warehouse_id}
                            disabled={readOnly}
                            onChange={(e) => patchOpening(o.key, { warehouse_id: e.target.value })}
                          >
                            <option value="">Company level</option>
                            {warehouseOpts.map((w) => (
                              <option key={w.value} value={w.value}>
                                {w.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            size="md"
                            aria-label={`Unit for opening row ${index + 1}`}
                            value={o.unit_id}
                            disabled={readOnly}
                            invalid={Boolean(error)}
                            onChange={(e) => patchOpening(o.key, { unit_id: e.target.value })}
                          >
                            <option value="">Select…</option>
                            {itemUnits.map((u) => (
                              <option key={u.unit_id} value={u.unit_id}>
                                {u.unit_symbol ?? u.unit_name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="w-32 px-3 py-2">
                          <Input
                            size="md"
                            type="number"
                            step="any"
                            aria-label={`Opening quantity for row ${index + 1}`}
                            className="tabular-nums text-right"
                            value={o.opening_qty}
                            disabled={readOnly}
                            invalid={Boolean(error)}
                            onChange={(e) => patchOpening(o.key, { opening_qty: e.target.value })}
                          />
                        </td>
                        <td className="w-32 px-3 py-2">
                          <Input
                            size="md"
                            type="number"
                            min={0}
                            step="any"
                            aria-label={`Opening rate for row ${index + 1}`}
                            className="tabular-nums text-right"
                            value={o.opening_valuation_rate}
                            disabled={readOnly}
                            onChange={(e) => patchOpening(o.key, { opening_valuation_rate: e.target.value })}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold tabular-nums text-gray-700">
                          {formatQty(openingValue(o.opening_qty, o.opening_valuation_rate), '0')}
                        </td>
                        {!readOnly ? (
                          <td className="px-3 py-2">
                            <Tooltip label="Remove this opening row">
                              <button
                                type="button"
                                aria-label={`Remove opening row ${index + 1}`}
                                onClick={() => onOpeningsChange(openings.filter((x) => x.key !== o.key))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </Tooltip>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {openings.some((o) => err(`openings.${o.key}`)) ? (
              <div className="border-t border-gray-100 px-3 pt-2">
                {openings.map((o) => {
                  const error = err(`openings.${o.key}`)
                  return error ? (
                    <p key={o.key} className="py-0.5 text-[11px] text-red-600">
                      {error}
                    </p>
                  ) : null
                })}
              </div>
            ) : null}

            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  disabled={!form.unit_id}
                  onClick={() => onOpeningsChange([...openings, newOpening(form.unit_id)])}
                >
                  Add opening row
                </Button>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <Warehouse className="h-3 w-3" aria-hidden />
                  One row per warehouse; leave it empty for a company-level opening.
                </span>
              </div>
            ) : null}
          </SubPanel>
        </>
      )}
    </ItemSectionCard>
  )
}

export default ItemStockLocationsCard
