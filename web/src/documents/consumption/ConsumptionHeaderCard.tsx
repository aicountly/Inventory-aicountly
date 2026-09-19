import { useState } from 'react'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { FormField, FormGrid, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { WarehouseSelect } from '../WarehouseSelect'
import type { FormOptionWarehouse } from '../../services/items'
import type { HeaderDraft } from '../formModel'
import { ReasonCodeCombobox } from './ReasonCodeCombobox'

export type ConsumptionMode = 'consumption' | 'quick'

interface ConsumptionHeaderCardProps {
  mode: ConsumptionMode
  onModeChange: (mode: ConsumptionMode) => void
  header: HeaderDraft
  onPatch: (patch: Partial<HeaderDraft>) => void
  warehouses: FormOptionWarehouse[]
  disabled?: boolean
}

const NARRATION_MAX = 500

/**
 * "Document Details": header fields for a Consumption document, plus the Consumption / Quick
 * Entry segmented control. Quick Entry tucks the two optional fields away so the barcode /
 * keyboard-first workflow in the lines panel below gets the vertical space instead.
 */
export function ConsumptionHeaderCard({ mode, onModeChange, header, onPatch, warehouses, disabled }: ConsumptionHeaderCardProps) {
  const [showMore, setShowMore] = useState(mode === 'consumption')
  const quick = mode === 'quick'

  return (
    <FormSectionCard
      title="Document Details"
      description="Basic information for this consumption entry"
      icon={FileText}
      action={
        <SegmentedControl
          value={mode}
          onChange={(v) => {
            onModeChange(v)
            if (v === 'consumption') setShowMore(true)
          }}
          options={[
            { value: 'consumption', label: 'Consumption' },
            { value: 'quick', label: 'Quick Entry' },
          ]}
        />
      }
    >
      <FormGrid cols={4}>
        <FormField label="Document Date" htmlFor="cons_document_date" required>
          <Input id="cons_document_date" type="date" value={header.document_date} disabled={disabled} onChange={(e) => onPatch({ document_date: e.target.value })} />
        </FormField>
        <FormField label="Document No." htmlFor="cons_document_no" hint="Leave empty to auto-generate.">
          <Input id="cons_document_no" value={header.document_no} placeholder="Auto-generate" disabled={disabled} onChange={(e) => onPatch({ document_no: e.target.value })} />
        </FormField>
        <FormField label="Default Warehouse" htmlFor="cons_default_wh" required hint="Pre-fills the warehouse on new lines.">
          <WarehouseSelect id="cons_default_wh" value={header.default_warehouse_id} onChange={(id) => onPatch({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="Select warehouse…" disabled={disabled} />
        </FormField>
        <FormField label="Reason Code" htmlFor="cons_reason_code" required>
          <ReasonCodeCombobox id="cons_reason_code" value={header.reason_code} onChange={(v) => onPatch({ reason_code: v })} disabled={disabled} />
        </FormField>

        {quick && !showMore ? (
          <FormField label=" " className="flex items-end">
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="flex h-9 items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              Movement reason &amp; narration
            </button>
          </FormField>
        ) : (
          <>
            <FormField label="Movement Reason" htmlFor="cons_movement_reason">
              <Input id="cons_movement_reason" value={header.movement_reason} placeholder="e.g. Used in production line A" maxLength={64} disabled={disabled} onChange={(e) => onPatch({ movement_reason: e.target.value })} />
            </FormField>
            <FormField label="Narration" htmlFor="cons_narration" className="md:col-span-2 lg:col-span-4">
              <div className="relative">
                <Textarea
                  id="cons_narration"
                  value={header.narration}
                  maxLength={NARRATION_MAX}
                  rows={3}
                  placeholder="Add remarks, reference, or additional details…"
                  disabled={disabled}
                  onChange={(e) => onPatch({ narration: e.target.value })}
                />
                <span className="pointer-events-none absolute bottom-2 right-2.5 text-[10px] text-gray-400">
                  {header.narration.length}/{NARRATION_MAX}
                </span>
              </div>
            </FormField>
            {quick ? (
              <button
                type="button"
                onClick={() => setShowMore(false)}
                className="-mt-1 flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600 lg:col-span-4"
              >
                <ChevronUp className="h-3 w-3" aria-hidden />
                Hide
              </button>
            ) : null}
          </>
        )}
      </FormGrid>
    </FormSectionCard>
  )
}

export default ConsumptionHeaderCard
