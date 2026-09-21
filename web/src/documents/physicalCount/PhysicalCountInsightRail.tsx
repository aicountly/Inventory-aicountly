import { useMemo } from 'react'
import {
  ArrowRight,
  Info,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { TrendAreaChart } from '../../dashboard/charts/TrendAreaChart'
import { formatDate, formatInt } from '../../utils/format'
import type { CountInsight, PhysicalCountInsights } from './countInsights'
import type { CountException, CountRow, ExceptionSeverity } from './countModel'
import type { VarianceHistoryPoint } from './physicalCountApi'

/**
 * The right-hand rail: what the sheet is telling you that the grid does not.
 *
 * Every card here is a READING of data already on screen or already fetched —
 * no card invents a figure, and each says where its content came from. The
 * insights card in particular names its source, because "rule checks" and "a
 * model's opinion" are different claims and a stores manager is entitled to
 * know which one is being made.
 */

const TONE_STYLE = {
  danger: { wrap: 'bg-red-50 text-red-600', icon: TriangleAlert },
  warning: { wrap: 'bg-amber-50 text-amber-600', icon: TriangleAlert },
  info: { wrap: 'bg-sky-50 text-sky-600', icon: Info },
  success: { wrap: 'bg-emerald-50 text-emerald-600', icon: Lightbulb },
} as const

const SEVERITY_STYLE: Record<ExceptionSeverity, { wrap: string; icon: typeof ShieldAlert; label: string }> = {
  critical: { wrap: 'bg-red-50 text-red-600', icon: ShieldAlert, label: 'Blocks posting' },
  warning: { wrap: 'bg-amber-50 text-amber-600', icon: TriangleAlert, label: 'Review' },
  info: { wrap: 'bg-sky-50 text-sky-600', icon: Info, label: 'For information' },
}

function InsightRow({ insight, onReveal }: { insight: CountInsight; onReveal?: (insight: CountInsight) => void }) {
  const tone = TONE_STYLE[insight.tone]
  const Icon = tone.icon
  const clickable = Boolean(onReveal) && insight.lineKeys.length > 0
  const body = (
    <>
      <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone.wrap)} aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold leading-snug text-gray-900">{insight.title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{insight.detail}</span>
      </span>
    </>
  )
  if (!clickable) {
    return <div className="flex gap-2 border-b border-gray-100 py-2.5 last:border-b-0">{body}</div>
  }
  return (
    <button
      type="button"
      onClick={() => onReveal?.(insight)}
      title={`Show the ${insight.lineKeys.length} line${insight.lineKeys.length === 1 ? '' : 's'} this is about`}
      className="flex w-full gap-2 border-b border-gray-100 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      {body}
    </button>
  )
}

export interface InsightsCardProps {
  insights: PhysicalCountInsights
  loading: boolean
  error: string | null
  onReveal: (insight: CountInsight) => void
  onOpenAssist: () => void
  onRefresh: () => void
}

export function InsightsCard({ insights, loading, error, onReveal, onOpenAssist, onRefresh }: InsightsCardProps) {
  const fromService = insights.source === 'service'
  return (
    <Card padding="md">
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" aria-hidden />
            Variance insights
          </span>
        }
        action={
          <span className="flex items-center gap-1">
            <Badge tone={fromService ? 'beta' : 'neutral'} size="xs">
              {fromService ? 'Beta' : 'Rule checks'}
            </Badge>
            <Button variant="ghost" size="xs" icon={RefreshCw} aria-label="Re-run variance checks" onClick={onRefresh} />
          </span>
        }
      />

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : insights.summary.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          size="sm"
          title="Nothing to flag yet"
          description="Enter some counted quantities and the variance checks run as you go."
        />
      ) : (
        <div>
          {insights.summary.map((insight) => (
            <InsightRow key={insight.id} insight={insight} onReveal={onReveal} />
          ))}
        </div>
      )}

      {error ? <p className="mt-2 text-[11px] text-amber-700">{error}</p> : null}

      {/* The provenance line is not decoration. A reader deciding whether to
          send a team back into the aisles needs to know whether a machine
          concluded something or whether arithmetic did. */}
      <p className="mt-2 text-[10px] leading-snug text-gray-400">
        {fromService
          ? `From the Inventory insight service${insights.generatedAt ? ` · ${formatDate(insights.generatedAt.slice(0, 10))}` : ''}.`
          : 'Deterministic checks run in your browser over this sheet — not a language model.'}
      </p>

      <Button variant="outline" size="sm" block className="mt-3" iconRight={ArrowRight} onClick={onOpenAssist}>
        Open count assistant
      </Button>
    </Card>
  )
}

export interface ExceptionsCardProps {
  rows: readonly CountRow[]
  extra: readonly CountException[]
  onReveal: (lineKeys: string[], label: string) => void
}

