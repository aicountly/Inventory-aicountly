import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FileText, Settings2 } from 'lucide-react'
import { FormField } from '../../components/FormField'
import type { FormOptionWarehouse } from '../../services/items'
import { Card } from '../../ui/Card'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { formatDate, formatQty } from '../../utils/format'
import { WarehouseSelect } from '../WarehouseSelect'
import type { HeaderDraft } from '../formModel'
import { JobWorkerField } from './JobWorkerField'
import { booksLedgerHref } from './jobWorkLinks'
import { JOB_WORK_FIELD } from './jobWorkModel'
import type { JobWorkMode, PendingDocumentGroup } from './jobWorkModel'
import type { JobWorkModeSpec } from './jobWorkMode'

const CONTROL = 'h-8 px-2.5 text-sm'

export interface JobWorkDetailsCardProps {
  modeSpec: JobWorkModeSpec
  mode: JobWorkMode
  header: HeaderDraft
  patch: (patch: Partial<HeaderDraft>) => void
  patchMeta: (patch: Record<string, unknown>) => void
  warehouses: FormOptionWarehouse[]
  /** Open dispatches for the selected job worker — the reference a receipt is raised against. */
  references: readonly PendingDocumentGroup[]
  referencesLoading: boolean
  fieldErrors: Record<string, string>
  disabled?: boolean
  onModeChange: (mode: JobWorkMode) => void
  onAutoFill: () => void
  /** True once the document has a number the server assigned. */
  numberLocked: boolean
}

/**
 * The document header.
 *
 * Four columns on a desktop, two on a tablet, one on a phone — the fields a
 * job-work document actually needs, in the order they are keyed. Anything a
 * challan prints but Inventory never posts on (the job type, the instructions,
 * who is responsible) is behind "Additional details", so the default form stays
 * the eight fields an operator fills every time.
 */
