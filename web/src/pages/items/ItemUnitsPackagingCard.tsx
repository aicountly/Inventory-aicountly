import { useMemo } from 'react'
import { Info, Plus, Scale, Trash2, Wand2 } from 'lucide-react'
import type { FormOptionUnit } from '../../services/items'
import { UOM_ROLES } from '../../services/items'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { FormGrid } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import { humanize } from '../../utils/format'
import { ItemSectionCard } from './ItemSectionCard'
import type { ItemCardBaseProps } from './ItemSectionCard'
import { FieldNote, SelectField, SubPanel, ToggleField } from './ItemWorkspaceKit'
import { commonConversions, conversionCaption } from './itemConversions'
import { newUnitLine, nextKey } from './itemForm'
import type { UnitLineDraft } from './itemForm'

/**
 * Base unit, the units this item is bought and sold in, and the conversions between them.
 *
 * ## The direction of a conversion factor
 *
 * The stored number is how many BASE units make one of the alternate unit — `Box = 12 Pcs` is a 12
 * on the Box row. That is the API's convention (`inv_item_uoms.conversion_factor`) and it is not
 * changed here; what is new is that the screen now reads the number back in both directions under
 * the box, so nobody has to remember which way round it goes.
 *
 * ## Manage conversions
 *
 * The switch reveals the alternate-units panel. It cannot be turned off while rows exist: hiding
 * configured conversions would leave an item quietly converting quantities with nothing on screen
 * to say so. Remove the rows and the switch is free again.
 */
export interface ItemUnitsPackagingCardProps extends ItemCardBaseProps {
  units: readonly FormOptionUnit[]
  manageConversions: boolean
  onManageConversions: (on: boolean) => void
}

const symbolOf = (unit: FormOptionUnit | null | undefined): string =>
  unit ? (unit.unit_symbol || unit.unit_name) : 'base'

