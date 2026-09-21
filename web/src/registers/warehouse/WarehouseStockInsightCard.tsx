import { Link } from 'react-router-dom'
import { ChevronRight, Sparkles } from 'lucide-react'
import { cx } from '../../ui/cx'
import { AIC } from '../../ui/cx'
import type { WarehouseStockInsight } from './warehouseStockInsights'

const TONE_TEXT: Record<WarehouseStockInsight['tone'], string> = {
  danger: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-gray-800',
  success: 'text-emerald-700',
}

/**
 * The written observation, as the sixth tile of the KPI strip.
 *
 * Styled as the product's intelligence surface and labelled "Insight" rather than
 * anything that claims a model wrote it: the sentence comes from the ordered rules in
 * warehouseStockInsights.ts, over the server's own figures for the whole filtered set.
 * The footnote says so, because a card that looked generated and was not would be the
 * one element on the screen a reader could not check.
 *
 * When there is something to look at, the whole card is the link to it — the rows the
 * sentence is about, under the filter that isolates them.
 */
export function WarehouseStockInsightCard({
  insight,
  to,
}: {
  insight: WarehouseStockInsight | null
  to?: string
}) {
  if (!insight) return null

  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Insight
        {to ? (
          <ChevronRight className="ml-auto h-4 w-4 text-primary/70" aria-hidden />
        ) : null}
      </span>
      <p className={cx('mt-2 text-[12.5px] font-semibold leading-snug', TONE_TEXT[insight.tone])}>
        {insight.headline}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-gray-500">{insight.detail}</p>
      <p className="mt-auto pt-2 text-[10px] text-gray-400">
        From your stock on this date — no estimates
      </p>
    </>
  )

  const className = cx(
    AIC,
    'flex min-h-[92px] flex-col rounded-xl border border-primary/20 bg-primary-light/50 p-3 shadow-card print:hidden',
    to && 'transition-colors hover:border-primary/40 hover:bg-primary-light/70 no-underline',
  )

  if (to) {
    return (
      <Link to={to} className={className} aria-label={`${insight.headline} ${insight.detail}`}>
        {body}
      </Link>
    )
  }
  return <article className={className}>{body}</article>
}

export default WarehouseStockInsightCard
