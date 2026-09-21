import { ArrowRight, Boxes, Layers, Warehouse } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'
import { formatInt, formatMoney } from '../../utils/format'
import type { LandedCostSummary } from './model'

interface ImpactSummaryProps {
  summary: LandedCostSummary
  currency: string
}

function Figure({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'add' | 'result' }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span
        className={cx(
          'block truncate tabular-nums font-semibold',
          tone === 'result' ? 'text-xl text-emerald-700' : tone === 'add' ? 'text-base text-primary' : 'text-base text-gray-900',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * The one line of arithmetic the whole screen exists to produce:
 *
 *     what the stock is worth now  +  what this bill adds  =  what it will be worth
 *
 * Said before posting, in that order, because an operator who can read it in three seconds is an
 * operator who will notice a decimal point in the wrong place. The "+ x%" beside the result is the
 * figure that makes an unreasonable allocation obvious without anyone having to divide.
 */
export function ImpactSummary({ summary, currency }: ImpactSummaryProps) {
  return (
    <section
      aria-label="Valuation impact"
      className={cx(
        AIC,
        'rounded-xl border border-primary/25 bg-gradient-to-br from-primary-light/50 to-transparent p-4 shadow-card',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Figure label="Current stock value" value={`${currency} ${formatMoney(summary.currentValue)}`} />
        <span className="text-lg font-semibold text-gray-400" aria-hidden>
          +
        </span>
        <Figure label="Additional landed cost" value={`${currency} ${formatMoney(summary.allocated)}`} tone="add" />
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wide text-gray-500">Revised stock value</span>
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="truncate text-xl font-semibold tabular-nums text-emerald-700">{currency} {formatMoney(summary.revisedValue)}</span>
            {summary.landedCostPercent !== null && summary.landedCost > 0 ? (
              <span className="text-xs font-bold tabular-nums text-emerald-700">+{summary.landedCostPercent.toFixed(2)}%</span>
            ) : null}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            {formatInt(summary.receipts)} receipt{summary.receipts === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Boxes className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            {formatInt(summary.itemLines)} item line{summary.itemLines === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Warehouse className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            {formatInt(summary.warehouses)} warehouse{summary.warehouses === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <p className="mt-3 border-t border-primary/15 pt-2.5 text-[11px] leading-relaxed text-gray-600">
        The revised value assumes all of the charge lands. Stock already issued out of a receipt is not re-costed — only what is still on
        hand absorbs a charge, and posting reports the part it could not absorb for you to expense.
      </p>
    </section>
  )
}
