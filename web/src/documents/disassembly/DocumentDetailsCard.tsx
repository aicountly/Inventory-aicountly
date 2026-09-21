import type { Ref } from 'react'
import { FileText, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { FormOptionWarehouse } from '../../services/items'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Textarea } from '../../ui/Textarea'
import { Tooltip } from '../../ui/Tooltip'
import { FormSectionCard, FormField } from '../../ui/shell/FormSectionCard'
import { WarehouseSelect } from '../WarehouseSelect'
import type { HeaderDraft } from '../formModel'
import type { DisassemblyIssue } from './validation'

/**
 * Reference types offered on a disassembly.
 *
 * Every value is something that exists in the Aicountly domain: the first four are inventory
 * document types this app raises, the next two are the external references Books and a customer's
 * ERP issue (which is what the placeholder "WO-001, SO-123" means). The pair is stored in the
 * document's metadata, which is where every other free reference on an inventory document lives.
 */
export const REFERENCE_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'production', label: 'Production' },
  { value: 'job_work', label: 'Job work' },
  { value: 'stock_journal', label: 'Stock journal' },
  { value: 'work_order', label: 'Work order' },
  { value: 'sales_order', label: 'Sales order' },
  { value: 'other', label: 'Other' },
]

export const NARRATION_MAX = 500

export interface DocumentDetailsCardProps {
  header: HeaderDraft
  warehouses: FormOptionWarehouse[]
  errors: Map<string, DisassemblyIssue>
  onChange: (patch: Partial<HeaderDraft>) => void
  /** Editing a saved document — the number is fixed by then. */
  documentNo: string | null
  canConfigureNumbering: boolean
  disabled?: boolean
  dateRef?: Ref<HTMLInputElement>
}

export function DocumentDetailsCard({
  header,
  warehouses,
  errors,
  onChange,
  documentNo,
  canConfigureNumbering,
  disabled,
  dateRef,
}: DocumentDetailsCardProps) {
  const referenceType = String(header.metadata.reference_type ?? '')
  const referenceNo = String(header.metadata.reference_no ?? '')
  const dateError = errors.get('document_date')
  const whError = errors.get('default_warehouse_id')
  const narrationError = errors.get('narration')
  const setMeta = (patch: Record<string, unknown>) => onChange({ metadata: { ...header.metadata, ...patch } })

  return (
    <FormSectionCard title="Document details" icon={FileText}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label="Document date" htmlFor="dis-date" required error={dateError?.message}>
          <Input
            ref={dateRef}
            id="dis-date"
            type="date"
            size="md"
            value={header.document_date}
            disabled={disabled}
            invalid={Boolean(dateError)}
            onChange={(e) => onChange({ document_date: e.target.value })}
          />
        </FormField>

        <FormField
          label="Document no."
          htmlFor="dis-no"
          hint={documentNo ? 'Assigned when the document was created.' : 'Leave empty to number automatically.'}
        >
          <div className="flex items-center gap-1.5">
            <Input
              id="dis-no"
              size="md"
              value={header.document_no}
              placeholder={documentNo ?? 'Auto-generate'}
              disabled={disabled}
              onChange={(e) => onChange({ document_no: e.target.value })}
            />
            {canConfigureNumbering ? (
              <Tooltip label="Document numbering settings">
                <Link
                  to="/settings/document-types"
                  data-unsaved-allow
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-primary/40 hover:text-primary"
                  aria-label="Document numbering settings"
                >
                  <Settings2 className="h-4 w-4" aria-hidden />
                </Link>
              </Tooltip>
            ) : null}
          </div>
        </FormField>

        <FormField label="Default warehouse" htmlFor="dis-wh" required error={whError?.message} hint={whError ? undefined : 'Pre-fills the warehouse on new lines.'}>
          <WarehouseSelect
            id="dis-wh"
            value={header.default_warehouse_id}
            onChange={(id) => onChange({ default_warehouse_id: id })}
            warehouses={warehouses}
            disabled={disabled}
            invalid={Boolean(whError)}
            variant="field"
            size="md"
          />
        </FormField>

        <FormField label="Reference no." htmlFor="dis-ref-no">
          <Input
            id="dis-ref-no"
            size="md"
            value={referenceNo}
            placeholder="e.g. WO-001, SO-123"
            maxLength={64}
            disabled={disabled}
            onChange={(e) => setMeta({ reference_no: e.target.value })}
          />
        </FormField>

        <FormField label="Reference type" htmlFor="dis-ref-type">
          <Select id="dis-ref-type" size="md" value={referenceType} disabled={disabled} onChange={(e) => setMeta({ reference_type: e.target.value })}>
            {REFERENCE_TYPES.map((t) => (
              <option key={t.value || 'none'} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Narration"
          htmlFor="dis-narration"
          className="sm:col-span-2 xl:col-span-3"
          error={narrationError?.message}
          hint={narrationError ? undefined : `${header.narration.length} / ${NARRATION_MAX}`}
        >
          <Textarea
            id="dis-narration"
            rows={3}
            value={header.narration}
            maxLength={NARRATION_MAX}
            disabled={disabled}
            invalid={Boolean(narrationError)}
            placeholder="E.g. Disassembling finished product into components for repair stock."
            onChange={(e) => onChange({ narration: e.target.value })}
          />
        </FormField>
      </div>
    </FormSectionCard>
  )
}
