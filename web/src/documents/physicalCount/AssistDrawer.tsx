import { useMemo } from 'react'
import { CheckCircle2, CircleAlert, Layers, ScanBarcode, Sparkles, TrendingDown, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Drawer } from '../../ui/Drawer'
import { cx } from '../../ui/cx'
import { formatInt, formatQty } from '../../utils/format'
import { HIGH_SHRINKAGE_RATIO } from './countInsights'
import type { PhysicalCountInsights } from './countInsights'
import type { CountRow, CountSummary, PostingReadiness } from './countModel'

/**
 * The count assistant.
 *
 * What it does: read the sheet, explain it, and narrow it. Every action below
 * ends in "show me these rows" — the drawer never edits a quantity, never
 * resolves an exception and never posts. That boundary is deliberate and it is
 * the whole reason the panel can be trusted: an assistant that could quietly
 * change a counted figure would make every figure on the sheet unattributable,
 * which is exactly what an inventory audit is for.
 */

export interface AssistDrawerProps {
  open: boolean
  onClose: () => void
  rows: readonly CountRow[]
  summary: CountSummary
  insights: PhysicalCountInsights
  readiness: PostingReadiness
  money: (value: number) => string
  showCost: boolean
  /** Filter the sheet to these rows and close the drawer. */
  onReveal: (lineKeys: string[], label: string) => void
}

interface Suggestion {
  key: string
  icon: LucideIcon
  label: string
  detail: string
  lineKeys: string[]
}