export function JobWorkDetailsCard({
  modeSpec,
  mode,
  header,
  patch,
  patchMeta,
  warehouses,
  references,
  referencesLoading,
  fieldErrors,
  disabled,
  onModeChange,
  onAutoFill,
  numberLocked,
}: JobWorkDetailsCardProps) {
  const [advanced, setAdvanced] = useState(false)
  const meta = header.metadata
  const referenceId = meta.reference_outward_document_id ? Number(meta.reference_outward_document_id) : null

  return (
    <Card padding="md" className={cx(AIC, 'jw-fields')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-light">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-gray-900">{modeSpec.detailsTitle}</h2>
        </div>
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          size="md"
          options={[
            { value: 'in' as JobWorkMode, label: 'Inward', title: 'Job Work Inward (Alt+I)' },
            { value: 'out' as JobWorkMode, label: 'Outward', title: 'Job Work Outward (Alt+O)' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Document date" htmlFor={JOB_WORK_FIELD.documentDate} required error={fieldErrors[JOB_WORK_FIELD.documentDate]}>
          <input
            id={JOB_WORK_FIELD.documentDate}
            type="date"
            value={header.document_date}
            disabled={disabled}
            onChange={(e) => patch({ document_date: e.target.value })}
            className={cx(FIELD_BASE, fieldErrors[JOB_WORK_FIELD.documentDate] ? FIELD_INVALID : FIELD_OK, CONTROL)}
          />
        </FormField>

        <FormField
          label="Document no."
          htmlFor={JOB_WORK_FIELD.documentNo}
          help={numberLocked ? 'Assigned when the document was created.' : 'Leave empty to number automatically.'}
        >
          <div className="relative">
            <input
              id={JOB_WORK_FIELD.documentNo}
              value={header.document_no}
              disabled={disabled || numberLocked}
              placeholder="Auto"
              onChange={(e) => patch({ document_no: e.target.value })}
              className={cx(FIELD_BASE, FIELD_OK, CONTROL, 'pr-8')}
            />
            <Settings2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-300" aria-hidden />
          </div>
        </FormField>

        <FormField
          label="Job worker"
          htmlFor={JOB_WORK_FIELD.jobWorker}
          required
          error={fieldErrors[JOB_WORK_FIELD.jobWorker]}
          help="The Books ledger the goods are tracked against."
        >
          <JobWorkerField
            inputId={JOB_WORK_FIELD.jobWorker}
            value={{ partyRef: header.party_ref, partyName: header.party_name }}
            onChange={(v) => patch({ party_ref: v.partyRef, party_name: v.partyName })}
            disabled={disabled}
            invalid={Boolean(fieldErrors[JOB_WORK_FIELD.jobWorker])}
            ledgerHref={booksLedgerHref(header.party_ref)}
          />
        </FormField>

        <FormField
          label={modeSpec.warehouseLabel}
          htmlFor={JOB_WORK_FIELD.warehouse}
          required
          error={fieldErrors[JOB_WORK_FIELD.warehouse]}
          help={modeSpec.warehouseHelp}
        >
          <WarehouseSelect
            id={JOB_WORK_FIELD.warehouse}
            value={header.default_warehouse_id}
            onChange={(id) => patch({ default_warehouse_id: id })}
            warehouses={warehouses}
            disabled={disabled}
            invalid={Boolean(fieldErrors[JOB_WORK_FIELD.warehouse])}
          />
        </FormField>

        {mode === 'in' ? (
          <FormField
            label="Reference (outward doc)"
            htmlFor="jw-reference"
            help={
              header.party_ref === ''
                ? 'Pick the job worker first.'
                : referencesLoading
                  ? 'Loading open dispatches…'
                  : references.length === 0
                    ? 'Nothing open for this job worker.'
                    : 'Selecting one filters the pending list to it.'
            }
          >
            <div className="flex gap-1.5">
              <select
                id="jw-reference"
                value={referenceId ?? ''}
                disabled={disabled || references.length === 0}
                onChange={(e) => patchMeta({ reference_outward_document_id: e.target.value === '' ? undefined : Number(e.target.value) })}
                className={cx(FIELD_BASE, FIELD_OK, CONTROL, 'min-w-0 flex-1')}
              >
                <option value="">All open dispatches</option>
                {references.map((ref) => (
                  <option key={ref.documentId} value={ref.documentId}>
                    {ref.documentNo} · {formatDate(ref.documentDate)} · {formatQty(ref.open)} open
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onAutoFill}
                disabled={disabled || references.length === 0}
                title="Open the pending list and pick what this receipt settles"
                aria-label="Open the pending job-work list"
                className="aic inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-white text-primary hover:bg-primary-light disabled:opacity-50"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </FormField>
        ) : (
          <FormField
            label="Expected return"
            htmlFor={JOB_WORK_FIELD.expectedReturn}
            error={fieldErrors[JOB_WORK_FIELD.expectedReturn]}
            help="When the goods are due back. Drives the overdue figures."
          >
            <input
              id={JOB_WORK_FIELD.expectedReturn}
              type="date"
              value={header.expected_return_date}
              disabled={disabled}
              onChange={(e) => patch({ expected_return_date: e.target.value, returnable: e.target.value !== '' ? true : header.returnable })}
              className={cx(FIELD_BASE, fieldErrors[JOB_WORK_FIELD.expectedReturn] ? FIELD_INVALID : FIELD_OK, CONTROL)}
            />
          </FormField>
        )}

        <FormField label="Challan / LR no." htmlFor="jw-challan-no">
          <input
            id="jw-challan-no"
            value={typeof meta.challan_no === 'string' ? meta.challan_no : ''}
            disabled={disabled}
            maxLength={64}
            placeholder="Transporter or challan number"
            onChange={(e) => patchMeta({ challan_no: e.target.value })}
            className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
          />
        </FormField>

        <FormField label="Challan date" htmlFor="jw-challan-date">
          <input
            id="jw-challan-date"
            type="date"
            value={typeof meta.challan_date === 'string' ? meta.challan_date : ''}
            disabled={disabled}
            onChange={(e) => patchMeta({ challan_date: e.target.value })}
            className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
          />
        </FormField>

        <FormField label="Reference no." htmlFor="jw-reference-no" help="The job worker's own reference, if they gave one.">
          <input
            id="jw-reference-no"
            value={typeof meta.reference_no === 'string' ? meta.reference_no : ''}
            disabled={disabled}
            maxLength={64}
            onChange={(e) => patchMeta({ reference_no: e.target.value })}
            className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
          />
        </FormField>

        <FormField label="Narration" htmlFor="jw-narration" className="md:col-span-2 xl:col-span-4">
          <textarea
            id="jw-narration"
            rows={2}
            value={header.narration}
            disabled={disabled}
            placeholder="Notes, remarks or a reference for whoever reads this later"
            onChange={(e) => patch({ narration: e.target.value })}
            className={cx(FIELD_BASE, FIELD_OK, 'px-3 py-2 text-sm')}
          />
        </FormField>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          aria-controls="jw-advanced"
          className="aic inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-primary"
        >
          {advanced ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          Additional details
        </button>
        {advanced ? (
          <div id="jw-advanced" className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Job work type" htmlFor="jw-type" help="Plating, machining, stitching…">
              <input
                id="jw-type"
                value={typeof meta.job_work_type === 'string' ? meta.job_work_type : ''}
                disabled={disabled}
                maxLength={64}
                onChange={(e) => patchMeta({ job_work_type: e.target.value })}
                className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
              />
            </FormField>
            <FormField label="Priority" htmlFor="jw-priority">
              <select
                id="jw-priority"
                value={typeof meta.job_work_priority === 'string' ? meta.job_work_priority : 'normal'}
                disabled={disabled}
                onChange={(e) => patchMeta({ job_work_priority: e.target.value })}
                className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </FormField>
            <FormField label="Responsible person" htmlFor="jw-responsible">
              <input
                id="jw-responsible"
                value={typeof meta.responsible_person === 'string' ? meta.responsible_person : ''}
                disabled={disabled}
                maxLength={64}
                onChange={(e) => patchMeta({ responsible_person: e.target.value })}
                className={cx(FIELD_BASE, FIELD_OK, CONTROL)}
              />
            </FormField>
            <FormField label="Processing instructions" htmlFor="jw-instructions" className="md:col-span-2 xl:col-span-4">
              <textarea
                id="jw-instructions"
                rows={2}
                value={typeof meta.processing_instructions === 'string' ? meta.processing_instructions : ''}
                disabled={disabled}
                placeholder="What the job worker has to do"
                onChange={(e) => patchMeta({ processing_instructions: e.target.value })}
                className={cx(FIELD_BASE, FIELD_OK, 'px-3 py-2 text-sm')}
              />
            </FormField>
          </div>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="What this document does">
        {modeSpec.chips.map((chip) => (
          <li
            key={chip.key}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
              chip.primary ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600',
            )}
          >
            <chip.icon className="h-3 w-3 shrink-0" aria-hidden />
            {chip.label}
          </li>
        ))}
      </ul>
    </Card>
  )
}
