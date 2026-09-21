import { TrendingUp } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Skeleton } from '../../ui/Skeleton'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import type { LandedCostSummary } from './model'

interface ReceiptSummaryProps {
  summary: LandedCostSummary
  currency: string
  loading: boolean
}

function Metric({ label, value, tooltip, strong = false }: { label: string; value: string; tooltip?: string; strong?: boolean }) {
  const labelNode = tooltip ? (
    <Tooltip label={tooltip}>
      <dt className="cursor-help text-[10px] text-gray-500 underline decoration-dotted underline-offset-2" tabIndex={0}>
        {label}
      </dt>
    </Tooltip>
  ) : (
    <dt className="text-[10px] text-gray-500">{label}</dt>
  )
  return (
    <div className={cx('flex items-center justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0', strong && 'text-emerald-700')}>
      {labelNode}
      <dd className={cx('m-0 tabular-nums text-right text-[11px] font-bold', strong ? 'text-emerald-700' : 'text-gray-900')}>{value}</dd>
    </div>
  )
}

/** What the selected receipts hold now, and what they will hold if all of the bill lands. */
export function ReceiptSummary({ summary, currency, loading }: ReceiptSummaryProps) {
  return (
    <Card padding="sm" className={AIC}>
      <div className="mb-1 flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">Receipt summary</h3>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        {summary.receipts === 0
          ? 'No receipt selected'
          : `${summary.receipts} receipt${summary.receipts === 1 ? '' : 's'} · ${summary.itemLines} item line${summary.itemLines === 1 ? '' : 's'}`}
      </p>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height="h-6" />
          ))}
        </div>
      ) : (
        <dl className="m-0">
          <Metric label="Total quantity" value={formatQty(summary.quantity, '0')} />
          <Metric
            label="Total invoice value"
            value={summary.invoiceValue === null ? '—' : `${currency} ${formatMoney(summary.invoiceValue)}`}
            tooltip="What the source voucher billed for these lines. It is a commercial figure Books owns, shown for reference — a landed cost never changes it."
          />
          <Metric
            label="Current stock value"
            value={`${currency} ${formatMoney(summary.currentValue)}`}
            tooltip="What these receipt lines are valued at in stock today, before this allocation."
          />
          <Metric
            label="Estimated revised value"
            value={`${currency} ${formatMoney(summary.revisedValue)}`}
            tooltip="Current stock value plus the charges, if all of them land. Stock already issued out of a receipt is not re-costed, so posting may absorb less and will say by how much."
            strong
          />
          {summary.landedCostPercent !== null && summary.landedCost > 0 ? (
            <Metric label="Landed cost" value={`+${summary.landedCostPercent.toFixed(2)}%`} strong />
          ) : null}
        </dl>
      )}

      <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-900">
        These costs become part of stock value, so future COGS carries them. The purchase invoice value and every GST figure are untouched —
        those belong to the purchase, in Books.
      </p>
    </Card>
  )
}
