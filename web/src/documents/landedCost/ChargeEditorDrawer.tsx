import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { FormField, FormGrid } from '../../ui/shell'
import { Notice } from '../../components/Notice'
import {
  ALLOCATION_BASES,
  BASIS_HINTS,
  BASIS_LABELS,
  COST_TYPE_HELP,
  COST_TYPE_LABELS,
  WEIGHT_BASIS_UNAVAILABLE,
  offeredCostTypes,
} from '../landedCost'
import type { AllocationBasis, ChargeDraft, LandedCostPolicy, LandedCostType } from '../landedCost'

interface ChargeEditorDrawerProps {
  charge: ChargeDraft | null
  index: number
  policy: LandedCostPolicy | null
  onSave: (patch: Partial<ChargeDraft>) => void
  onClose: () => void
}

/**
 * The full form behind a charge row.
 *
 * The row itself is editable in place — cost type, description, amount and basis are all reachable
 * without opening anything, because those four are what a bill is keyed from and a dialog per row
 * would make entering six charges six dialogs. This drawer is for the rest: the reference the
 * charge came in on, who it was billed by, and a note. It opens on demand and never in the way.
 *
 * The reference fields ride in the document's own metadata. They describe the charge Inventory is
 * capitalising, not the supplier's ledger — the commercial voucher stays in Books and nothing here
 * writes to it.
 */
export function ChargeEditorDrawer({ charge, index, policy, onSave, onClose }: ChargeEditorDrawerProps) {
  const [draft, setDraft] = useState<ChargeDraft | null>(charge)

  useEffect(() => setDraft(charge), [charge])

  if (!charge || !draft) return null

  const patch = (next: Partial<ChargeDraft>) => setDraft((d) => (d ? { ...d, ...next } : d))
  const save = () => {
    onSave({
      cost_type: draft.cost_type,
      description: draft.description,
      amount: draft.amount,
      allocation_basis: draft.allocation_basis,
      reference_no: draft.reference_no,
      reference_date: draft.reference_date,
      vendor_name: draft.vendor_name,
      notes: draft.notes,
    })
    onClose()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Charge ${index + 1}`}
      description="What the charge is, how much of it there is, and how it should be spread."
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Apply</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormGrid cols={2}>
          <FormField label="Cost type" htmlFor="charge-cost-type" required hint={COST_TYPE_HELP[draft.cost_type]}>
            <Select
              id="charge-cost-type"
              size="md"
              value={draft.cost_type}
              onChange={(e) => patch({ cost_type: e.target.value as LandedCostType })}
            >
              {offeredCostTypes(policy, draft.cost_type).map((t) => (
                <option key={t} value={t}>
                  {COST_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Amount" htmlFor="charge-amount" required hint="The whole charge, as billed.">
            <Input
              id="charge-amount"
              size="md"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => patch({ amount: e.target.value })}
            />
          </FormField>
        </FormGrid>

        <FormField label="Description" htmlFor="charge-description" hint="What appears against this charge on the allocation.">
          <Input
            id="charge-description"
            size="md"
            maxLength={255}
            value={draft.description}
            placeholder="e.g. Road freight, LR 4471"
            onChange={(e) => patch({ description: e.target.value })}
          />
        </FormField>

        <FormField label="Spread by" htmlFor="charge-basis" required hint={BASIS_HINTS[draft.allocation_basis]}>
          <Select id="charge-basis" size="md" value={draft.allocation_basis} onChange={(e) => patch({ allocation_basis: e.target.value as AllocationBasis })}>
            {ALLOCATION_BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_LABELS[b]}
              </option>
            ))}
            <option value="weight" disabled>
              By weight — unavailable
            </option>
          </Select>
        </FormField>

        <Notice kind="info">{WEIGHT_BASIS_UNAVAILABLE}</Notice>

        <FormGrid cols={2}>
          <FormField label="Reference no." htmlFor="charge-reference" hint="The carrier's or agent's bill number.">
            <Input
              id="charge-reference"
              size="md"
              maxLength={64}
              value={draft.reference_no ?? ''}
              placeholder="e.g. LR-4471"
              onChange={(e) => patch({ reference_no: e.target.value })}
            />
          </FormField>

          <FormField label="Reference date" htmlFor="charge-reference-date">
            <Input id="charge-reference-date" size="md" type="date" value={draft.reference_date ?? ''} onChange={(e) => patch({ reference_date: e.target.value })} />
          </FormField>
        </FormGrid>

        <FormField label="Service provider" htmlFor="charge-vendor" hint="Who billed this charge. Recorded on the allocation; the payable itself belongs to Books.">
          <Input
            id="charge-vendor"
            size="md"
            maxLength={128}
            value={draft.vendor_name ?? ''}
            placeholder="e.g. Blue Dart Logistics"
            onChange={(e) => patch({ vendor_name: e.target.value })}
          />
        </FormField>

        <FormField label="Notes" htmlFor="charge-notes">
          <Textarea id="charge-notes" rows={3} maxLength={500} value={draft.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} />
        </FormField>
      </div>
    </Drawer>
  )
}
