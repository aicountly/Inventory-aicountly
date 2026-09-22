import { ArrowRight } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { formatInt } from '../../utils/format'
import type { BooksTaxCategory, BulkTaxUpdateValidation } from '../../services/bulkTaxUpdateApi'
import { taxCategoryOptionLabel } from '../../services/bulkTaxUpdateApi'

export interface BulkTaxUpdatePreviewDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  validation: BulkTaxUpdateValidation | null
  taxCategories: readonly BooksTaxCategory[]
  newCategoryLabel: string
  effectiveFrom: string
  applying: boolean
  canApply: boolean
}

/**
 * Exactly what Books' own `validate` call says would happen, before `apply` sends the same
 * batch — the rows here are the plan's own, so this can never show a different outcome from
 * what Apply is about to write.
 */
export function BulkTaxUpdatePreviewDialog({
  open,
  onClose,
  onConfirm,
  validation,
  taxCategories,
  newCategoryLabel,
  effectiveFrom,
  applying,
  canApply,
}: BulkTaxUpdatePreviewDialogProps) {
  const rows = validation?.rows ?? []
  const willUpdate = rows.filter((r) => r.status === 'ok')
  const unchanged = rows.filter((r) => r.status === 'unchanged')
  const errored = rows.filter((r) => r.status === 'error')

  const nameFor = (id: unknown): string => {
    const cat = taxCategories.find((c) => String(c.tax_cat_id) === String(id))
    return cat ? taxCategoryOptionLabel(cat) : id ? `#${id}` : '—'
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Preview changes"
      description={`${newCategoryLabel || 'New tax category'} on ${formatInt(willUpdate.length)} item${willUpdate.length === 1 ? '' : 's'}, effective ${effectiveFrom}`}
      busy={applying}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            Close
          </Button>
          <Button onClick={onConfirm} loading={applying} disabled={!canApply || errored.length > 0 || willUpdate.length === 0}>
            Apply to {formatInt(willUpdate.length)} item{willUpdate.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!canApply ? (
        <Notice kind="warning" className="mb-3">
          You have read-only access — you can preview this change but not apply it.
        </Notice>
      ) : null}
      {unchanged.length > 0 ? (
        <Notice kind="info" className="mb-3">
          {formatInt(unchanged.length)} ticked item{unchanged.length === 1 ? '' : 's'} already{' '}
          {unchanged.length === 1 ? 'holds' : 'hold'} this tax category and{' '}
          {unchanged.length === 1 ? 'is' : 'are'} not listed below — nothing is written for {unchanged.length === 1 ? 'it' : 'them'}.
        </Notice>
      ) : null}
      {errored.length > 0 ? (
        <Notice kind="error" className="mb-3">
          {formatInt(errored.length)} item{errored.length === 1 ? '' : 's'} failed validation — fix or deselect{' '}
          {errored.length === 1 ? 'it' : 'them'} before applying. Nothing has been written yet.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Nothing would change"
          description="Tick some items and choose a tax category that differs from what they already hold."
        />
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <caption className="sr-only">Every item that would change, with its tax category before and after</caption>
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Item</th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current</th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">New</th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...errored, ...willUpdate].map((r) => {
                const change = r.changes.find((c) => c.field === 'tax_cat_id')
                return (
                  <tr key={r.id} className={r.status === 'error' ? 'bg-red-50/60' : undefined}>
                    <td className="px-3 py-2 text-xs text-gray-800">
                      <span className="font-medium">{r.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{change ? nameFor(change.from) : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.status === 'error' ? (
                        <span className="text-red-600">{Object.values(r.errors)[0] ?? 'Invalid'}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-emerald-700">
                          <ArrowRight className="h-3 w-3 text-gray-400" aria-hidden />
                          {change ? nameFor(change.to) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {r.notes?.[0] ?? (r.status === 'error' ? 'Error' : 'Will update')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
