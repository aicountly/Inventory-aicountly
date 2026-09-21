import { FileText, Package } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { cx } from '../../ui/cx'
import { FormField, FormGrid, FormSectionCard } from '../../ui/shell/FormSectionCard'
import type { HeaderDraft } from '../formModel'
import { WarehouseSelect } from '../WarehouseSelect'
import { HANDLING_INSTRUCTIONS, TRANSPORT_MODES, boxMarksOf, handlingInstructionsOf, packageInfoOf } from './packingMetadata'
import type { PackagePackingInfo } from '../types'

export interface PackingDetailsCardProps {
  header: HeaderDraft
  patchHeader: (patch: Partial<HeaderDraft>) => void
  warehouses: FormOptionWarehouse[]
  disabled?: boolean
}

const CHIP_TONE: Record<string, string> = {
  Fragile: 'border-red-200 bg-red-50 text-red-600',
  'Handle with care': 'border-amber-200 bg-amber-50 text-amber-700',
  'Keep dry': 'border-sky-200 bg-sky-50 text-sky-700',
  'This side up': 'border-primary/30 bg-primary-light text-primary',
}

/** Premium document-details card for a Packing List: header fields, box/package info, handling chips. */
export function PackingDetailsCard({ header, patchHeader, warehouses, disabled }: PackingDetailsCardProps) {
  const pkg = packageInfoOf(header)
  const patchPackage = (patch: Partial<PackagePackingInfo>) =>
    patchHeader({ metadata: { ...header.metadata, package_info: { ...pkg, ...patch } } })

  const chips = handlingInstructionsOf(header)
  const toggleChip = (label: string) => {
    const next = chips.includes(label) ? chips.filter((c) => c !== label) : [...chips, label]
    patchHeader({ metadata: { ...header.metadata, handling_instructions: next } })
  }

  return (
    <FormSectionCard title="Document details" description="Fill in the basic details for this packing list." icon={FileText}>
      <FormGrid cols={4}>
        <FormField label="Document date" required>
          <Input type="date" value={header.document_date} disabled={disabled} onChange={(e) => patchHeader({ document_date: e.target.value })} />
        </FormField>
        <FormField label="Packing list no." hint="Leave empty to auto-generate.">
          <Input value={header.document_no} disabled={disabled} placeholder="Auto-generate" onChange={(e) => patchHeader({ document_no: e.target.value })} />
        </FormField>
        <FormField label="Consignee">
          <Input value={header.party_name} disabled={disabled} placeholder="Consignee as printed" onChange={(e) => patchHeader({ party_name: e.target.value })} />
        </FormField>
        <FormField label="Consignee ledger id" hint="Books account id (acc_id).">
          <Input inputMode="numeric" value={header.party_ref} disabled={disabled} placeholder="e.g. 1042" onChange={(e) => patchHeader({ party_ref: e.target.value.replace(/[^\d]/g, '') })} />
        </FormField>
        <FormField label="Default warehouse" hint="Pre-fills the warehouse on new lines.">
          <WarehouseSelect value={header.default_warehouse_id} onChange={(id) => patchHeader({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="Select warehouse…" disabled={disabled} className="!h-8 !text-sm" />
        </FormField>
        <FormField label="Reference" hint="Sales order, DC, customer PO…">
          <Input value={header.metadata.reference ?? ''} disabled={disabled} placeholder="Sales Order / DC / Other" onChange={(e) => patchHeader({ metadata: { ...header.metadata, reference: e.target.value || undefined } })} />
        </FormField>
      </FormGrid>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FormField label="Delivery address">
          <Textarea rows={3} value={header.metadata.delivery_address ?? ''} disabled={disabled} placeholder="Enter delivery address (optional)" onChange={(e) => patchHeader({ metadata: { ...header.metadata, delivery_address: e.target.value || undefined } })} />
        </FormField>

        <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <Package className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            Box / package info
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <FormField label="No. of boxes">
              <Input type="number" min={0} inputMode="numeric" value={pkg.boxes ?? ''} disabled={disabled} onChange={(e) => patchPackage({ boxes: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </FormField>
            <FormField label="Weight (kg)">
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={pkg.total_weight_kg ?? ''} disabled={disabled} onChange={(e) => patchPackage({ total_weight_kg: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </FormField>
            <FormField label="Dimensions L×W×H cm" className="col-span-2 sm:col-span-1">
              <Input value={pkg.dimensions_cm ?? ''} disabled={disabled} placeholder="e.g. 40 x 30 x 20" onChange={(e) => patchPackage({ dimensions_cm: e.target.value || undefined })} />
            </FormField>
            <FormField label="Transport mode">
              <Select value={pkg.transport_mode ?? ''} disabled={disabled} onChange={(e) => patchPackage({ transport_mode: e.target.value || undefined })}>
                <option value="">Select…</option>
                {TRANSPORT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <FormField label="Narration / notes">
          <Textarea rows={2} value={header.narration} disabled={disabled} placeholder="Add any special instructions, packing notes, handling instructions…" onChange={(e) => patchHeader({ narration: e.target.value })} />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Handling</span>
          <div className="flex max-w-[280px] flex-wrap gap-1.5">
            {HANDLING_INSTRUCTIONS.map((label) => {
              const active = chips.includes(label)
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => toggleChip(label)}
                  className={cx(
                    'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    active ? CHIP_TONE[label] : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <FormField label="Box marks" hint="One per line — printed on the packing list." className="mt-4">
        <Textarea
          rows={2}
          value={boxMarksOf(header).join('\n')}
          disabled={disabled}
          placeholder="e.g. Handle with care"
          onChange={(e) =>
            patchHeader({
              metadata: { ...header.metadata, box_marks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) },
            })
          }
        />
      </FormField>
    </FormSectionCard>
  )
}

export default PackingDetailsCard
