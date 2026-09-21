import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { FormField, FormGrid } from '../../ui/shell/FormSectionCard'
import type { HeaderDraft } from '../formModel'
import type { PackingAdditionalInfo } from '../types'
import { additionalInfoOf } from './packingMetadata'

export interface AdditionalDetailsSectionProps {
  header: HeaderDraft
  patchHeader: (patch: Partial<HeaderDraft>) => void
  disabled?: boolean
}

const FIELDS: { key: keyof PackingAdditionalInfo; label: string; type?: string }[] = [
  { key: 'carrier', label: 'Carrier' },
  { key: 'vehicle_no', label: 'Vehicle no.' },
  { key: 'lr_awb_no', label: 'LR / AWB no.' },
  { key: 'dispatch_date', label: 'Dispatch date', type: 'date' },
  { key: 'expected_delivery', label: 'Expected delivery', type: 'date' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'contact_mobile', label: 'Contact mobile' },
]

/** Collapsible logistics detail — open by default only once it already holds something. */
export function AdditionalDetailsSection({ header, patchHeader, disabled }: AdditionalDetailsSectionProps) {
  const info = additionalInfoOf(header)
  const [open, setOpen] = useState(() => Object.values(info).some((v) => v !== undefined && v !== ''))

  const patch = (key: keyof PackingAdditionalInfo, value: string) =>
    patchHeader({ metadata: { ...header.metadata, additional: { ...info, [key]: value || undefined } } })

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-900"
      >
        Additional details
        <ChevronDown className={cx('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="border-t border-gray-100 px-4 py-4">
          <FormGrid cols={4}>
            {FIELDS.map((f) => (
              <FormField key={f.key} label={f.label}>
                <Input type={f.type ?? 'text'} value={info[f.key] ?? ''} disabled={disabled} onChange={(e) => patch(f.key, e.target.value)} />
              </FormField>
            ))}
          </FormGrid>
        </div>
      ) : null}
    </div>
  )
}

export default AdditionalDetailsSection
