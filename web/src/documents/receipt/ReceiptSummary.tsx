import { Calculator, Info } from 'lucide-react'
import { Card } from '../../ui/Card'
import { Tooltip } from '../../ui/Tooltip'
import { formatMoney, formatQty } from '../../utils/format'
import type { ReceiptTotals } from './receiptModel'

export interface ReceiptSummaryProps {
  totals: ReceiptTotals
  currency: string
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-600 inline-flex items-center gap-1">
        {label}
        {hint ? (
          <Tooltip label={hint}>
            <span className="inline-grid place-items-center text-gray-400" tabIndex={0} role="button" aria-label={`${label}: more information`}>
              <Info className="w-3.5 h-3.5" aria-hidden />
            </span>
          </Tooltip>
        ) : null}
      </span>
      <span className="font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  )
}

/**
 * What this receipt adds to stock, in units and in money.
 *
 * "Other charges" is always zero and says why: freight and duty reach stock
 * through a Landed Cost Allocation raised against the posted receipt, which is
 * the document that can spread one carrier's bill across several receipts and
 * tell Books what was capitalised. A box here would collect money that posting
 * then ignores.
 */
export function ReceiptSummary({ totals, currency }: ReceiptSummaryProps) {
  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-lg bg-white/70 grid place-items-center shrink-0">
          <Calculator className="w-4 h-4 text-emerald-700" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-gray-900">Receipt summary</h3>
      </div>
      <div className="space-y-2">
        <Row label="Lines" value={String(totals.lines)} />
        <Row label="Total quantity" value={formatQty(totals.quantity, '0')} hint="Entered quantities added up. Lines may be in different units." />
        <Row label={`Total amount (${currency})`} value={formatMoney(totals.amount, '0.00')} />
        <Row
          label={`Other charges (${currency})`}
          value={formatMoney(totals.otherCharges, '0.00')}
          hint="Freight, duty and other landing costs are capitalised with a Landed Cost Allocation against this receipt once it is posted."
        />
        <div className="flex items-center justify-between gap-4 rounded-lg bg-white/80 px-3 py-2.5 mt-1">
          <span className="text-sm font-semibold text-emerald-800">Net amount</span>
          <span className="text-base font-bold text-emerald-800 tabular-nums">
            {currency} {formatMoney(totals.net, '0.00')}
          </span>
        </div>
      </div>
    </Card>
  )
}

export default ReceiptSummary
