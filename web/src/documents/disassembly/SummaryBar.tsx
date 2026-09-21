import { ArrowDown, ArrowUp, Info } from 'lucide-react'
import { formatCurrency, formatQty } from '../../utils/format'
import type { DisassemblyCounts } from './model'

export interface SummaryBarProps {
  counts: DisassemblyCounts
  text: string
  estimatedValue: number
  currencyCode: string | null
}

/**
 * The strip under the lines.
 *
 * Its sentence is generated from the rows that are actually on screen (`summaryText`), which is
 * the whole point: the screen this replaces printed "0 components will be produced" above four
 * component rows, because it counted a different list from the one it rendered.
 */
export function SummaryBar({ counts, text, estimatedValue, currencyCode }: SummaryBarProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-[12px] text-sky-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2">
        <Info className="mt-px h-4 w-4 shrink-0 text-sky-600" aria-hidden />
        <span>{text}</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <ArrowDown className="h-3.5 w-3.5 text-red-600" aria-hidden />
          <span className="text-sky-700">Out</span>
          <strong className="tabular-nums">{formatQty(counts.qtyOut, '0')}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          <span className="text-sky-700">In</span>
          <strong className="tabular-nums">{formatQty(counts.qtyIn, '0')}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-sky-700">Estimated value</span>
          <strong className="tabular-nums">{formatCurrency(estimatedValue, currencyCode ?? undefined)}</strong>
        </span>
      </div>
    </div>
  )
}