/** Exceptions rolled up by kind, worst first. */
export function ExceptionsCard({ rows, extra, onReveal }: ExceptionsCardProps) {
  const groups = useMemo(() => {
    const all = [...rows.flatMap((r) => r.exceptions), ...extra]
    const byTitleKind = new Map<string, { severity: ExceptionSeverity; kind: string; items: CountException[] }>()
    for (const e of all) {
      const group = byTitleKind.get(e.kind)
      if (group) group.items.push(e)
      else byTitleKind.set(e.kind, { severity: e.severity, kind: e.kind, items: [e] })
    }
    const order: ExceptionSeverity[] = ['critical', 'warning', 'info']
    return [...byTitleKind.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  }, [rows, extra])

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <Card padding="md">
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-gray-500" aria-hidden />
            Serial / batch exceptions
          </span>
        }
        action={
          total > 0 ? (
            <Badge tone={groups[0]?.severity === 'critical' ? 'danger' : 'warning'} size="xs">
              {formatInt(total)}
            </Badge>
          ) : null
        }
      />

      {groups.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-gray-500">
          No serial or batch exceptions on this sheet.
        </p>
      ) : (
        <div>
          {groups.map((group) => {
            const style = SEVERITY_STYLE[group.severity]
            const Icon = style.icon
            const first = group.items[0]
            const lineKeys = [...new Set(group.items.map((e) => e.lineKey))]
            return (
              <button
                key={group.kind}
                type="button"
                onClick={() => onReveal(lineKeys, first.title)}
                className="flex w-full gap-2 border-b border-gray-100 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', style.wrap)} aria-hidden>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold leading-snug text-gray-900">
                    {group.items.length > 1 ? `${group.items.length} × ` : ''}
                    {first.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                    {group.items.length > 1 ? style.label : first.detail || style.label}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export interface VarianceTrendCardProps {
  points: VarianceHistoryPoint[] | null
  loading: boolean
  money: (value: number) => string
  showCost: boolean
}

export function VarianceTrendCard({ points, loading, money, showCost }: VarianceTrendCardProps) {
  const chartPoints = useMemo(
    () =>
      (points ?? []).map((p) => ({
        key: `${p.documentId}`,
        label: p.documentDate ? formatDate(p.documentDate).slice(0, 6) : (p.documentNo ?? '—'),
        value: p.varianceValue,
        sub: `${formatInt(p.lineCount)} line${p.lineCount === 1 ? '' : 's'}`,
      })),
    [points],
  )

  return (
    <Card padding="md">
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-gray-500" aria-hidden />
            Variance trend
          </span>
        }
        action={<span className="text-[10px] text-gray-400">Last {chartPoints.length || 5} counts</span>}
      />
      {loading ? (
        <Skeleton className="h-[120px] w-full" />
      ) : !showCost ? (
        <p className="py-4 text-center text-[11px] text-gray-500">
          Variance value is not shown to your profile, so the trend is not either.
        </p>
      ) : chartPoints.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-gray-500">
          No previous physical count variance data available.
        </p>
      ) : (
        <TrendAreaChart
          points={chartPoints}
          height={132}
          formatValue={(n) => money(n)}
          caption="Net valuation variance of the last posted physical stock counts"
        />
      )}
    </Card>
  )
}

export interface PhysicalCountInsightRailProps {
  insights: PhysicalCountInsights
  insightsLoading: boolean
  insightsError: string | null
  onReveal: (insight: CountInsight) => void
  onOpenAssist: () => void
  onRefresh: () => void

  rows: readonly CountRow[]
  extra: readonly CountException[]
  onRevealLines: (lineKeys: string[], label: string) => void

  points: VarianceHistoryPoint[] | null
  historyLoading: boolean
  money: (value: number) => string
  showCost: boolean
}

export function PhysicalCountInsightRail({
  insights,
  insightsLoading,
  insightsError,
  onReveal,
  onOpenAssist,
  onRefresh,
  rows,
  extra,
  onRevealLines,
  points,
  money,
  showCost,
  historyLoading,
}: PhysicalCountInsightRailProps) {
  return (
    <aside className="flex flex-col gap-3 xl:w-[19rem] xl:shrink-0" aria-label="Count insights">
      <InsightsCard
        insights={insights}
        loading={insightsLoading}
        error={insightsError}
        onReveal={onReveal}
        onOpenAssist={onOpenAssist}
        onRefresh={onRefresh}
      />
      <ExceptionsCard rows={rows} extra={extra} onReveal={onRevealLines} />
      <VarianceTrendCard points={points} loading={historyLoading} money={money} showCost={showCost} />
    </aside>
  )
}

export default PhysicalCountInsightRail