export function ItemUnitsPackagingCard({
  form,
  set,
  err,
  readOnly,
  registerSection,
  units,
  manageConversions,
  onManageConversions,
}: ItemUnitsPackagingCardProps) {
  const unitOpts = useMemo(
    () => units.map((u) => ({ value: u.unit_id, label: `${u.unit_name}${u.unit_symbol ? ` (${u.unit_symbol})` : ''}` })),
    [units],
  )
  const baseUnit = units.find((u) => String(u.unit_id) === form.unit_id) ?? null
  const baseSymbol = symbolOf(baseUnit)

  const usedUnitIds = useMemo(
    () => form.unitLines.map((l) => Number(l.unit_id)).filter((n) => Number.isFinite(n) && n > 0),
    [form.unitLines],
  )
  const ready = useMemo(
    () => commonConversions(baseUnit, units, usedUnitIds),
    [baseUnit, units, usedUnitIds],
  )

  const patchLine = (key: string, patch: Partial<UnitLineDraft>) =>
    set('unitLines', form.unitLines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => set('unitLines', form.unitLines.filter((l) => l.key !== key))

  const lineCount = form.unitLines.length
  const panelOpen = manageConversions || lineCount > 0

  return (
    <ItemSectionCard
      id="units"
      title="Units & Packaging"
      description="Define base unit and alternate units for this item"
      icon={Scale}
      register={registerSection}
      action={
        <Tooltip
          label={
            lineCount > 0
              ? 'Remove the alternate units before hiding this panel.'
              : 'Show the alternate units and conversion factors.'
          }
        >
          <span className="inline-flex">
            <ToggleField
              name="manage_conversions"
              label="Manage Conversions"
              checked={panelOpen}
              disabled={readOnly || lineCount > 0}
              onChange={onManageConversions}
              bare
            />
          </span>
        </Tooltip>
      }
    >
      <FormGrid cols={3} gap="md">
        <SelectField
          name="unit_id"
          label="Base unit"
          required
          value={form.unit_id}
          disabled={readOnly}
          error={err('unit_id')}
          emptyLabel="Select…"
          options={unitOpts}
          onChange={(v) => set('unit_id', v)}
          hint="Stock is kept and valued in this unit."
        />
        <SelectField
          name="purchase_unit_id"
          label="Purchase unit"
          value={form.purchase_unit_id}
          disabled={readOnly}
          error={err('purchase_unit_id')}
          emptyLabel="Base unit"
          options={unitOpts}
          onChange={(v) => set('purchase_unit_id', v)}
        />
        <SelectField
          name="sales_unit_id"
          label="Sales unit"
          value={form.sales_unit_id}
          disabled={readOnly}
          error={err('sales_unit_id')}
          emptyLabel="Base unit"
          options={unitOpts}
          onChange={(v) => set('sales_unit_id', v)}
        />
      </FormGrid>

      {panelOpen ? (
        <SubPanel
          className="mt-4"
          title="Alternate units"
          description="Add alternate units and conversion factors"
          action={
            readOnly ? null : ready.length > 0 ? (
              <MenuButton
                label="Use common conversions"
                icon={Wand2}
                variant="ghost"
                size="xs"
                width={260}
                actions={ready.map((c) => ({
                  key: String(c.unitId),
                  label: `${c.unitLabel} — ${c.caption}`,
                  onSelect: () =>
                    set('unitLines', [
                      ...form.unitLines,
                      {
                        key: nextKey('u'),
                        unit_id: String(c.unitId),
                        conversion_factor: String(c.factor),
                        uom_role: '',
                      },
                    ]),
                }))}
              >
                Use Common Conversions
              </MenuButton>
            ) : (
              <Tooltip
                label={
                  form.unit_id
                    ? `No standard conversion is known for ${baseSymbol} among this company's units.`
                    : 'Pick a base unit first.'
                }
              >
                <span className="text-[11px] font-semibold text-gray-300">Use Common Conversions</span>
              </Tooltip>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className={cx(AIC, 'w-full min-w-[34rem] border-collapse')}>
              <thead>
                <tr className="bg-white">
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Alternate unit
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Equal to (base unit)
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    Role
                  </th>
                  {!readOnly ? <th className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {lineCount === 0 ? (
                  <tr>
                    <td colSpan={readOnly ? 3 : 4} className="border-t border-gray-100 px-3 py-6 text-center text-xs text-gray-500">
                      No alternate units configured.
                    </td>
                  </tr>
                ) : null}
                {form.unitLines.map((line, index) => {
                  const error = err(`unitLines.${line.key}`)
                  const altUnit = units.find((u) => String(u.unit_id) === line.unit_id) ?? null
                  const caption = conversionCaption(line.conversion_factor, symbolOf(altUnit), baseSymbol)
                  return (
                    <tr key={line.key} className={cx('border-t border-gray-100 align-top', error && 'bg-red-50/40')}>
                      <td className="px-3 py-2">
                        <Select
                          size="md"
                          className="max-w-[16rem]"
                          aria-label={`Alternate unit ${index + 1}`}
                          value={line.unit_id}
                          disabled={readOnly}
                          invalid={Boolean(error)}
                          onChange={(e) => patchLine(line.key, { unit_id: e.target.value })}
                        >
                          <option value="">Select…</option>
                          {unitOpts
                            .filter((o) => String(o.value) !== form.unit_id)
                            .map((o) => (
                              <option key={String(o.value)} value={String(o.value)}>
                                {o.label}
                              </option>
                            ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {/* The width lives here, not on the input: `Input` carries `w-full` from
                              FIELD_BASE and a `w-24` beside it loses on source order. */}
                          <span className="block w-24 shrink-0">
                            <Input
                              size="md"
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              aria-label={`Conversion factor for alternate unit ${index + 1}`}
                              className="tabular-nums text-right"
                              value={line.conversion_factor}
                              disabled={readOnly}
                              invalid={Boolean(error)}
                              onChange={(e) => patchLine(line.key, { conversion_factor: e.target.value })}
                            />
                          </span>
                          <span className="text-xs font-medium text-gray-500">{baseSymbol}</span>
                        </div>
                        {caption ? (
                          <p className="mt-1 text-[10px] leading-4 text-gray-500">
                            <span className="block">{caption.primary}</span>
                            <span className="block">{caption.secondary}</span>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          size="md"
                          className="max-w-[12rem]"
                          aria-label={`Role for alternate unit ${index + 1}`}
                          value={line.uom_role}
                          disabled={readOnly}
                          onChange={(e) => patchLine(line.key, { uom_role: e.target.value })}
                        >
                          <option value="">— None —</option>
                          {UOM_ROLES.filter((r) => r !== 'base').map((r) => (
                            <option key={r} value={r}>
                              {humanize(r)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      {!readOnly ? (
                        <td className="px-3 py-2">
                          <Tooltip label="Remove this alternate unit">
                            <button
                              type="button"
                              aria-label={`Remove alternate unit ${index + 1}`}
                              onClick={() => removeLine(line.key)}
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

          {form.unitLines.some((l) => err(`unitLines.${l.key}`)) ? (
            <div className="border-t border-gray-100 px-3 pt-2">
              {form.unitLines.map((l) => {
                const error = err(`unitLines.${l.key}`)
                return error ? (
                  <p key={l.key} className="py-0.5 text-[11px] text-red-600">
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
                onClick={() => set('unitLines', [...form.unitLines, newUnitLine()])}
              >
                Add Alternate Unit
              </Button>
              <span className="text-[11px] text-gray-500">
                {form.unit_id
                  ? `Enter how many ${baseSymbol} make one of the alternate unit.`
                  : 'Pick a base unit first.'}
              </span>
            </div>
          ) : null}
        </SubPanel>
      ) : null}

      {panelOpen && form.unit_id ? (
        <FieldNote tone="info" icon={Info} className="mt-3">
          Stock is kept in <strong>{baseSymbol}</strong>. An alternate unit says how many {baseSymbol} it is worth:
          a Box of 12 {baseSymbol} is a <strong>12</strong>. Every document converts back to {baseSymbol} before
          anything is valued.
        </FieldNote>
      ) : null}
    </ItemSectionCard>
  )
}

export default ItemUnitsPackagingCard
