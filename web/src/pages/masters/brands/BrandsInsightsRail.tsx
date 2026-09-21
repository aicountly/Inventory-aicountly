import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Lightbulb,
  Send,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SkeletonRows } from '../../../ui/Skeleton'
import { AIC, cx } from '../../../ui/cx'
import type { BrandInsight, BrandInsightTone } from './brandInsights'

/**
 * The contextual column: things you can ask of this list, and things the data
 * already says.
 *
 * Two rules govern everything in here.
 *
 * 1. The suggestions are not answers, they are VIEWS. Pressing one changes the
 *    filters on the list to the left and the reader watches the rows change.
 *    Nothing in this panel writes a sentence about your business that you
 *    cannot then see the rows behind.
 *
 * 2. Free-text answering needs a service this deployment does not have, and the
 *    panel says so in those words. It does not pretend to think, and it does
 *    not quietly answer something narrower than what was asked. When an
 *    assistant endpoint exists, the box below is where it wires in — and the
 *    honest notice is what it replaces.
 *
 * The insights are built by `brandInsights.ts` from figures the API counted.
 * None of them is composed here, so none of them can drift into a claim the
 * data does not support.
 */

const DISMISS_KEY = 'inventory.brands.assistant.dismissed'

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Private mode or blocked storage: it still stays shut for this page view.
  }
}

export interface BrandAssistantSuggestion {
  key: string
  label: string
  /** Applies a real view of the list. Never returns prose. */
  onSelect: () => void
}

const TONE_STYLE: Record<BrandInsightTone, { icon: LucideIcon; className: string }> = {
  positive: { icon: TrendingUp, className: 'bg-primary-light text-primary' },
  warning: { icon: TriangleAlert, className: 'bg-amber-50 text-amber-600' },
  negative: { icon: TrendingDown, className: 'bg-red-50 text-red-600' },
  neutral: { icon: Star, className: 'bg-slate-100 text-slate-600' },
}

function RailCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cx(AIC, 'overflow-hidden rounded-xl border border-gray-200 bg-white', className)}>
      {children}
    </section>
  )
}

function InsightRow({ insight }: { insight: BrandInsight }) {
  const tone = TONE_STYLE[insight.tone]
  const Icon = tone.icon
  const body = (
    <>
      <span className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone.className)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-snug text-gray-900">{insight.title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{insight.description}</span>
      </span>
    </>
  )

  if (!insight.to) {
    return <div className="flex items-start gap-2.5 px-1.5 py-2">{body}</div>
  }
  return (
    <Link
      to={insight.to}
      className="flex items-start gap-2.5 rounded-lg px-1.5 py-2 no-underline transition-colors hover:bg-primary-light/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {body}
    </Link>
  )
}

export interface BrandsInsightsRailProps {
  suggestions: readonly BrandAssistantSuggestion[]
  insights: readonly BrandInsight[]
  loading: boolean
  /** Worded by the caller from the live analytics adapter; '' when all is well. */
  analyticsNote?: string
  className?: string
}

export function BrandsInsightsRail({
  suggestions,
  insights,
  loading,
  analyticsNote = '',
  className,
}: BrandsInsightsRailProps) {
  const [dismissed, setDismissed] = useState(readDismissed)

  return (
    <aside
      className={cx('grid content-start gap-3 sm:grid-cols-2 wide:grid-cols-1', className)}
      aria-label="Brand insights"
    >
      {dismissed ? null : (
        <RailCard className="bg-gradient-to-br from-violet-50/70 to-transparent">
          <header className="flex items-start justify-between gap-2 border-b border-violet-100 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-card">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <strong className="block truncate text-sm font-semibold text-gray-900">Aicountly AI</strong>
                <span className="block truncate text-[11px] text-gray-500">Your inventory assistant</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                writeDismissed()
                setDismissed(true)
              }}
              aria-label="Hide the assistant panel"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/80 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="space-y-1.5 px-3 py-3">
            <p className="px-1 text-[11px] font-semibold text-gray-600">Try asking me:</p>
            {suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={s.onSelect}
                className="block w-full rounded-lg border border-violet-100 bg-white/70 px-2.5 py-2 text-left text-[11px] leading-snug text-gray-700 transition-colors hover:border-violet-300 hover:bg-violet-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
              >
                {s.label}
              </button>
            ))}
            <p className="px-1 pt-1 text-[10px] leading-relaxed text-gray-400">
              Each one filters the list beside you — the rows are the answer.
            </p>
          </div>

          <div className="px-3 pb-3">
            <div className="flex items-center gap-1.5 rounded-xl border border-violet-100 bg-white px-2.5 py-1.5 opacity-70">
              <input
                type="text"
                disabled
                placeholder="Ask anything…"
                aria-label="Ask the assistant a question"
                title="Free-text answers need the assistant service"
                className="min-w-0 flex-1 border-0 bg-transparent text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed"
              />
              <span
                aria-hidden
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"
              >
                <Send className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
              Free-text questions will be answered here once the Aicountly assistant service is
              connected to this company.
            </p>
          </div>
        </RailCard>
      )}

      <RailCard className="p-4">
        <header className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Lightbulb className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-gray-900">Quick insights</h2>
        </header>

        {loading ? (
          <SkeletonRows rows={3} />
        ) : insights.length === 0 ? (
          <p className="px-1 py-2 text-[11px] leading-relaxed text-gray-500">
            There is nothing to report yet. Insights appear here as soon as this company has brands
            to describe.
          </p>
        ) : (
          <div className="-mx-1.5 divide-y divide-gray-100">
            {insights.map((insight) => (
              <InsightRow key={insight.id} insight={insight} />
            ))}
          </div>
        )}

        {analyticsNote ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2 text-[10px] leading-relaxed text-gray-500">
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {analyticsNote}
          </p>
        ) : null}
      </RailCard>
    </aside>
  )
}

export default BrandsInsightsRail
