import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import type { InsightSeverity, ValuationInsight } from '../costLayerModel'

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
}

const SEVERITY_WORD: Record<InsightSeverity, string> = {
  critical: 'Act now',
  warning: 'Review',
  info: 'For information',
}

export interface ValuationAiInsightProps {
  insights: ValuationInsight[]
  loading: boolean
  onOpenAnalysis: () => void
  itemSelected: boolean
}

/**
 * What the layers appear to be saying.
 *
 * Every line here is arithmetic over the rows in the grid below — a receipt
 * against the running average, a remainder below zero, a gap between two
 * warehouses — and each one names the figures it was computed from so a reader
 * can check it against the table instead of trusting it. There is no model
 * behind this and no endpoint: `costLayerModel.buildInsights` is a pure
 * function, and the card says as much.
 *
 * It is advisory in the strict sense. Nothing on this card writes: it cannot
 * change a cost, a method, a batch or a layer, and the action every finding
 * suggests is something a person does, in a screen that asks them to confirm
 * it. An insight panel that quietly corrected valuation would be the most
 * dangerous control in the product.
 */
export function ValuationAiInsight({
  insights,
  loading,
  onOpenAnalysis,
  itemSelected,
}: ValuationAiInsightProps) {
  const top = insights[0]

  return (
    <section
      aria-label="Valuation insight"
      /*
       * Both stops are the primary token. A hardcoded white stop would have
       * set `--tw-gradient-to` to a literal, and nothing in the dark-mode
       * retrofit layer can reach a gradient stop — the card would have stayed
       * pale on a black page while every surface around it turned.
       */
      className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary-light/70 to-primary-light/20 p-3"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <h2 className="text-[12px] font-semibold text-primary">Valuation insight</h2>
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <Skeleton height="h-3" className="w-full" />
          <Skeleton height="h-3" className="w-4/5" />
        </div>
      ) : !itemSelected ? (
        <p className="text-[11px] leading-relaxed text-gray-600">
          Pick an item and this reads its layers for unusual cost movement, negative balances,
          ageing stock and warehouse cost gaps.
        </p>
      ) : !top ? (
        <p className="inline-flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          Nothing unusual in this item&rsquo;s layers — costs are consistent, no balance is
          negative and nothing has been sitting untouched.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-900">
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[top.severity])} aria-hidden />
            {top.title}
            <span className="sr-only"> — {SEVERITY_WORD[top.severity]}</span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{top.detail}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            <span className="font-semibold text-gray-700">Suggested:</span> {top.action}
          </p>
        </>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenAnalysis}
          disabled={!itemSelected}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary/30 bg-white px-2.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          View detailed analysis
          <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
        {insights.length > 1 ? (
          <span className="text-[10px] text-gray-500">
            +{insights.length - 1} more finding{insights.length - 1 === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        Computed in this browser from the layers below. Advisory only — nothing here changes a
        cost, a method or a layer.
      </p>
    </section>
  )
}

export default ValuationAiInsight
