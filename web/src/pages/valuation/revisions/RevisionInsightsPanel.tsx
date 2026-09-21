import { Link } from 'react-router-dom'
import { ArrowRight, CircleAlert, GitMerge, Sparkles, TrendingUp, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../../ui/Badge'
import { Card } from '../../../ui/Card'
import { IconTile } from '../../../ui/IconTile'
import type { IconTone } from '../../../ui/IconTile'
import { SkeletonRows } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatMoney } from '../../../utils/format'
import type { RevisionSummary } from '../../../services/valuationApi'
import { buildActions, buildInsights } from './revisionsModel'
import type { RevisionInsight } from './revisionsModel'

export interface RevisionInsightsPanelProps {
  summary: RevisionSummary | null
  loading: boolean
  canRecalculate: boolean
  canReconcile: boolean
}

const KIND_ICON: Record<RevisionInsight['kind'], LucideIcon> = {
  driver: TrendingUp,
  anomaly: CircleAlert,
  contributor: Workflow,
  backlog: GitMerge,
}

const TONE_TILE: Record<RevisionInsight['tone'], IconTone> = {
  neutral: 'slate',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
}

/**
 * What the numbers on this screen add up to.
 *
 * Deliberately NOT branded as generative AI, and deliberately not worded like it. Every block
 * is arithmetic over the aggregates the API returned — a share of the movement, a comparison
 * against a stated baseline, a count of jobs by the trigger the engine recorded — and it says
 * which. The strongest claim available is "possible contributor", because a correlation
 * between a recalculation trigger and a valuation delta is all the data supports, and a
 * costing screen that guessed at causes would have operators chasing them.
 */
export function RevisionInsightsPanel({ summary, loading, canRecalculate, canReconcile }: RevisionInsightsPanelProps) {
  const insights = buildInsights(summary)
  const actions = buildActions(summary, { recalculate: canRecalculate, reconcile: canReconcile })

  return (
    <Card padding="sm" className="xl:sticky xl:top-2 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Revision insights
        </h2>
        <Badge tone="beta" size="xs">
          Beta
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
        Computed from the revisions in view — shares, baselines and the reasons recalculation jobs recorded.
      </p>

      {loading && !summary ? (
        <div className="mt-3">
          <SkeletonRows rows={4} />
        </div>
      ) : insights.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-[11px] text-gray-500">
          Nothing stands out in the revisions matching these filters.
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {insights.map((insight) => {
            const Icon = KIND_ICON[insight.kind]
            return (
              <li key={insight.key} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                <div className="flex gap-2.5">
                  <IconTile icon={Icon} tone={TONE_TILE[insight.tone]} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{insight.label}</p>
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="truncate text-xs font-semibold text-gray-900" title={insight.title}>
                        {insight.title}
                      </span>
                      {insight.amount !== undefined ? (
                        <span
                          className={cx(
                            'text-xs font-semibold tabular-nums',
                            insight.amount > 0 ? 'text-red-600' : insight.amount < 0 ? 'text-emerald-600' : 'text-gray-500',
                          )}
                        >
                          {insight.amount > 0 ? '+' : ''}
                          {formatMoney(insight.amount)}
                        </span>
                      ) : insight.percent !== undefined ? (
                        <span className="text-xs font-semibold tabular-nums text-amber-600">
                          +{insight.percent.toFixed(0)}%
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{insight.detail}</p>
                    {insight.link ? (
                      <Link
                        to={insight.link.to}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary-light px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-light/70"
                      >
                        {insight.link.label}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {actions.length > 0 ? (
        <div className="mt-3 border-t border-gray-200 pt-2.5">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Recommended actions</h3>
          <ol className="space-y-1">
            {actions.map((action, i) => (
              <li key={action.key} className="flex gap-2">
                <span className="mt-0.5 text-[10px] font-semibold tabular-nums text-gray-400">{i + 1}.</span>
                <Link to={action.to} className="text-[11px] leading-relaxed text-gray-700 hover:text-primary hover:underline">
                  {action.label}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  )
}

export default RevisionInsightsPanel
