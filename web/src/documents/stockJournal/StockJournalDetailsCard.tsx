import type { Ref } from 'react'
import { Settings2 } from 'lucide-react'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import { WarehouseField } from './WarehouseField'
import type { FormOptionWarehouse } from '../../services/items'
import type { HeaderDraft } from '../formModel'
import { ReasonCodeSelect } from './ReasonCodeSelect'
import { REASON_CHIPS, errorForField, reasonFor } from './model'
import type { JournalError } from './model'

export type EntryMode = 'manual' | 'import'

interface StockJournalDetailsCardProps {
  header: HeaderDraft
  onChange: (patch: Partial<HeaderDraft>) => void
  warehouses: readonly FormOptionWarehouse[]
  warehousesLoading: boolean
  errors: readonly JournalError[]
  disabled?: boolean
  mode: EntryMode
  onModeChange: (mode: EntryMode) => void
  /** Financial year bounds, so the date picker cannot wander out of the period. */
  fyRange: { from: string; to: string }
  dateRef?: Ref<HTMLInputElement>
}

/**
 * The document header: when, which number, where by default, and why.
 *
 * "Why" is the part that matters on this type. A stock journal with no reason is
 * an unexplained movement in the ledger a year later, so the reason code is
 * required to post and the chips underneath make the six common ones one click.
 */
export function StockJournalDetailsCard({
  header,
  onChange,
  warehouses,
  warehousesLoading,
  errors,
  disabled,
  mode,
  onModeChange,
  fyRange,
  dateRef,
}: StockJournalDetailsCardProps) {
  const reason = reasonFor(header.reason_code)
  const dateError = errorForField(errors, 'document_date')
  const reasonError = errorForField(errors, 'reason_code')

  return (
    <FormSectionCard
      title="Basic Details"
      description="Enter document details and reason for stock adjustment."
      padding="lg"
      action={
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'manual', label: 'Manual Entry' },
            { value: 'import', label: 'Import (Excel / Scan)' },
          ]}
        />
      }
    >
      <div className={cx(AIC, 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5')}>
        <FormField label="Document date" htmlFor="sj-date" required error={dateError}>
          <Input
            id="sj-date"
            ref={dateRef}
            type="date"
            size="md"
            value={header.document_date}
            disabled={disabled}
            invalid={!!dateError}
            min={fyRange.from || undefined}
            max={fyRange.to || undefined}
            onChange={(e) => onChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField label="Document no." htmlFor="sj-no" hint="Leave empty for auto number">
          <div className="flex">
            <Input
              id="sj-no"
              size="md"
              placeholder="Auto-generate"
              className="rounded-r-none"
              value={header.document_no}
              disabled={disabled}
              maxLength={64}
              onChange={(e) => onChange({ document_no: e.target.value })}
            />
            <a
              href="/settings/document-types"
              title="Document numbering settings"
              aria-label="Document numbering settings"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </FormField>

        <FormField label="Default warehouse" htmlFor="sj-wh" required hint="Pre-fills the warehouse on new lines.">
          {warehousesLoading && warehouses.length === 0 ? (
            <Skeleton className="h-9 w-full rounded-lg" />
          ) : (
            <WarehouseField
              id="sj-wh"
              size="md"
              value={header.default_warehouse_id}
              onChange={(id) => onChange({ default_warehouse_id: id })}
              warehouses={warehouses}
              disabled={disabled}
            />
          )}
        </FormField>

        <FormField label="Reason code" htmlFor="sj-reason" required error={reasonError} hint={reason?.hint}>
          <ReasonCodeSelect
            id="sj-reason"
            value={header.reason_code}
            onChange={(code) => onChange({ reason_code: code })}
            disabled={disabled}
            invalid={!!reasonError}
          />
        </FormField>

        <FormField label="Movement reason" htmlFor="sj-movement">
          <Input
            id="sj-movement"
            size="md"
            placeholder="e.g. Damaged in transit"
            value={header.movement_reason}
            disabled={disabled}
            maxLength={64}
            onChange={(e) => onChange({ movement_reason: e.target.value })}
          />
        </FormField>
      </div>

      <div className="mt-3">
        <FormField label="Narration" htmlFor="sj-narration">
          <Textarea
            id="sj-narration"
            rows={3}
            placeholder="Enter narration / remarks (optional)"
            value={header.narration}
            disabled={disabled}
            onChange={(e) => onChange({ narration: e.target.value })}
          />
        </FormField>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick reason">
        {REASON_CHIPS.map((chip) => {
          const active = header.reason_code.trim().toUpperCase() === chip.reasonCode
          return (
            <button
              key={chip.label}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() =>
                onChange({
                  reason_code: chip.reasonCode,
                  // Never overwrite a reason the user has already written.
                  movement_reason: header.movement_reason.trim() ? header.movement_reason : chip.movementReason,
                })
              }
              className={cx(
                AIC,
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                active
                  ? 'border-primary/40 bg-primary-light text-primary'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary',
              )}
            >
              + {chip.label}
            </button>
          )
        })}
      </div>
    </FormSectionCard>
  )
}
