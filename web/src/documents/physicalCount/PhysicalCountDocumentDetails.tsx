import { useId } from 'react'
import { FileText } from 'lucide-react'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { FormField, FormSectionCard } from '../../ui/shell'
import type { FormOptionWarehouse } from '../../services/items'
import { WarehouseField } from './WarehouseField'
import type { HeaderDraft } from '../formModel'

/**
 * Codes offered as SUGGESTIONS, not as a master.
 *
 * Inventory has no reason-code master — `reason_code` is a free 32-character
 * column the server truncates, and every document type that carries one has
 * always taken typed text. A `<datalist>` gives the common codes one keystroke
 * without turning a free field into a closed list that would reject whatever
 * this company already uses.
 */
const REASON_CODE_SUGGESTIONS = ['STKCOUNT', 'DAMAGE', 'SHRINKAGE', 'EXPIRED', 'FOUND', 'CORRECTION'] as const

/** Matches the server's `substr($p['reason_code'], 0, 32)` so nothing is silently cut. */
const REASON_CODE_MAX = 32
const MOVEMENT_REASON_MAX = 64

export interface PhysicalCountDocumentDetailsProps {
  header: HeaderDraft
  onChange: (patch: Partial<HeaderDraft>) => void
  warehouses: FormOptionWarehouse[]
  disabled?: boolean
  /** Field-level message from validation, keyed by header field. */
  errors?: Partial<Record<keyof HeaderDraft, string>>
}

export function PhysicalCountDocumentDetails({
  header,
  onChange,
  warehouses,
  disabled = false,
  errors = {},
}: PhysicalCountDocumentDetailsProps) {
  const ids = useId()
  const reasonListId = `${ids}-reasons`

  return (
    <FormSectionCard
      icon={FileText}
      title="Document details"
      description="Who counted, when, and why — the header an auditor reads first."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <FormField label="Document date" htmlFor={`${ids}-date`} required error={errors.document_date}>
          <Input
            id={`${ids}-date`}
            type="date"
            value={header.document_date}
            disabled={disabled}
            invalid={Boolean(errors.document_date)}
            onChange={(e) => onChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField label="Document no." htmlFor={`${ids}-no`} hint="Leave empty to number automatically.">
          <Input
            id={`${ids}-no`}
            value={header.document_no}
            placeholder="Auto-generate"
            disabled={disabled}
            onChange={(e) => onChange({ document_no: e.target.value })}
          />
        </FormField>

        <FormField label="Default warehouse" htmlFor={`${ids}-wh`} hint="Pre-fills the warehouse on new lines.">
          <WarehouseField
            id={`${ids}-wh`}
            value={header.default_warehouse_id}
            onChange={(id) => onChange({ default_warehouse_id: id })}
            warehouses={warehouses}
            emptyLabel="None"
            disabled={disabled}
          />
        </FormField>

        <FormField label="Reason code" htmlFor={`${ids}-reason`} hint="Free text; suggestions offered.">
          <Input
            id={`${ids}-reason`}
            list={reasonListId}
            value={header.reason_code}
            placeholder="e.g. STKCOUNT"
            maxLength={REASON_CODE_MAX}
            disabled={disabled}
            onChange={(e) => onChange({ reason_code: e.target.value })}
          />
          <datalist id={reasonListId}>
            {REASON_CODE_SUGGESTIONS.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Movement reason" htmlFor={`${ids}-movement`}>
          <Input
            id={`${ids}-movement`}
            value={header.movement_reason}
            placeholder="e.g. Year end stock count"
            maxLength={MOVEMENT_REASON_MAX}
            disabled={disabled}
            onChange={(e) => onChange({ movement_reason: e.target.value })}
          />
        </FormField>
      </div>

      <div className="mt-3">
        {/* No maxLength: `inv_documents.narration` is TEXT and the server caps
            nothing, so a limit here would only take away a field somebody can
            use today. The counter is a reading, not a budget. */}
        <FormField
          label="Narration"
          htmlFor={`${ids}-narration`}
          hint={`${header.narration.length} character${header.narration.length === 1 ? '' : 's'}`}
        >
          <Textarea
            id={`${ids}-narration`}
            rows={2}
            value={header.narration}
            placeholder="Who counted, which aisles, anything an auditor would want on the record…"
            disabled={disabled}
            onChange={(e) => onChange({ narration: e.target.value })}
          />
        </FormField>
      </div>
    </FormSectionCard>
  )
}

export default PhysicalCountDocumentDetails