export function AssistDrawer({
  open,
  onClose,
  rows,
  summary,
  insights,
  readiness,
  money,
  showCost,
  onReveal,
}: AssistDrawerProps) {
  const suggestions = useMemo<Suggestion[]>(() => {
    const counted = rows.filter((r) => r.counted && r.difference !== null)

    const valued = counted.filter((r) => r.varianceValue !== null && r.varianceValue !== 0)
    const sortedByValue = [...valued].sort(
      (a, b) => Math.abs(b.varianceValue ?? 0) - Math.abs(a.varianceValue ?? 0),
    )
    const topValue = sortedByValue.slice(0, 10)

    const bigShortages = counted.filter(
      (r) => r.difference !== null && r.difference < 0 && r.variancePct !== null && r.variancePct >= 0.1,
    )
    const duplicates = insights.anomalies.filter((a) => a.kind === 'serial_duplicate')
    const serialIssues = rows.filter((r) =>
      r.exceptions.some((e) => e.kind === 'serial_missing' || e.kind === 'serial_count_mismatch'),
    )
    const batchIssues = rows.filter((r) =>
      r.exceptions.some((e) => e.kind === 'batch_expired' || e.kind === 'batch_missing'),
    )
    const recount = insights.summary.find((i) => i.id === 'recount-suggestion')

    const out: Suggestion[] = []
    if (showCost && topValue.length) {
      out.push({
        key: 'high-value',
        icon: Wallet,
        label: 'Show high-value variances',
        detail: `Top ${topValue.length} by value swing — largest is ${money(Math.abs(topValue[0].varianceValue ?? 0))}.`,
        lineKeys: topValue.map((r) => r.line.key),
      })
    }
    if (bigShortages.length) {
      out.push({
        key: 'shortages',
        icon: TrendingDown,
        label: 'Show shortages above 10%',
        detail: `${bigShortages.length} line${bigShortages.length === 1 ? '' : 's'} short by more than a tenth of book.`,
        lineKeys: bigShortages.map((r) => r.line.key),
      })
    }
    if (duplicates.length) {
      out.push({
        key: 'dup-serials',
        icon: ScanBarcode,
        label: 'Show duplicate serial numbers',
        detail: `${duplicates.length} unit${duplicates.length === 1 ? '' : 's'} counted on more than one line.`,
        lineKeys: [...new Set(duplicates.map((a) => a.lineKey))],
      })
    }
    if (serialIssues.length) {
      out.push({
        key: 'serials',
        icon: ScanBarcode,
        label: 'Show serial checks still open',
        detail: `${serialIssues.length} serial-tracked line${serialIssues.length === 1 ? '' : 's'} without the units named.`,
        lineKeys: serialIssues.map((r) => r.line.key),
      })
    }
    if (batchIssues.length) {
      out.push({
        key: 'batches',
        icon: Layers,
        label: 'Show batch problems',
        detail: `${batchIssues.length} line${batchIssues.length === 1 ? '' : 's'} with an expired or missing batch.`,
        lineKeys: batchIssues.map((r) => r.line.key),
      })
    }
    if (recount && recount.lineKeys.length) {
      out.push({
        key: 'recount',
        icon: Sparkles,
        label: 'Suggest items to recount',
        detail: recount.detail,
        lineKeys: recount.lineKeys,
      })
    }
    return out
  }, [rows, insights, money, showCost])

  const stats: { label: string; value: string; tone?: 'danger' | 'warning' }[] = [
    { label: 'Counted', value: `${formatInt(summary.countedLines)} of ${formatInt(summary.itemsLoaded)}` },
    { label: 'Progress', value: `${summary.progressPct}%` },
    { label: 'Shortages', value: formatInt(summary.shortageItems), tone: summary.shortageItems ? 'danger' : undefined },
    { label: 'Excess', value: formatInt(summary.excessItems) },
    { label: 'Net quantity', value: `${summary.netQtyVariance > 0 ? '+' : ''}${formatQty(summary.netQtyVariance)}` },
    ...(showCost
      ? [
          {
            label: 'Net value',
            value: summary.varianceValue === null ? '—' : money(summary.varianceValue),
            tone: (summary.varianceValue ?? 0) < 0 ? ('danger' as const) : undefined,
          },
        ]
      : []),
    {
      label: 'Open exceptions',
      value: formatInt(summary.criticalExceptions + summary.warningExceptions),
      tone: summary.criticalExceptions ? 'danger' : summary.warningExceptions ? 'warning' : undefined,
    },
  ]

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Count assistant"
      badge={
        <Badge tone={insights.source === 'service' ? 'beta' : 'neutral'} size="xs">
          {insights.source === 'service' ? 'Beta' : 'Rule checks'}
        </Badge>
      }
      description="Reads this count and narrows the sheet. It never changes a quantity and never posts."
      width="md"
    >
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Count health</h3>
          <dl className="grid grid-cols-2 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-gray-500">{s.label}</dt>
                <dd
                  className={cx(
                    'mt-0.5 text-sm font-semibold tabular-nums',
                    s.tone === 'danger' ? 'text-red-600' : s.tone === 'warning' ? 'text-amber-700' : 'text-gray-900',
                  )}
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Posting readiness</h3>
          <div
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2',
              readiness.canPost ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
            )}
          >
            {readiness.canPost ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            )}
            <div className="min-w-0 text-xs">
              <p className={cx('font-semibold', readiness.canPost ? 'text-emerald-800' : 'text-amber-800')}>
                {readiness.summary}
              </p>
              {readiness.issues.length ? (
                <ul className="mt-1 space-y-0.5">
                  {readiness.issues.map((issue) => (
                    <li key={issue.message}>
                      {issue.lineKeys?.length ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
                          onClick={() => onReveal(issue.lineKeys as string[], issue.message)}
                        >
                          {issue.message}
                        </button>
                      ) : (
                        issue.message
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-[11px] text-gray-500">
                These are the browser&rsquo;s checks. Inventory re-validates everything when you post.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ask the sheet</h3>
          {suggestions.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-500">
              Nothing stands out yet. Once quantities are entered, the checks below appear — shrinkage above{' '}
              {Math.round(HIGH_SHRINKAGE_RATIO * 100)}%, duplicate serials, expired batches and the largest value
              swings.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((s) => {
                const Icon = s.icon
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => {
                        onReveal(s.lineKeys, s.label)
                        onClose()
                      }}
                      className="flex w-full items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-gray-900">{s.label}</span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">{s.detail}</span>
                      </span>
                      <Badge tone="neutral" size="xs" className="ml-auto shrink-0">
                        {formatInt(s.lineKeys.length)}
                      </Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {insights.recountRecommendations.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Largest unexplained differences
            </h3>
            <ul className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              {insights.recountRecommendations.map((line) => (
                <li key={line} className="text-[11px] text-gray-600">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  )
}

export default AssistDrawer
