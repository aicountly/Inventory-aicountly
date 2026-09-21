import { ArrowRight, CircleCheck, Info, Sparkles, TriangleAlert, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../ui/cx'
import type { Insight, InsightTone } from './insights'

const TONE: Record<InsightTone, { icon: LucideIcon; badge: string; text: string }> = {
  success: { icon: CircleCheck, badge: 'bg-emerald-100 text-emerald-700', text: 'text-gray-700' },
  warning: { icon: TriangleAlert, badge: 'bg-amber-100 text-amber-700', text: 'text-gray-700' },
  danger: { icon: XCircle, badge: 'bg-red-100 text-red-700', text: 'text-gray-800' },
  info: { icon: Info, badge: 'bg-sky-100 text-sky-700', text: 'text-gray-700' },
  action: { icon: ArrowRight, badge: 'bg-violet-100 text-violet-700', text: 'text-gray-700' },
}

interface SmartInsightsProps {
  insights: Insight[]
  /** Highlight the lines an insight points at. */
  onFocusLines: (keys: string[]) => void
  checking: boolean
}

/**
 * The checks that ran over this challan.
 *
 * Deliberately called insights and not "AI": there is no model and no service
 * behind the panel. Every line is a rule in `insights.ts` evaluated against the
 * draft on screen and the live stock, serial and pending answers the page
 * already holds, so nothing here is a prediction and nothing is invented.
 */
export function SmartInsights({ insights, onFocusLines, checking }: SmartInsightsProps) {
  return (
    <section
      aria-label="Smart insights"
      className="flex h-full flex-col rounded-xl border border-violet-200 bg-violet-50 p-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Smart insights
        {checking ? <span className="ml-auto text-[10px] font-normal text-gray-400">checking stock…</span> : null}
      </h3>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-thin" aria-live="polite">
        {insights.map((insight) => {
          const tone = TONE[insight.tone]
          const Icon = tone.icon
          const focusable = (insight.lineKeys?.length ?? 0) > 0
          const body = (
            <>
              <span className={cx('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full', tone.badge)}>
                <Icon className="h-2.5 w-2.5" aria-hidden />
              </span>
              <span className={cx('min-w-0 text-[11px] leading-snug', tone.text)}>{insight.message}</span>
            </>
          )
          return (
            <li key={insight.id}>
              {focusable ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/80"
                  onClick={() => onFocusLines(insight.lineKeys as string[])}
                  title="Highlight the lines this is about"
                >
                  {body}
                </button>
              ) : (
                <span className="flex items-start gap-2 px-1 py-0.5">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 border-t border-violet-200 pt-1.5 text-[10px] leading-snug text-gray-400">
        Rule-based checks on this document and live stock. No predictions, and nothing is read from another Aicountly product.
      </p>
    </section>
  )
}
