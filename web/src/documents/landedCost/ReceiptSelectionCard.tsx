import { AlertTriangle, PackageSearch, Plus, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { FormSectionCard } from '../../ui/shell'
import { AIC, cx } from '../../ui/cx'
import { Notice } from '../../components/Notice'
import { formatDate, formatInt, formatMoney, formatQty } from '../../utils/format'
import { ELIGIBILITY_LABELS, ELIGIBILITY_REASONS, isSelectable } from './model'
import type { AllocationLine, ReceiptEligibility } from './model'
import type { LoadedReceipt } from './useReceipts'

export interface SelectedReceiptRow {
  receipt: LoadedReceipt
  eligibility: ReceiptEligibility
  stale: boolean
}

interface ReceiptSelectionCardProps {
  rows: SelectedReceiptRow[]
  /** Ids chosen but whose detail could not be read, with the reason. */
  failures: Record<number, string>
  loading: boolean
  currency: string
  disabled: boolean
  onRemove: (id: number) => void
  onAdd: () => void
  onReload: () => void
}

const TONE: Record<ReceiptEligibility, 'success' | 'warning' | 'danger' | 'neutral'> = {
  eligible: 'success',
  partially_allocated: 'warning',
  not_posted: 'danger',
  reversed: 'danger',
  unvalued: 'danger',
  period_locked: 'danger',
  self: 'danger',
}

function lineTotals(lines: AllocationLine[]) {
  let qty = 0
  let invoice = 0
  let anyInvoice = false
  let current = 0
  for (const l of lines) {
    qty += l.base_qty
    current += l.valuation_amount
    if (l.invoice_amount !== null) {
      invoice += l.invoice_amount
      anyInvoice = true
    }
  }
  return { qty, invoice: anyInvoice ? invoice : null, current, count: lines.length }
}

/**
 * The receipts this bill is being loaded onto.
 *
 * A LANDED_COST document may name several, because one freight invoice routinely covers a
 * consignment that arrived over more than one GRN, and splitting it by hand means inventing a
 * division of the bill before the allocator gets to make one.
 *
 * A receipt that cannot carry a cost is shown with the reason rather than hidden: the operator
 * picked it for a reason, and "it is not in the list" answers nothing. Its row is marked, its
 * badge names the state and the tooltip says why — and posting readiness refuses until it is
 * removed, which is the same refusal the server would make.
 */
export function ReceiptSelectionCard({ rows, failures, loading, currency, disabled, onRemove, onAdd, onReload }: ReceiptSelectionCardProps) {
  const usable = rows.filter((r) => isSelectable(r.eligibility))
  const allLines = usable.flatMap((r) => r.receipt.lines)
  const totals = lineTotals(allLines)
  const failureIds = Object.keys(failures).map(Number)

  return (
    <FormSectionCard
      title="Select receipts (GRN)"
      description="Choose the material receipts these costs will be allocated to. One bill can cover a consignment that arrived on more than one receipt."
      icon={PackageSearch}
      action={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" icon={RefreshCw} onClick={onReload} aria-label="Reload the selected receipts" />
          <Button variant="outline" size="sm" icon={Plus} onClick={onAdd} disabled={disabled} kbd="Alt R">
            Add receipts
          </Button>
        </div>
      }
    >
      {failureIds.length > 0 ? (
        <Notice kind="error" className="mb-3">
          {failureIds.map((id) => (
            <div key={id}>
              Receipt #{id} could not be read: {failures[id]}
            </div>
          ))}
        </Notice>
      ) : null}

      {rows.length === 0 && !loading ? (
        <EmptyState
          icon={PackageSearch}
          title="No receipts selected"
          description="Posted and valued material receipts can carry a landed cost. Choose the ones this consignment arrived on."
          action={
            <Button icon={Plus} onClick={onAdd} disabled={disabled}>
              Choose receipts
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className={cx(AIC, 'w-full border-collapse text-xs')}>
            <caption className="sr-only">Receipts selected for this landed cost allocation</caption>
            <thead>
              <tr className="bg-gray-50 text-left">
                <th scope="col" className="w-9 px-2.5 py-2">
                  <span className="sr-only">Selected</span>
                </th>
                <th scope="col" className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Receipt no.
                </th>
                <th scope="col" className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Date
                </th>
                <th scope="col" className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Items
                </th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Qty
                </th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Invoice value
                </th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Current value
                </th>
                <th scope="col" className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ receipt, eligibility, stale }) => {
                const t = lineTotals(receipt.lines)
                const blocked = !isSelectable(eligibility)
                return (
                  <tr key={receipt.document_id} className={cx('border-t border-gray-100', blocked ? 'bg-red-50/40' : 'hover:bg-gray-50')}>
                    <td className="px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked
                        disabled={disabled}
                        className="h-4 w-4 accent-[rgb(var(--color-primary))]"
                        aria-label={`Remove ${receipt.document.document_no ?? `receipt #${receipt.document_id}`} from this allocation`}
                        onChange={() => onRemove(receipt.document_id)}
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      <Link to={`/documents/${receipt.document_id}`} className="font-semibold text-primary no-underline hover:underline">
                        {receipt.document.document_no ?? `#${receipt.document_id}`}
                      </Link>
                      {receipt.document.party_name ? <span className="block truncate text-[10px] text-gray-500">{receipt.document.party_name}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-gray-600">{formatDate(receipt.document.document_date)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-gray-600">{formatInt(t.count)} item{t.count === 1 ? '' : 's'}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">{formatQty(t.qty, '0')}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">{t.invoice === null ? '—' : formatMoney(t.invoice)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">{formatMoney(t.current)}</td>
                    <td className="px-2.5 py-2">
                      <Tooltip label={stale ? 'This receipt changed after the allocation was prepared. Refresh before posting.' : ELIGIBILITY_REASONS[eligibility]}>
                        <span tabIndex={0} className="inline-flex rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                          <Badge tone={stale ? 'danger' : TONE[eligibility]} size="xs" dot>
                            {stale ? 'Changed' : ELIGIBILITY_LABELS[eligibility]}
                          </Badge>
                        </span>
                      </Tooltip>
                      {blocked ? (
                        <span className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-red-700">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                          {ELIGIBILITY_REASONS[eligibility]}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {loading ? (
                <tr className="border-t border-gray-100">
                  <td colSpan={8} className="px-2.5 py-2">
                    <Skeleton height="h-6" />
                  </td>
                </tr>
              ) : null}
            </tbody>
            {usable.length > 0 ? (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/70 font-semibold">
                  <td className="px-2.5 py-2 text-gray-600" colSpan={3}>
                    {usable.length} receipt{usable.length === 1 ? '' : 's'} selected
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-gray-600">{formatInt(totals.count)} line{totals.count === 1 ? '' : 's'}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">{formatQty(totals.qty, '0')}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">
                    {totals.invoice === null ? '—' : `${currency} ${formatMoney(totals.invoice)}`}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-gray-900">
                    {currency} {formatMoney(totals.current)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </FormSectionCard>
  )
}
