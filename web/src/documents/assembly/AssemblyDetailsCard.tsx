import { useId, useState } from 'react'
import { ClipboardList, Hash, MapPin, Paperclip, Plus, X } from 'lucide-react'
import { FormField, FormSectionCard } from '../../ui/shell/FormSectionCard'
import { Input } from '../../ui/Input'
import { Textarea } from '../../ui/Textarea'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'
import { WarehouseSelect } from '../WarehouseSelect'
import type { HeaderDraft } from '../formModel'
import type { DocumentMetadata } from '../types'
import { ASSEMBLY_MODES } from './assemblyModel'
import type { AssemblyErrors, AssemblyMode } from './assemblyModel'

/** One extra reference the document carries beyond the primary one. */
export interface ExtraReference {
  label: string
  value: string
}

export function extraReferences(metadata: DocumentMetadata | null | undefined): ExtraReference[] {
  const raw = metadata?.references
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
    .filter((r): r is Record<string, unknown> => r !== null)
    .map((r) => ({ label: String(r.label ?? '').trim(), value: String(r.value ?? '').trim() }))
    .filter((r) => r.label !== '' || r.value !== '')
}

export interface AssemblyDetailsCardProps {
  header: HeaderDraft
  mode: AssemblyMode
  warehouses: FormOptionWarehouse[]
  warehousesLoading: boolean
  errors: AssemblyErrors
  disabled: boolean
  onPatch: (patch: Partial<HeaderDraft>) => void
  onModeChange: (mode: AssemblyMode) => void
}

/**
 * The document's own facts: when it happened, what it is called, where it happens and why.
 *
 * Reference numbers ride in `metadata`, which is the free-form bag the server already stores per
 * document (`metadata_json`) and hands back on read. It is deliberately not a new column: a job
 * or sales order number is somebody else's identifier, and Inventory records the string it was
 * given rather than claiming a relationship to a record it cannot resolve.
 */
