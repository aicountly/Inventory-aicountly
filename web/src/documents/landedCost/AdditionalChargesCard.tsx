import { Copy, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { MenuButton } from '../../ui/MenuButton'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { FormSectionCard } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import { formatMoney } from '../../utils/format'
import {
  ALLOCATION_BASES,
  BASIS_HINTS,
  BASIS_LABELS,
  COST_TYPE_LABELS,
  WEIGHT_BASIS_UNAVAILABLE,
  chargeAmount,
  offeredCostTypes,
} from '../landedCost'
import type { AllocationBasis, ChargeDraft, LandedCostPolicy, LandedCostType } from '../landedCost'
import { CHARGE_PRESETS } from './chargePresets'
import type { ChargePreset } from './chargePresets'
import { seriesClassFor } from './chargePalette'

interface AdditionalChargesCardProps {
  charges: ChargeDraft[]
  policy: LandedCostPolicy | null
  currency: string
  disabled: boolean
  total: number
  unallocated: number
  onPatch: (key: string, patch: Partial<ChargeDraft>) => void
  onAdd: () => void
  onPreset: (preset: ChargePreset) => void
  onDuplicate: (key: string) => void
  onRemove: (key: string) => void
  onEdit: (key: string) => void
}

/**
 * The charges, entered the way a bill is read: one row per line on the paper.
 *
 * Every column a bill is keyed from — cost type, description, amount, basis — is editable IN THE
 * ROW. Entering six charges should be six rows of typing, not six dialogs; the drawer behind the
 * pencil is for the reference number, the service provider and a note, which are not keyed on every
 * charge.
 *
 * "By weight" is listed and disabled rather than left out. It is the basis an operator will look
 * for first, and a control that is simply missing looks like an oversight to be worked around.
 */
export function AdditionalChargesCard({
  charges,
  policy,
  currency,
  disabled,
  total,
  unallocated,
  onPatch,
  onAdd,
  onPreset,
  onDuplicate,
  onRemove,
  onEdit,
}: AdditionalChargesCardProps) {
  const excluded = policy?.excluded_cost_types ?? []

  return (
    <FormSectionCard
      title="Additional charges"
      description="Add freight, duty, insurance and other landing costs. Each charge is spread across the selected receipts' lines on the basis you pick."
      icon={Receipt}
      action={
        <div className="flex items-center gap-2">
          <MenuButton
            label="Add from preset"
            variant="secondary"
            size="sm"
            icon={Plus}
            width={248}
            actions={CHARGE_PRESETS.map((preset) => ({
              key: preset.key,
              label: (
                <span className="block">
                  <span className="block text-sm font-medium">{preset.label}</span>
                  <span className="block text-[11px] text-gray-500">{preset.description}</span>
                </span>
              ),
              onSelect: () => onPreset(preset),
              disabled,
            }))}
          >
            Preset
          </MenuButton>
          <Button icon={Plus} size="sm" onClick={onAdd} disabled={disabled} kbd="Alt A">
            Add charge
          </Button>
        </div>
      }
    >
      {charges.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No charges yet"
          description="Add the freight, duty, insurance or handling this consignment was billed. Each one is spread over the receipt lines you selected."
          action={
            <Button icon={Plus} onClick={onAdd} disabled={disabled}>
              Add the first charge
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className={cx(AIC, 'w-full border-collapse text-xs')}>
            <caption className="sr-only">Charges to be allocated over the selected receipts</caption>
            <thead>
              <tr className="bg-gray-50 text-left">
                <th scope="col" className="w-8 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  #
                </th>
                <th scope="col" className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Cost type
                </th>
                <th scope="col" className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Description
                </th>
                <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Amount ({currency})
                </th>
                <th scope="col" className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Spread by
                </th>
                <th scope="col" className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {charges.map((charge, i) => {
                const n = i + 1
                const amount = chargeAmount(charge)
                const annotated = Boolean(charge.reference_no || charge.vendor_name || charge.notes)
                return (
                  <tr key={charge.key} className="border-t border-gray-100 align-top hover:bg-gray-50/60">
                    <td className="px-2 py-2 pt-3.5 text-gray-400 tabular-nums">{n}</td>
                    <td className="px-2 py-2 min-w-[9rem]">
                      <span className="flex items-center gap-1.5">
                        <span className={cx('h-2 w-2 shrink-0 rounded-full bg-current', seriesClassFor(charge.cost_type))} aria-hidden />
                        <Select
                          value={charge.cost_type}
                          disabled={disabled}
                          aria-label={`Charge ${n} cost type`}
                          onChange={(e) => onPatch(charge.key, { cost_type: e.target.value as LandedCostType })}
                        >
                          {offeredCostTypes(policy, charge.cost_type).map((t) => (
                            <option key={t} value={t}>
                              {COST_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </span>
                    </td>
                    <td className="px-2 py-2 min-w-[12rem]">
                      <Input
                        value={charge.description}
                        disabled={disabled}
                        maxLength={255}
                        aria-label={`Charge ${n} description`}
                        placeholder="e.g. Road freight, LR 4471"
                        onChange={(e) => onPatch(charge.key, { description: e.target.value })}
                      />
                      {annotated ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                          {charge.reference_no ? <Badge tone="neutral" size="xs">{charge.reference_no}</Badge> : null}
                          {charge.vendor_name ? <span className="truncate">{charge.vendor_name}</span> : null}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 w-[8.5rem]">
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={charge.amount}
                        disabled={disabled}
                        invalid={charge.amount.trim() !== '' && amount <= 0}
                        aria-label={`Charge ${n} amount`}
                        placeholder="0.00"
                        onChange={(e) => onPatch(charge.key, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-2 min-w-[9rem]">
                      <Select
                        value={charge.allocation_basis}
                        disabled={disabled}
                        aria-label={`Charge ${n} allocation basis`}
                        onChange={(e) => onPatch(charge.key, { allocation_basis: e.target.value as AllocationBasis })}
                      >
                        {ALLOCATION_BASES.map((b) => (
                          <option key={b} value={b}>
                            {BASIS_LABELS[b]}
                          </option>
                        ))}
                        {/* Present, disabled and explained below the table. */}
                        <option value="weight" disabled>
                          By weight — unavailable
                        </option>
                      </Select>
                      <span className="mt-1 block text-[10px] leading-snug text-gray-500">{BASIS_HINTS[charge.allocation_basis]}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex items-center justify-end gap-0.5">
                        <Tooltip label="Reference, service provider and notes">
                          <Button variant="ghost" size="xs" icon={Pencil} disabled={disabled} onClick={() => onEdit(charge.key)} aria-label={`Edit charge ${n} details`} />
                        </Tooltip>
                        <Tooltip label="Duplicate this charge">
                          <Button variant="ghost" size="xs" icon={Copy} disabled={disabled} onClick={() => onDuplicate(charge.key)} aria-label={`Duplicate charge ${n}`} />
                        </Tooltip>
                        <Tooltip label="Remove this charge">
                          <Button variant="ghost" size="xs" icon={Trash2} disabled={disabled} onClick={() => onRemove(charge.key)} aria-label={`Remove charge ${n}`} />
                        </Tooltip>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/70">
                <td colSpan={3} className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Total charges
                </td>
                <td className="px-2 py-2.5 text-right text-sm font-bold tabular-nums text-gray-900">
                  {currency} {formatMoney(total)}
                </td>
                <td colSpan={2} className="px-2 py-2.5">
                  {Math.abs(unallocated) > 0.005 ? (
                    <span className="text-[11px] font-semibold text-red-700">{formatMoney(Math.abs(unallocated))} not spread over any line</span>
                  ) : total > 0 ? (
                    <span className="text-[11px] font-medium text-emerald-700">Fully allocated</span>
                  ) : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={Plus} onClick={onAdd} disabled={disabled}>
          Add charge
        </Button>
        <p className="min-w-[16rem] flex-1 text-[11px] leading-relaxed text-gray-500">{WEIGHT_BASIS_UNAVAILABLE}</p>
      </div>

      {excluded.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          This company does not capitalise {excluded.map((t) => COST_TYPE_LABELS[t] ?? t).join(', ')} into stock, so{' '}
          {excluded.length > 1 ? 'those types are' : 'that type is'} not offered here — expense {excluded.length > 1 ? 'those charges' : 'that charge'} in Books instead.
          Change it in Inventory settings. A non-creditable tax is always capitalised and cannot be switched off: tax that cannot be recovered is part of what the goods cost.
        </p>
      ) : null}
    </FormSectionCard>
  )
}
