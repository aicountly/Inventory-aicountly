import { ClipboardList } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'

export type StockVerdict = 'sufficient' | 'attention' | 'checking' | 'unknown'

const VERDICT: Record<StockVerdict, { label: string; dot: string; text: string }> = {
  sufficient: { label: 'Sufficient', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  attention: { label: 'Attention required', dot: 'bg-amber-500', text: 'text-amber-700' },
  checking: { label: 'Checking…', dot: 'bg-sky-400 animate-pulse', text: 'text-sky-700' },
  unknown: { label: 'Not checked', dot: 'bg-gray-300', text: 'text-gray-500' },
}

interface QuickSummaryProps {
  totalItems: number
  totalQty: number
  verdict: StockVerdict
  status: string
  statusTone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  /** Highlights the short lines when the verdict is not "sufficient". */
  onShowAttention: () => void
}

/**
 * The figures a dispatch clerk checks before posting.
 *
 * Quantities and line counts only. There is no value, no tax and no total on a
 * delivery challan in Inventory: the goods are still the company's until the
 * invoice settles them, and the commercial figures belong to that Books
 * voucher, not to this document.
 */
export function QuickSummary({ totalItems, totalQty, verdict, status, statusTone, onShowAttention }: QuickSummaryProps) {
  const v = VERDICT[verdict]
  return (
    <section aria-label="Quick summary" className="flex h-full flex-col rounded-xl border border-emerald-100 bg-emerald-50 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
        Quick summary
      </h3>
      <dl className="space-y-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-gray-600">Total items</dt>
          <dd className="font-semibold tabular-nums text-gray-900">{totalItems}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-gray-600">Total quantity</dt>
          <dd className="font-semibold tabular-nums text-gray-900">{formatQty(totalQty, '0')}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-gray-600">Stock availability</dt>
          <dd>
            {verdict === 'attention' ? (
              <button type="button" onClick={onShowAttention} className={cx('inline-flex items-center gap-1.5 rounded px-1 font-semibold hover:underline', v.text)}>
                <span className={cx('h-2 w-2 rounded-full', v.dot)} aria-hidden />
                {v.label}
              </button>
            ) : (
              <span className={cx('inline-flex items-center gap-1.5 font-semibold', v.text)}>
                <span className={cx('h-2 w-2 rounded-full', v.dot)} aria-hidden />
                {v.label}
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-gray-600">Status</dt>
          <dd>
            <Badge tone={statusTone === 'neutral' ? 'neutral' : statusTone} size="xs">
              {status}
            </Badge>
          </dd>
        </div>
      </dl>
      <p className="mt-auto pt-2 text-[10px] leading-snug text-gray-400">
        Quantities only. A challan carries no value, tax or invoice total — those are the Books voucher's.
      </p>
    </section>
  )
}
