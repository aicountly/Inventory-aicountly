import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Info, Paperclip, Plus, Printer } from 'lucide-react'
import { Input } from '../../ui'
import { FormField } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import { ATTACHMENTS_AVAILABLE, ATTACHMENTS_UNAVAILABLE_REASON } from './attachmentsApi'
import { ProductionReferencePicker } from './ProductionReferencePicker'
import { referencesProduction } from './issueMode'
import type { IssueMode } from './issueMode'

export interface MaterialIssueSupportProps {
  issueMode: IssueMode
  referenceNo: string
  referenceDate: string
  productionDocumentId: number | null
  onReferenceChange: (next: { referenceNo?: string; referenceDate?: string; productionDocumentId?: number | null }) => void
  /** Set once a draft exists — print works off a stored document, not a form. */
  savedId: number | null
  disabled?: boolean
}

/**
 * The strip under the lines: evidence, what this issue points at, and the paper.
 *
 * Attachments render as a disabled control with the reason on it. Inventory has
 * no attachment endpoint (see attachmentsApi.ts) and a file that is accepted and
 * silently dropped is worse than a button that says it cannot take one yet.
 */
export function MaterialIssueSupport({
  issueMode,
  referenceNo,
  referenceDate,
  productionDocumentId,
  onReferenceChange,
  savedId,
  disabled = false,
}: MaterialIssueSupportProps) {
  const uid = useId()
  const id = (name: string) => `${uid}-${name}`
  const production = referencesProduction(issueMode)

  return (
    <section className={cx(AIC, 'rounded-xl border border-gray-200 bg-white p-4 shadow-card')}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.7fr)] lg:gap-6">
        <div className="lg:border-r lg:border-gray-100 lg:pr-6">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Paperclip className="h-3.5 w-3.5 text-gray-400" aria-hidden />
              Attachments (0)
            </span>
            <button
              type="button"
              disabled
              title={ATTACHMENTS_UNAVAILABLE_REASON}
              aria-describedby={id('attach-note')}
              className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-400"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add file
            </button>
          </div>
          {ATTACHMENTS_AVAILABLE ? null : (
            <p id={id('attach-note')} className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-gray-500">
              <Info className="mt-px h-3 w-3 shrink-0 text-gray-400" aria-hidden />
              {ATTACHMENTS_UNAVAILABLE_REASON}
            </p>
          )}
        </div>

        <div className="lg:border-r lg:border-gray-100 lg:pr-6">
          <span className="text-sm font-semibold text-gray-900">Reference</span>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <FormField
              label={production ? 'Production document' : 'Reference no.'}
              htmlFor={id('ref-no')}
              hint={production ? 'Posted production documents in this company.' : undefined}
            >
              {production ? (
                <ProductionReferencePicker
                  id={id('ref-no')}
                  value={referenceNo}
                  documentId={productionDocumentId}
                  disabled={disabled}
                  onChange={({ referenceNo: no, documentId }) =>
                    onReferenceChange({ referenceNo: no, productionDocumentId: documentId })
                  }
                />
              ) : (
                <Input
                  id={id('ref-no')}
                  size="md"
                  value={referenceNo}
                  maxLength={64}
                  placeholder="e.g. Work order / MRN"
                  disabled={disabled}
                  onChange={(e) => onReferenceChange({ referenceNo: e.target.value })}
                />
              )}
            </FormField>
            <FormField label="Reference date" htmlFor={id('ref-date')}>
              <Input
                id={id('ref-date')}
                type="date"
                size="md"
                value={referenceDate}
                disabled={disabled}
                onChange={(e) => onReferenceChange({ referenceDate: e.target.value })}
              />
            </FormField>
          </div>
        </div>

        <div>
          <span className="text-sm font-semibold text-gray-900">Preview &amp; print</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {savedId ? (
              <>
                <Link
                  to={`/documents/${savedId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  Preview
                </Link>
                <Link
                  to={`/documents/${savedId}/print`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                  Print
                </Link>
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-gray-500">
                Save the draft first — the print view is rendered from the stored document, not from the form.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default MaterialIssueSupport
