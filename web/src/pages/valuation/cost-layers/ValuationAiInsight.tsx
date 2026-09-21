import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import type { ValuationInsight } from './costLayersModel'

const TONE_TEXT: Record<ValuationInsight['tone'], string> = {
  critical: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-sky-700',
}

export interface ValuationAiInsightProps {
  insight: ValuationInsight | null
  loading?: boolean
  /** How many layers the reading was taken over — the caveat, not decoration. */
  scannedCount: number
  onOpenDetail?: () => void
  /** Hidden until an item is chosen: there is nothing to read without one. */
  hasItem: boolean
}

/**
 * The one thing about this item's layers most worth saying.
 *
 * What it is: arithmetic, run in this browser, over the layers the table has
 * already loaded — a cost move against the earlier receipts, a negative
 * balance, a layer nobody has issued against. What it is not: a model, a
 * forecast, or anything that touches the valuation. Every action it suggests
 * is a document or a recalculation a person has to run and approve, which is
 * why the card only ever ends in a link.
 *
 * When the figures show nothing unusual it says exactly that. An insight panel
 * that must produce an observation every time is a panel that will invent one.
 */
export function ValuationAiInsight({
  insight,
  loading = false,
  scannedCount,
  onOpenDetail,
  hasItem,
}: ValuationAiInsightProps) {
  return (
    <section
      aria-label="Valuation insight"
      // A flat accent wash rather than a gradient. Gradient stops set custom
      // properties that the dark-mode retrofit sheet cannot reach, so a card
      // built from pale stops stays white-on-black once the theme flips.
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
        <h3 className="text-xs font-semibold text-emerald-800">Valuation insight</h3>
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full" rounded="md" />
          <Skeleton className="h-3 w-5/6" rounded="md" />
          <Skeleton className="h-3 w-2/3" rounded="md" />
        </div>
      ) : !hasItem ? (
        <p className="text-[11px] leading-relaxed text-gray-600">
          Choose an item and this reads its layers for cost moves, negative balances, stale stock and receipts that
          never got linked to a document.
        </p>
      ) : insight ? (
        <>
          <p className={cx('text-[11.5px] font-semibold leading-snug', TONE_TEXT[insight.tone])}>{insight.headline}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{insight.detail}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-700">
            <span className="font-semibold">Suggested check: </span>
            {insight.action}
          </p>
        </>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          <span>
            Nothing stood out in the {scannedCount} layer{scannedCount === 1 ? '' : 's'} read — costs are consistent,
            balances are positive and every receipt traces to a document.
          </span>
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {onOpenDetail ? (
          <button
            type="button"
            onClick={onOpenDetail}
            className="aic inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-white px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-light focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            View detailed analysis
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        ) : (
          <span />
        )}
      </div>

      {hasItem && !loading ? (
        <p className="mt-2 border-t border-emerald-100 pt-1.5 text-[10px] leading-relaxed text-gray-500">
          Worked out on this device from the {scannedCount} layer{scannedCount === 1 ? '' : 's'} currently loaded.
          Advisory only — it changes no cost, no method and no layer.
        </p>
      ) : null}
    </section>
  )
}

export default ValuationAiInsight
