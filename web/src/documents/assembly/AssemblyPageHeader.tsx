import { Blocks, Sparkles, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { BreadcrumbBar } from '../../ui/shell/BreadcrumbBar'
import type { Crumb } from '../../ui/shell/BreadcrumbBar'
import { Button } from '../../ui/Button'
import { IconTile } from '../../ui/IconTile'
import { AIC, cx } from '../../ui/cx'
import type { AssemblyInsight } from './assemblyInsights'

const TONE_DOT: Record<AssemblyInsight['tone'], string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-violet-500',
}

const TONE_TEXT: Record<AssemblyInsight['tone'], string> = {
  critical: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-violet-700',
}

export interface AssemblyPageHeaderProps {
  breadcrumbs: readonly Crumb[]
  title: ReactNode
  description: ReactNode
  badge?: ReactNode
  /** Derived, never generated — see assemblyInsights.ts. */
  insights: readonly AssemblyInsight[]
  onInsightAction: (insight: AssemblyInsight) => void
  onImportBom: () => void
  importDisabled?: boolean
}

/**
 * The screen's masthead: what this document is, and the one panel that can start it for you.
 *
 * The assistant is a WORKFLOW launcher. Its button opens the bill-of-materials import — a real
 * endpoint with a real answer — and the lines under it are facts the form already holds, said in
 * a sentence. There is no model call behind it, and nothing on it writes to the document without
 * the user pressing the thing that says it will.
 */
export function AssemblyPageHeader({
  breadcrumbs,
  title,
  description,
  badge,
  insights,
  onInsightAction,
  onImportBom,
  importDisabled = false,
}: AssemblyPageHeaderProps) {
  const top = insights.slice(0, 2)
  return (
    <div className={cx(AIC, 'space-y-2')}>
      <BreadcrumbBar items={breadcrumbs} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={Blocks} tone="violet" size="lg" className="mt-0.5" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-gray-900 md:text-xl">{title}</h1>
              {badge}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 print:hidden lg:w-auto lg:flex-row lg:items-stretch">
          <section
            aria-label="Assembly assistant"
            className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 lg:min-w-[22rem]"
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-violet-700">AI Assistant</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-600">
                  Smart suggestions, stock checks and cost insights from this document.
                </p>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={onImportBom}
                disabled={importDisabled}
                className="shrink-0"
              >
                Generate from BOM
              </Button>
            </div>
            {top.length > 0 ? (
              <ul className="space-y-1 border-t border-violet-200 pt-1.5" aria-live="polite">
                {top.map((insight) => (
                  <li key={insight.kind} className="flex items-start gap-2 text-[11px] leading-snug">
                    <span
                      className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[insight.tone])}
                      aria-hidden
                    />
                    <span className={cx('min-w-0 flex-1', TONE_TEXT[insight.tone])}>{insight.message}</span>
                    {insight.actionLabel ? (
                      <button
                        type="button"
                        onClick={() => onInsightAction(insight)}
                        className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {insight.actionLabel}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <aside className="hidden shrink-0 flex-col justify-center rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2.5 xl:flex xl:w-44">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              Build smarter
            </span>
            <span className="mt-1 text-[11px] leading-snug text-emerald-700">
              Import a BOM or repeat a previous assembly instead of retyping it.
            </span>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default AssemblyPageHeader
