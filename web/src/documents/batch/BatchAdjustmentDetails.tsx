import { useId } from 'react'
import { ClipboardList } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { AIC, cx } from '../../ui/cx'
import type { HeaderDraft } from '../formModel'
import { WarehouseField } from './BatchControls'
import type { BatchIssue, IssueField } from './batchAdjustmentModel'

/**
 * Suggestions, not a master.
 *
 * Inventory has no reason-code master table and no endpoint that serves one, so the field stays
 * the free text the column already holds (VARCHAR(32)) and these are offered as completions. The
 * day a master exists this list is replaced by its rows and nothing else on the screen changes.
 */
export const REASON_CODE_SUGGESTIONS = ['DAMAGE', 'EXPIRY', 'PHYSICAL_COUNT', 'BATCH_CORRECTION', 'QUALITY_RECLASSIFICATION', 'PACKING_ERROR', 'OTHER'] as const

export const MOVEMENT_REASON_SUGGESTIONS = [
  'Re-allocate batch',
  'Damaged to good batch correction',
  'Physical verification adjustment',
  'Quality reclassification',
  'Batch tagging correction',
  'Serial mapping correction',
] as const

export const FIELD_IDS = {
  document_date: 'ba-document-date',
  document_no: 'ba-document-no',
  default_warehouse: 'ba-default-warehouse',
  reason_code: 'ba-reason-code',
  movement_reason: 'ba-movement-reason',
  narration: 'ba-narration',
} as const

export interface BatchAdjustmentDetailsProps {
  header: HeaderDraft
  onChange: (patch: Partial<HeaderDraft>) => void
  warehouses: FormOptionWarehouse[]
  issues: readonly BatchIssue[]
  disabled?: boolean
  readOnly?: boolean
}

function headerError(issues: readonly BatchIssue[], field: IssueField): string | undefined {
  return issues.find((i) => i.lineKey === null && i.field === field && i.severity === 'error')?.message
}

/** The document's own facts: when it happened, where it defaults to, and why it was raised. */
export function BatchAdjustmentDetails({ header, onChange, warehouses, issues, disabled, readOnly }: BatchAdjustmentDetailsProps) {
  const reasonListId = useId()
  const movementListId = useId()
  const locked = disabled || readOnly
  const dateError = headerError(issues, 'document_date')
  const warehouseError = headerError(issues, 'default_warehouse')

  return (
    <FormSectionCard icon={ClipboardList} title="Adjustment details" description="Basic information for this batch adjustment document.">
      <div className={cx(AIC, 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5')}>
        <FormField label="Document date" htmlFor={FIELD_IDS.document_date} required error={dateError}>
          <Input
            id={FIELD_IDS.document_date}
            type="date"
            size="md"
            value={header.document_date}
            disabled={locked}
            invalid={Boolean(dateError)}
            onChange={(e) => onChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField label="Document no." htmlFor={FIELD_IDS.document_no} hint="Leave empty to number automatically.">
          <Input
            id={FIELD_IDS.document_no}
            size="md"
            maxLength={64}
            placeholder="Auto-generate"
            value={header.document_no}
            disabled={locked}
            onChange={(e) => onChange({ document_no: e.target.value })}
          />
        </FormField>

        <FormField label="Default warehouse" htmlFor={FIELD_IDS.default_warehouse} required error={warehouseError} hint={warehouseError ? undefined : 'Pre-fills the warehouse on new lines. Lines already entered keep theirs.'}>
          <WarehouseField
            id={FIELD_IDS.default_warehouse}
            size="md"
            value={header.default_warehouse_id}
            onChange={(id) => onChange({ default_warehouse_id: id })}
            warehouses={warehouses}
            disabled={locked}
            invalid={Boolean(warehouseError)}
          />
        </FormField>

        <FormField label="Reason code" htmlFor={FIELD_IDS.reason_code} hint="Free text — suggestions offered.">
          <Input
            id={FIELD_IDS.reason_code}
            size="md"
            maxLength={32}
            list={reasonListId}
            placeholder="e.g. DAMAGE"
            value={header.reason_code}
            disabled={locked}
            onChange={(e) => onChange({ reason_code: e.target.value })}
          />
          <datalist id={reasonListId}>
            {REASON_CODE_SUGGESTIONS.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Movement reason" htmlFor={FIELD_IDS.movement_reason}>
          <Input
            id={FIELD_IDS.movement_reason}
            size="md"
            maxLength={64}
            list={movementListId}
            placeholder="e.g. Re-allocate batch"
            value={header.movement_reason}
            disabled={locked}
            onChange={(e) => onChange({ movement_reason: e.target.value })}
          />
          <datalist id={movementListId}>
            {MOVEMENT_REASON_SUGGESTIONS.map((reason) => (
              <option key={reason} value={reason} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Narration" htmlFor={FIELD_IDS.narration} className="sm:col-span-2 lg:col-span-3 xl:col-span-5">
          <div className="relative">
            <Textarea
              id={FIELD_IDS.narration}
              rows={2}
              className="pb-5"
              placeholder="Why these batches were reallocated…"
              value={header.narration}
              disabled={locked}
              onChange={(e) => onChange({ narration: e.target.value })}
            />
            {/* No cap: `narration` is a TEXT column, so a limit here would refuse text the
                server accepts. The count is a guide, not a gate. */}
            <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[10px] text-gray-400 tabular-nums">
              {header.narration.length} character{header.narration.length === 1 ? '' : 's'}
            </span>
          </div>
        </FormField>
      </div>
    </FormSectionCard>
  )
}

export default BatchAdjustmentDetails
