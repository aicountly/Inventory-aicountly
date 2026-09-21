import { useId } from 'react'
import { FileText } from 'lucide-react'
import type { FormOptionWarehouse } from '../../services/items'
import { Input, Select, Skeleton, Textarea } from '../../ui'
import { FormField } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import type { HeaderDraft } from '../formModel'
import { IssueModeSwitch } from './IssueModeSwitch'
import { REASON_CODE_SUGGESTIONS, issueModeHint } from './issueMode'
import type { IssueMode } from './issueMode'

/** DocumentService stores narration as text; this is the form's own civility limit. */
export const NARRATION_MAX = 500

export interface MaterialIssueDetailsProps {
  header: HeaderDraft
  issueMode: IssueMode
  onModeChange: (mode: IssueMode) => void
  onChange: (patch: Partial<HeaderDraft>) => void
  /** Raised separately so the page can offer to move existing lines too. */
  onDefaultWarehouseChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  /** Open financial year, as ISO dates — the date input is held inside it. */
  fyRange: { from: string; to: string }
  errors: Record<string, string>
  disabled?: boolean
}

export function MaterialIssueDetails({
  header,
  issueMode,
  onModeChange,
  onChange,
  onDefaultWarehouseChange,
  warehouses,
  warehousesLoading,
  fyRange,
  errors,
  disabled = false,
}: MaterialIssueDetailsProps) {
  const uid = useId()
  const id = (name: string) => `${uid}-${name}`
  const narrationLength = header.narration.length

  return (
    // The header is hand-rolled rather than FormSectionCard's `action` slot:
    // that slot is `shrink-0` beside a `min-w-0` title, so the four-pill mode
    // switch squeezed "Document details" down to one word per line on a phone.
    // Here the two stack until there is room for them side by side.
    <section className={cx(AIC, 'rounded-xl border border-gray-200 bg-white p-4 shadow-card md:p-5')}>
      <div className="mb-4 flex flex-col gap-3 border-b border-gray-100 pb-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-light">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Document details</h3>
            <p className="mt-0.5 text-xs text-gray-500">{issueModeHint(issueMode)}</p>
          </div>
        </div>
        <IssueModeSwitch value={issueMode} onChange={onModeChange} disabled={disabled} />
      </div>

      <div
        className={cx(
          AIC,
          // Five fields across only where five fields across are still readable;
          // below that they fold to three, two and one rather than shrinking.
          'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-5',
        )}
      >
        <FormField label="Document date" htmlFor={id('date')} required error={errors.document_date}>
          <Input
            id={id('date')}
            type="date"
            size="md"
            value={header.document_date}
            min={fyRange.from || undefined}
            max={fyRange.to || undefined}
            disabled={disabled}
            invalid={Boolean(errors.document_date)}
            onChange={(e) => onChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField
          label="Document no."
          htmlFor={id('no')}
          hint="Leave empty to auto-generate."
          error={errors.document_no}
        >
          <Input
            id={id('no')}
            size="md"
            value={header.document_no}
            placeholder="Auto-generate"
            disabled={disabled}
            onChange={(e) => onChange({ document_no: e.target.value })}
          />
        </FormField>

        <FormField
          label="Default warehouse"
          htmlFor={id('warehouse')}
          required
          hint="Pre-fills the warehouse on new lines."
          error={errors.default_warehouse_id}
        >
          {warehousesLoading && warehouses.length === 0 ? (
            <Skeleton height="h-9" />
          ) : (
            <Select
              id={id('warehouse')}
              size="md"
              value={header.default_warehouse_id ?? ''}
              disabled={disabled}
              invalid={Boolean(errors.default_warehouse_id)}
              onChange={(e) => onDefaultWarehouseChange(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>
                  {w.warehouse_name}
                  {w.warehouse_code ? ` (${w.warehouse_code})` : ''}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {/*
          Free text, not a master: `reason_code` is a 32-character column and
          Inventory has no reason-code table or endpoint, so the list below is a
          suggestion on an open field — anything may be typed. Required to POST
          (an issue nobody can explain is not one an auditor can follow) but not
          to save a draft, so half-finished work is never held hostage to it.
        */}
        <FormField
          label="Reason code"
          htmlFor={id('reason')}
          required
          hint="Required to post."
          error={errors.reason_code}
        >
          <Input
            id={id('reason')}
            size="md"
            list={id('reason-options')}
            value={header.reason_code}
            maxLength={32}
            placeholder="Select or type a reason"
            autoComplete="off"
            disabled={disabled}
            invalid={Boolean(errors.reason_code)}
            onChange={(e) => onChange({ reason_code: e.target.value.toUpperCase() })}
          />
          <datalist id={id('reason-options')}>
            {REASON_CODE_SUGGESTIONS.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Movement reason" htmlFor={id('movement')} error={errors.movement_reason}>
          <Input
            id={id('movement')}
            size="md"
            value={header.movement_reason}
            maxLength={64}
            placeholder="e.g. Production use, damage, sample"
            disabled={disabled}
            onChange={(e) => onChange({ movement_reason: e.target.value })}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <FormField label="Narration / remarks" htmlFor={id('narration')}>
          <div className="relative">
            <Textarea
              id={id('narration')}
              rows={3}
              value={header.narration}
              maxLength={NARRATION_MAX}
              placeholder="Enter any additional details, reference, department, etc."
              disabled={disabled}
              className="pb-6"
              onChange={(e) => onChange({ narration: e.target.value })}
            />
            <span
              className={cx(
                'pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums',
                narrationLength >= NARRATION_MAX ? 'font-semibold text-amber-600' : 'text-gray-400',
              )}
            >
              {narrationLength}/{NARRATION_MAX}
            </span>
          </div>
        </FormField>
      </div>
    </section>
  )
}

export default MaterialIssueDetails
