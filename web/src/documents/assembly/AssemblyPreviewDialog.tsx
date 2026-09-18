import { Printer } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import { lineBaseQty } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { AssemblyCostSummary, AssemblySplit } from './assemblyModel'
import { filledComponents } from './assemblyModel'
import { extraReferences } from './AssemblyDetailsCard'

export interface AssemblyPreviewDialogProps {
  open: boolean
  onClose: () => void
  header: HeaderDraft
  split: AssemblySplit
  cost: AssemblyCostSummary
  costHidden: boolean
  currencySymbol: string
  warehouseName: (id: number | null | undefined) => string
  companyName: string
  scopeLabel: string
  /** Set once the draft has been stored — printing needs a document to print. */
  savedDocumentId: number | null
  onPrint: () => void
  canPrint: boolean
}

function unitOf(line: LineDraft): string {
  return line.units.find((u) => u.unit_id === line.unit_id)?.unit_symbol ?? ''
}

/**
 * What this document will say, before it says it.
 *
 * Built from the draft on screen rather than from the server, so it works before the first save —
 * which is the moment a preview is actually wanted. It is deliberately NOT the printed document:
 * a posted assembly prints from the server's immutable snapshot (`/documents/:id/print`), and
 * this dialog links there rather than rendering a second, drifting version of the same paper.
 */
export function AssemblyPreviewDialog({
  open,
  onClose,
  header,
  split,
  cost,
  costHidden,
  currencySymbol,
  warehouseName,
  companyName,
  scopeLabel,
  savedDocumentId,
  onPrint,
  canPrint,
}: AssemblyPreviewDialogProps) {
  const components = filledComponents(split.components)
  const finished = split.finished
  const references = extraReferences(header.metadata)
  const costByKey = new Map(cost.rows.map((r) => [r.key, r]))

  return (
    <Modal
      open={open}
      title="Assembly preview"
      description="A draft read of this document. Nothing is saved or posted from here."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canPrint ? (
            <Button icon={Printer} onClick={onPrint} disabled={savedDocumentId === null}>
              Print
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 text-sm text-gray-800">
        {savedDocumentId === null ? (
          <Notice kind="info">
            This assembly has not been saved yet, so there is nothing to print. Save it as a draft first — the printed
            document is produced from the server&rsquo;s own record, never from this screen.
          </Notice>
        ) : null}

        <header className="border-b border-gray-200 pb-3">
          <p className="text-base font-semibold text-gray-900">{companyName || 'Assembly'}</p>
          <p className="text-xs text-gray-500">{scopeLabel}</p>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-gray-700">Assembly</p>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Document no.</dt>
            <dd className="mt-0.5">{header.document_no.trim() || <span className="text-gray-500">Numbered on save</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Date</dt>
            <dd className="mt-0.5">{formatDate(header.document_date)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Warehouse</dt>
            <dd className="mt-0.5">{warehouseName(header.default_warehouse_id) || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Reference</dt>
            <dd className="mt-0.5">{String(header.metadata.reference_no ?? '') || '—'}</dd>
          </div>
        </dl>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Assembled item</h3>
          {finished && finished.item_id !== null ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
              <p className="font-semibold text-gray-900">{finished.item_name}</p>
              <p className="mt-0.5 text-xs text-gray-600">
                {formatQty(finished.qty)} {unitOf(finished)} into {warehouseName(finished.warehouse_id ?? header.default_warehouse_id) || '—'}
                {finished.batch_no ? ` · batch ${finished.batch_no}` : ''}
                {finished.serials.length ? ` · ${finished.serials.length} serial${finished.serials.length === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No finished item chosen yet.</p>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Components consumed ({components.length})
          </h3>
          {components.length === 0 ? (
            <p className="text-xs text-gray-500">No components entered yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">Item</th>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">Warehouse</th>
                    <th scope="col" className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">Batch / serial</th>
                    <th scope="col" className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wide text-gray-500">Qty</th>
                    {!costHidden ? (
                      <th scope="col" className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wide text-gray-500">Amount</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {components.map((line) => {
                    const rowCost = costByKey.get(line.key)
                    return (
                      <tr key={line.key}>
                        <td className="px-2.5 py-1.5">{line.item_name || `Item #${line.item_id}`}</td>
                        <td className="px-2.5 py-1.5 text-gray-600">
                          {warehouseName(line.warehouse_id ?? header.default_warehouse_id) || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-gray-600">
                          {line.batch_no ?? (line.serials.length ? `${line.serials.length} serials` : '—')}
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {formatQty(line.qty)} {unitOf(line)}
                        </td>
                        {!costHidden ? (
                          <td className="px-2.5 py-1.5 text-right tabular-nums">
                            {rowCost?.amount != null ? `${currencySymbol} ${formatMoney(rowCost.amount)}` : '—'}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!costHidden ? (
          <section className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Cost summary</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Components</dt>
                <dd className="font-semibold tabular-nums">{currencySymbol} {formatMoney(cost.componentCost)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Output (base)</dt>
                <dd className="font-semibold tabular-nums">{formatQty(finished ? lineBaseQty(finished) : 0)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Estimated unit cost</dt>
                <dd className="font-semibold tabular-nums">
                  {cost.estimatedUnitCost === null ? '—' : `${currencySymbol} ${formatMoney(cost.estimatedUnitCost)}`}
                </dd>
              </div>
            </dl>
            {cost.partial ? (
              <p className="mt-1 text-[11px] text-amber-700">
                {cost.unpricedLines} component{cost.unpricedLines === 1 ? '' : 's'} have no cost on record; the figure
                above is a floor. The valuation method decides the final cost when this posts.
              </p>
            ) : null}
          </section>
        ) : null}

        {header.narration.trim() ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Narration</h3>
            <p className="whitespace-pre-wrap text-xs text-gray-700">{header.narration}</p>
          </section>
        ) : null}

        {references.length > 0 ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Other references</h3>
            <ul className="text-xs text-gray-700">
              {references.map((r, i) => (
                <li key={`preview-ref-${i}`}>
                  {r.label || 'Reference'}: {r.value || '—'}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-[11px] text-gray-500">
          Attachments are not part of this document: the Inventory API has no attachment endpoint yet.
        </p>
      </div>
    </Modal>
  )
}

export default AssemblyPreviewDialog
