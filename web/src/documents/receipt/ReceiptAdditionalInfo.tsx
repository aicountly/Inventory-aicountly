import { ClipboardCheck } from 'lucide-react'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { FormField, FormGrid, FormSectionCard } from '../../ui/shell/FormSectionCard'
import type { ReceiptExtras } from './receiptModel'

export interface ReceiptAdditionalInfoProps {
  extras: ReceiptExtras
  onChange: (patch: Partial<ReceiptExtras>) => void
  disabled?: boolean
}

/**
 * The gate: how the material physically got through the door.
 *
 * All three ride in `inv_documents.metadata_json` (see receiptModel.ts) — real
 * stored values that come back when the receipt is reopened or printed, not
 * fields that look answered and are thrown away on save.
 */
export function ReceiptAdditionalInfo({ extras, onChange, disabled }: ReceiptAdditionalInfoProps) {
  return (
    <FormSectionCard title="Gate & quality" description="How it arrived, and whether it has been checked." icon={ClipboardCheck}>
      <FormGrid cols={2} gap="md">
        <FormField label="Gate entry no." htmlFor="mr_gate_entry">
          <Input
            id="mr_gate_entry"
            size="md"
            value={extras.gate_entry_no}
            disabled={disabled}
            maxLength={64}
            placeholder="e.g. GE-2026-0148"
            onChange={(e) => onChange({ gate_entry_no: e.target.value })}
          />
        </FormField>
        <FormField label="Vehicle no." htmlFor="mr_vehicle_no">
          <Input
            id="mr_vehicle_no"
            size="md"
            value={extras.vehicle_no}
            disabled={disabled}
            maxLength={32}
            placeholder="e.g. MH 12 AB 3456"
            onChange={(e) => onChange({ vehicle_no: e.target.value.toUpperCase() })}
          />
        </FormField>
        <div className="md:col-span-2">
          <button
            type="button"
            role="switch"
            aria-checked={extras.quality_checked}
            disabled={disabled}
            onClick={() => onChange({ quality_checked: !extras.quality_checked })}
            className="flex items-center gap-2.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-primary/40 transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <span
              className={cx(
                'relative w-9 h-5 rounded-full shrink-0 transition-colors',
                extras.quality_checked ? 'bg-primary' : 'bg-gray-300',
              )}
              aria-hidden
            >
              <span
                className={cx(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                  extras.quality_checked ? 'left-[1.125rem]' : 'left-0.5',
                )}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Quality check completed</span>
              <span className="block text-[11px] text-gray-500">
                Recorded on the receipt. It does not hold the stock back — posting moves it either way.
              </span>
            </span>
          </button>
        </div>
      </FormGrid>
    </FormSectionCard>
  )
}

export default ReceiptAdditionalInfo
