import { AlertTriangle, CheckCircle2, CircleX, RefreshCw, Sparkles } from 'lucide-react'
import type { InsightLevel, ItemInsight, ItemInsightsResult } from '../../services/inventoryAiService'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import { AsideCard } from './ItemWorkspaceKit'
import { ITEM_SECTIONS, sectionDomId } from './itemSections'

/**
 * What this item's configuration says about itself.
 *
 * Two things this card is careful about.
 *
 * **It never claims to be a model.** Every result carries where it came from, and while the checks
 * are the deterministic rules in `inventoryAiService`, the footer says so in as many words. A
 * business rule wearing an AI badge is a claim the product cannot support, and the one place it
 * would matter most — tax classification — is the one place the rules refuse to have an opinion.
 *
 * **It never blocks a save.** `validateItemForm` decides what may be written; these are remarks
 * beside the work. A critical insight is loud, and it is still only a remark.
 */
const LEVEL: Record<InsightLevel, { icon: typeof CheckCircle2; dot: string; text: string }> = {
  ok: { icon: CheckCircle2, dot: 'bg-emerald-100 text-emerald-700', text: 'text-gray-600' },
  warn: { icon: AlertTriangle, dot: 'bg-amber-100 text-amber-700', text: 'text-gray-700' },
  critical: { icon: CircleX, dot: 'bg-red-100 text-red-700', text: 'text-gray-900' },
}

const SUMMARY: Record<InsightLevel, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-200 bg-red-50 text-red-800',
}

function InsightRow({ insight, onJump }: { insight: ItemInsight; onJump: (section: string) => void }) {
  const tone = LEVEL[insight.level]
  const Icon = tone.icon
  const section = insight.section ? ITEM_SECTIONS.find((s) => s.id === insight.section) : undefined
  return (
    <li className="flex items-start gap-2">
      <span className={cx('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full', tone.dot)}>
        <Icon className="h-2.5 w-2.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {/* The level is in the text, not only in the colour: "Critical:" before a message a
            reader must not be able to miss because their screen or their eyes render red as grey. */}
        <p className={cx('text-[11px] leading-relaxed', tone.text)}>
          {insight.level === 'critical' ? <span className="font-bold">Critical: </span> : null}
          {insight.message}
        </p>
        {insight.detail ? <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{insight.detail}</p> : null}
        {section && insight.level !== 'ok' ? (
          <button
            type="button"
            onClick={() => onJump(sectionDomId(section.id))}
            className="mt-0.5 text-[10px] font-semibold text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          >
            Go to {section.label}
          </button>
        ) : null}
      </div>
    </li>
  )
}

export interface ItemAiInsightsCardProps {
  result: ItemInsightsResult | null
  loading: boolean
  onRefresh: () => void
  onJump: (domId: string) => void
}

export function ItemAiInsightsCard({ result, loading, onRefresh, onJump }: ItemAiInsightsCardProps) {
  return (
    <AsideCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-600" aria-hidden />
          AI Insights
          <span className="rounded bg-violet-50 px-1 py-0.5 text-[9px] font-extrabold tracking-wide text-violet-700">
            BETA
          </span>
        </span>
      }
      action={
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-gray-500 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        >
          <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden />
          Refresh
        </button>
      }
    >
      {loading && !result ? (
        <div className={cx(AIC, 'space-y-2')}>
          <Skeleton height="h-16" rounded="lg" />
          <Skeleton height="h-3" />
          <Skeleton height="h-3" />
          <Skeleton height="h-3" />
        </div>
      ) : result ? (
        <>
          <div
            className={cx(AIC, 'rounded-xl border p-3', SUMMARY[result.status])}
            role="status"
            aria-live="polite"
          >
            <p className="text-sm font-bold">{result.headline}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed">{result.summary}</p>
          </div>

          <ul className="mt-3 space-y-2">
            {result.insights.map((insight) => (
              <InsightRow key={insight.id} insight={insight} onJump={onJump} />
            ))}
          </ul>

          <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
            {result.source === 'rules'
              ? 'These are deterministic configuration checks run in your browser, not a model’s opinion. Tax classification is never one of them — Books decides that.'
              : 'Generated by the Inventory insights service. Tax classification remains Books’.'}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-gray-500">No insights available.</p>
      )}
    </AsideCard>
  )
}

export default ItemAiInsightsCard
