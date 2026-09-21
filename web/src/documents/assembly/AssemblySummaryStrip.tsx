import { BarChart3, Calculator, Layers, PackageCheck, Sparkles } from 'lucide-react'
import { StatCard } from '../../ui/StatCard'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { AssemblyCostSummary } from './assemblyModel'

export interface PostAssemblyStock {
  /** On hand at the output warehouse before this document posts. */
  onHand: number
  warehouseName: string
}

export interface AssemblySummaryStripProps {
  cost: AssemblyCostSummary
  costHidden: boolean
  /** Writes an amount in the company's own currency — see AssemblyPage. */
  formatAmount: (value: number) => string
  outputQty: number
  outputUnit: string
  /** Null while unknown — the strip says so rather than inventing a figure. */
  postStock: PostAssemblyStock | null
  postStockLoading: boolean
}

/**
 * The four figures a reader checks before posting, and one line about doing this faster.
 *
 * Cost cards are absent, not blanked, for a profile that may not see inventory cost: the columns
 * they summarise are not on screen either, and a dash in a KPI reads as "zero" to everyone who
 * does not know why it is there.
 */
export function AssemblySummaryStrip({
  cost,
  costHidden,
  formatAmount,
  outputQty,
  outputUnit,
  postStock,
  postStockLoading,
}: AssemblySummaryStripProps) {
  return (
    <div
      className={cx(
        AIC,
        'grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 print:hidden',
      )}
    >
      {!costHidden ? (
        <StatCard
          layout="metric"
          label="Components cost"
          value={formatAmount(cost.componentCost)}
          hint={
            cost.partial
              ? `${cost.pricedLines} of ${cost.pricedLines + cost.unpricedLines} components priced`
              : `${cost.pricedLines} component${cost.pricedLines === 1 ? '' : 's'} valued`
          }
          icon={Layers}
          tone="violet"
        />
      ) : null}

      <StatCard
        layout="metric"
        label="Output quantity"
        value={`${formatQty(outputQty)} ${outputUnit}`.trim()}
        hint={cost.outputBaseQty > 0 && cost.outputBaseQty !== outputQty ? `${formatQty(cost.outputBaseQty)} base units` : 'Assembled into stock'}
        icon={PackageCheck}
        tone="info"
      />

      {!costHidden ? (
        <StatCard
          layout="metric"
          label="Estimated unit cost"
          value={cost.estimatedUnitCost === null ? '—' : formatAmount(cost.estimatedUnitCost)}
          hint={cost.estimatedUnitCost === null ? 'Enter an output quantity' : 'Per base unit, before posting'}
          icon={Calculator}
          tone="teal"
        />
      ) : null}

      <StatCard
        layout="metric"
        label="Post-assembly stock"
        value={
          postStockLoading
            ? '…'
            : postStock
              ? `${formatQty(postStock.onHand + outputQty)} ${outputUnit}`.trim()
              : '—'
        }
        hint={
          postStock
            ? `${formatQty(postStock.onHand)} on hand now in ${postStock.warehouseName}`
            : postStockLoading
              ? 'Reading current stock…'
              : 'Pick an item and a warehouse'
        }
        icon={BarChart3}
        tone="primary"
      />

      <aside className="flex flex-col justify-center rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-3 sm:col-span-2 xl:col-span-3 2xl:col-span-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Fewer keystrokes, fewer mistakes
        </span>
        <span className="mt-1 text-[11px] leading-snug text-emerald-700">
          Import a bill of materials or copy a previous assembly instead of retyping the component list.
        </span>
      </aside>
    </div>
  )
}

export default AssemblySummaryStrip
