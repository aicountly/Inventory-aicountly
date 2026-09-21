import { ArrowRight } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'
import { isBlankLine } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import { destinationWarehouseFor, estimatedLineValue, formatEstimate, reasonLabel, sourceWarehouseFor } from './transferModel'
import type { TransferRefs, TransferTotals } from './transferModel'
import { OTHER_REFERENCE_TYPE } from './transferReasons'

export interface TransferPreviewDrawerProps {
  open: boolean
  onClose: () => void
  header: HeaderDraft
  refs: TransferRefs
  lines: LineDraft[]
  totals: TransferTotals
  rates: ReadonlyMap<number, number> | null
  currencyCode: string | null
  documentNo: string | null
  status: string | null
  warehouseName: (id: number | null | undefined) => string
  referenceTypeLabel: (code: string) => string
  /** Post straight from the preview; omitted when the profile cannot post. */
  onPost?: () => void
  posting?: boolean
  postDisabled?: boolean
}

const TH = 'px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200'
const TD = 'px-2 py-1.5 align-top border-b border-gray-100 text-xs text-gray-700'

/**
 * The transfer as it will read once saved, from the draft on screen.
 *
 * Not a PDF and not the print sheet: the server builds a print snapshot
 * (`/print-snapshot`) only for a document that exists, so a draft that has never
 * been saved has nothing to print. Once posted, the existing print screen takes
 * over — this is the look-before-you-post.
 */
export function TransferPreviewDrawer({
  open,
  onClose,
  header,
  refs,
  lines,
  totals,
  rates,
  currencyCode,
  documentNo,
  status,
  warehouseName,
  referenceTypeLabel,
  onPost,
  posting = false,
  postDisabled = false,
}: TransferPreviewDrawerProps) {
  const active = lines.filter((l) => !isBlankLine(l))
  const reference = [
    refs.referenceType ? (refs.referenceType === OTHER_REFERENCE_TYPE ? 'Other' : referenceTypeLabel(refs.referenceType)) : '',
    refs.referenceNo,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Stock transfer preview"
      badge={status ? <Badge tone={status === 'DRAFT' ? 'neutral' : 'info'} size="sm">{status}</Badge> : <Badge tone="neutral" size="sm">Not saved</Badge>}
      description="Everything this document will carry. Nothing has moved yet."
      width="xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Back to editing
          </Button>
          {onPost ? (
            <Button variant="primary" onClick={onPost} loading={posting} disabled={postDisabled}>
              Save &amp; post
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
          <span>{warehouseName(header.from_warehouse_id) || 'Source not chosen'}</span>
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden />
          <span>{warehouseName(header.to_warehouse_id) || 'Destination not chosen'}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          <Field label="Document no." value={documentNo ?? 'Numbered on save'} />
          <Field label="Document date" value={formatDate(header.document_date)} />
          <Field label="Expected arrival" value={refs.expectedArrivalDate ? formatDate(refs.expectedArrivalDate) : '—'} />
          <Field label="Transfer reason" value={reasonLabel(header) || '—'} />
          <Field label="Reference" value={reference || '—'} />
          <Field label="Lines" value={`${totals.items}`} />
        </dl>
        {header.narration.trim() ? (
          <div className="mt-3 border-t border-gray-100 pt-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Narration</span>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{header.narration.trim()}</p>
          </div>
        ) : null}
      </div>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Items</h3>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[34rem] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={cx(TH, 'w-8')}>
                #
              </th>
              <th scope="col" className={TH}>
                Item
              </th>
              <th scope="col" className={TH}>
                Route
              </th>
              <th scope="col" className={TH}>
                Batch / serials
              </th>
              <th scope="col" className={cx(TH, 'text-right')}>
                Qty
              </th>
              <th scope="col" className={cx(TH, 'text-right')}>
                Est. value
              </th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">
                  No items on this transfer yet.
                </td>
              </tr>
            ) : null}
            {active.map((line, i) => {
              const unit = line.units.find((u) => u.unit_id === line.unit_id)
              const value = estimatedLineValue(line, rates)
              return (
                <tr key={line.key}>
                  <td className={cx(TD, 'text-gray-400 tabular-nums')}>{i + 1}</td>
                  <td className={TD}>
                    <span className="block font-medium text-gray-900">{line.item_name || `Item #${line.item_id}`}</span>
                    {line.item_sku ? <span className="block text-[10px] text-gray-400">{line.item_sku}</span> : null}
                    {line.description ? <span className="block text-[10px] text-gray-500">{line.description}</span> : null}
                  </td>
                  <td className={cx(TD, 'text-[11px]')}>
                    {warehouseName(sourceWarehouseFor(line, header))} → {warehouseName(destinationWarehouseFor(line, header))}
                  </td>
                  <td className={cx(TD, 'text-[11px]')}>
                    {line.batch_no ? <span className="block">Batch {line.batch_no}</span> : null}
                    {line.serials.length > 0 ? (
                      <span className="block">
                        {line.serials.length} serial{line.serials.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    {!line.batch_no && line.serials.length === 0 ? <span className="text-gray-400">—</span> : null}
                  </td>
                  <td className={cx(TD, 'text-right tabular-nums')}>
                    {formatQty(line.qty)} {unit?.unit_symbol ?? ''}
                  </td>
                  <td className={cx(TD, 'text-right tabular-nums')}>
                    {rates === null ? <span className="text-gray-400">Withheld</span> : formatEstimate(value, currencyCode)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {active.length > 0 ? (
            <tfoot>
              <tr className="bg-gray-50">
                <td colSpan={4} className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Total
                </td>
                <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-gray-900">{formatQty(totals.quantity)}</td>
                <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-gray-900">
                  {rates === null ? <span className="font-medium text-gray-400">Withheld</span> : formatEstimate(totals.value, currencyCode)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        Estimated values use the current inventory unit cost. What the transfer actually posts at is decided by the valuation
        engine, cost layer by cost layer, when it runs.
      </p>
    </Drawer>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="m-0 mt-0.5 truncate text-xs text-gray-900">{value}</dd>
    </div>
  )
}
