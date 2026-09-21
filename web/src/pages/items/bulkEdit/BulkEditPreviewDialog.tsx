import { ArrowRight } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { EmptyState } from '../../../ui/EmptyState'
import { formatInt } from '../../../utils/format'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkFieldSpec } from './bulkEditFields'
import { formatCurrentValue, formatFieldValue } from './bulkEditFields'
import type { BulkEditPlan } from './bulkEditModel'

/**
 * Exactly what would be written, before anything is.
 *
 * The rows are the plan's own — the same objects the table and the counters
 * read — so the preview cannot show a different set from the one Apply sends.
 * Items that are ticked but already hold the value are named above the table
 * rather than listed in it: they are part of what the reader asked for and part
 * of what will NOT happen, and that is the sentence they need.
 */

export interface BulkEditPreviewDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  plan: BulkEditPlan
  field: BulkFieldSpec
  nextKey: string | null
  options: ItemFormOptions | null
  canApply: boolean
}

export function BulkEditPreviewDialog({
  open,
  onClose,
  onConfirm,
  plan,
  field,
  nextKey,
  options,
  canApply,
}: BulkEditPreviewDialogProps) {
  const rows = plan.rows.filter((p) => p.status === 'will_update')
  const after = nextKey === null ? '—' : nextKey === '' ? 'Cleared' : formatFieldValue(field, nextKey, options)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Preview changes"
      description={`${field.label} on ${formatInt(rows.length)} item${rows.length === 1 ? '' : 's'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onConfirm} disabled={!canApply}>
            Apply to {formatInt(rows.length)} item{rows.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {plan.counts.unchanged > 0 ? (
        <Notice kind="info" className="mb-3">
          {formatInt(plan.counts.unchanged)} ticked item{plan.counts.unchanged === 1 ? '' : 's'} already{' '}
          {plan.counts.unchanged === 1 ? 'holds' : 'hold'} this value and {plan.counts.unchanged === 1 ? 'is' : 'are'}{' '}
          not listed below — nothing is written for {plan.counts.unchanged === 1 ? 'it' : 'them'}.
        </Notice>
      ) : null}
      {plan.counts.locked > 0 ? (
        <Notice kind="warning" className="mb-3">
          {field.label} is maintained in Smart Books. None of the ticked items can be changed from Inventory.
        </Notice>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Nothing would change"
          description="Tick some items and set a value that differs from what they already hold."
        />
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[30rem] border-collapse text-left">
            <caption className="sr-only">Every item that would change, with its value before and after</caption>
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {field.columnLabel}
                </th>
                <th scope="col" className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  New {field.label}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p) => (
                <tr key={p.row.item_id}>
                  <td className="px-3 py-2 text-xs text-gray-800">
                    <span className="font-medium">{p.row.item_name}</span>
                    {p.row.item_sku ? <span className="ml-1.5 text-gray-400">{p.row.item_sku}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-gray-500">
                    {formatCurrentValue(p.row, field, options)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-emerald-700">
                      <ArrowRight className="h-3 w-3 text-gray-400" aria-hidden />
                      {after}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