export function AssemblyDetailsCard({
  header,
  mode,
  warehouses,
  warehousesLoading,
  errors,
  disabled,
  onPatch,
  onModeChange,
}: AssemblyDetailsCardProps) {
  const ids = useId()
  const references = extraReferences(header.metadata)
  const [addingReference, setAddingReference] = useState(false)

  const setMeta = (patch: Record<string, unknown>) => onPatch({ metadata: { ...header.metadata, ...patch } })

  const setReferences = (next: ExtraReference[]) =>
    setMeta({ references: next.filter((r) => r.label.trim() !== '' || r.value.trim() !== '') })

  return (
    <FormSectionCard
      title="Assembly details"
      description="Assemble a kit: consume components and create the finished item."
      icon={ClipboardList}
      action={
        // No attachment endpoint exists in the Inventory API today (there is no route, no table
        // and no service for one), so the control says so rather than opening a file dialog whose
        // result would have nowhere to go. See the implementation notes.
        <Tooltip label="Attachments are not available yet: the Inventory API has no document attachment endpoint.">
          <span className="inline-flex">
            <button
              type="button"
              disabled
              aria-disabled
              // A disabled control swallows pointer events in some browsers, so the tooltip above
              // it may never open; the native title is the fallback that always says why.
              title="Attachments are not available yet: the Inventory API has no document attachment endpoint."
              className={cx(
                AIC,
                'inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-400',
              )}
            >
              <Paperclip className="h-4 w-4" aria-hidden />
              Attach files
            </button>
          </span>
        </Tooltip>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.5fr)]">
        <FormField
          label="Document date"
          htmlFor={`${ids}-date`}
          required
          error={errors.header.document_date}
        >
          <Input
            id={`${ids}-date`}
            type="date"
            value={header.document_date}
            disabled={disabled}
            invalid={Boolean(errors.header.document_date)}
            onChange={(e) => onPatch({ document_date: e.target.value })}
          />
        </FormField>

        <FormField
          label="Document no."
          htmlFor={`${ids}-no`}
          hint={header.document_no.trim() ? 'Numbered by hand.' : 'Leave empty to number automatically.'}
        >
          <div className="flex">
            <Input
              id={`${ids}-no`}
              value={header.document_no}
              placeholder="Auto-generate"
              disabled={disabled}
              className="rounded-r-none"
              onChange={(e) => onPatch({ document_no: e.target.value })}
            />
            <button
              type="button"
              disabled={disabled || header.document_no.trim() === ''}
              title="Number this document automatically"
              aria-label="Number this document automatically"
              className={cx(
                AIC,
                'flex h-8 w-9 shrink-0 items-center justify-center rounded-r-lg border border-l-0 border-gray-200 bg-white text-gray-500 transition-colors hover:text-primary disabled:cursor-not-allowed disabled:text-gray-300',
              )}
              onClick={() => onPatch({ document_no: '' })}
            >
              <Hash className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </FormField>

        <FormField label="Assembly type" hint={ASSEMBLY_MODES.find((m) => m.value === mode)?.hint}>
          <SegmentedControl
            value={mode}
            onChange={disabled ? undefined : onModeChange}
            options={ASSEMBLY_MODES.map((m) => ({ value: m.value, label: m.label, title: m.hint }))}
            size="md"
          />
        </FormField>

        <FormField
          label="Warehouse"
          htmlFor={`${ids}-wh`}
          required
          error={errors.header.default_warehouse_id}
          hint={warehousesLoading && warehouses.length === 0 ? 'Loading warehouses…' : 'Pre-fills every new component and the assembled item.'}
        >
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
            <WarehouseSelect
              id={`${ids}-wh`}
              variant="field"
              value={header.default_warehouse_id}
              onChange={(id) => onPatch({ default_warehouse_id: id })}
              warehouses={warehouses}
              disabled={disabled}
              invalid={Boolean(errors.header.default_warehouse_id)}
              className="pl-7"
            />
          </div>
        </FormField>

        <FormField label="Reference no." htmlFor={`${ids}-ref`}>
          <Input
            id={`${ids}-ref`}
            value={String(header.metadata.reference_no ?? '')}
            placeholder="SO / Job no. (optional)"
            maxLength={64}
            disabled={disabled}
            onChange={(e) => setMeta({ reference_no: e.target.value })}
          />
          {!addingReference ? (
            <button
              type="button"
              disabled={disabled}
              className="mt-1 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:text-gray-400"
              onClick={() => {
                setReferences([...references, { label: '', value: '' }])
                setAddingReference(true)
              }}
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add reference
            </button>
          ) : null}
        </FormField>

        <FormField label="Narration" htmlFor={`${ids}-narration`} className="sm:col-span-2 lg:col-span-3 xl:col-span-1">
          <Textarea
            id={`${ids}-narration`}
            rows={2}
            value={header.narration}
            placeholder="Add notes about this assembly…"
            disabled={disabled}
            onChange={(e) => onPatch({ narration: e.target.value })}
          />
        </FormField>
      </div>

      {references.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Other references</p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {references.map((reference, i) => (
              <div key={`reference-${i}`} className="flex items-center gap-1.5">
                <Input
                  value={reference.label}
                  placeholder="Label (e.g. Work order)"
                  maxLength={32}
                  disabled={disabled}
                  aria-label={`Reference ${i + 1} label`}
                  className="w-2/5"
                  onChange={(e) =>
                    setReferences(references.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                  }
                />
                <Input
                  value={reference.value}
                  placeholder="Number"
                  maxLength={64}
                  disabled={disabled}
                  aria-label={`Reference ${i + 1} number`}
                  onChange={(e) =>
                    setReferences(references.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                />
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove reference ${i + 1}`}
                  className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  onClick={() => {
                    setReferences(references.filter((_, j) => j !== i))
                    setAddingReference(false)
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </FormSectionCard>
  )
}

export default AssemblyDetailsCard
