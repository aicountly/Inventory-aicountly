import { ArrowDownToLine, ArrowUpFromLine, Layers, ShieldCheck } from 'lucide-react'
import { Card } from '../../ui/Card'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { JournalTotals } from './model'

interface StockJournalDocumentSummaryProps {
  totals: JournalTotals
  /** Symbol from the company's base currency — never assumed. */
  currency: string
  showValues: boolean
}

const TONES = {
  neutral: 'bg-gray-100 text-gray-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  blue: 'bg-sky-50 text-sky-600',
} as const

function Metric({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: typeof Layers
  tone: keyof typeof TONES
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TONES[tone])}>
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <span className="block text-[11px] text-gray-500">{label}</span>
        <strong className="block text-base font-bold tabular-nums text-gray-900">{value}</strong>
        {sub ? <span className="block text-[10px] tabular-nums text-gray-400">{sub}</span> : null}
      </div>
    </div>
  )
}

/** The four figures, and the promise that whatever is posted stays on the record. */
export function StockJournalDocumentSummary({ totals, currency, showValues }: StockJournalDocumentSummaryProps) {
  const money = (n: number) => `${currency} ${formatQty(n, '0')}`
  return (
    <Card padding="lg">
      <h3 className="text-sm font-semibold text-gray-900">Document Summary</h3>
      <div className={cx(AIC, 'mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(9rem,1fr))_minmax(18rem,1.2fr)]')}>
        <Metric icon={Layers} tone="neutral" label="Total Lines" value={String(totals.lines)} />
        <Metric
          icon={ArrowDownToLine}
          tone="green"
          label="Total Inward"
          value={formatQty(totals.qtyIn, '0')}
          sub={showValues && totals.valueIn > 0 ? money(totals.valueIn) : undefined}
        />
        <Metric
          icon={ArrowUpFromLine}
          tone="red"
          label="Total Outward"
          value={formatQty(totals.qtyOut, '0')}
          sub={showValues && totals.valueOut > 0 ? money(totals.valueOut) : undefined}
        />
        <Metric
          icon={Layers}
          tone="blue"
          label="Net Movement"
          value={formatQty(totals.netQty, '0')}
          sub={showValues && totals.netValue !== 0 ? money(totals.netValue) : undefined}
        />

        <div className="flex items-center gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-3 sm:col-span-2 xl:col-span-1">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <strong className="block text-xs font-semibold text-gray-900">
              All changes are tracked with full audit trail
            </strong>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              Maintain complete visibility and control over your inventory movements.
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}
