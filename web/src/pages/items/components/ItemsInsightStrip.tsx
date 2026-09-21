import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Info, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import type { InventoryInsight, InsightSeverity } from '../itemsModel'

const SEVERITY_ICON: Record<InsightSeverity, LucideIcon> = {
  critical: TriangleAlert,
  warning: TriangleAlert,
  info: Info,
}

/*
 * Tints written as `-500/10` rather than as the `-100` wash.
 *
 * A `-100` is a fixed pale colour mixed for a white page; on the dark card it
 * stays a bright block, and `theme/darkAccents.test.tsx` fails the build for
 * exactly that. A 10% alpha of the solid accent composites over whatever
 * surface is underneath, so one class is right in both themes — the same form
 * `RegisterInsightStrip` uses.
 */
const SEVERITY_TILE: Record<InsightSeverity, string> = {
  critical: 'bg-red-500/10 text-red-600',
  warning: 'bg-amber-500/10 text-amber-600',
  info: 'bg-sky-500/10 text-sky-600',
}

export interface ItemsInsightStripProps {
  insights: readonly InventoryInsight[]
  loading: boolean
  /** Turns an insight's filter into the URL that shows exactly those rows. */
  hrefFor: (patch: Record<string, string>) => string
}

/**
 * Inventory intelligence: what in this catalogue needs a decision.
 *
 * Every line here is DERIVED — a count the database returned, paired with the
 * filter that lands on exactly the rows it counted. That is why each one is a
 * link: the claim is checkable in one click, which is the difference between an
 * assistant and a banner. Nothing is scored, predicted or inferred, and the
 * strip says "Derived from your inventory data" rather than implying a model
 * looked at it. When an anomaly-detection endpoint exists it adds lines to this
 * same list; it does not change what these ones mean.
 *
 * When there is nothing to report it says so plainly instead of manufacturing a
 * line to fill the space, and it never animates between findings: a strip that
 * rotates faster than it can be read is decoration, not information.
 */
export function ItemsInsightStrip({ insights, loading, hrefFor }: ItemsInsightStripProps) {
  const [expanded, setExpanded] = useState(false)

  if (loading && insights.length === 0) {
    return (
      <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 print:hidden" aria-hidden>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </div>
    )
  }

  const [primary, ...rest] = insights

  if (!primary) {
    return (
      <section
        aria-label="Inventory intelligence"
        className="flex shrink-0 items-center gap-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-500/[0.06] to-transparent px-3.5 py-2.5 print:hidden"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Aicountly intelligence</p>
          <p className="text-[13px] font-semibold text-gray-900">Inventory health looks good.</p>
        </div>
      </section>
    )
  }

  const Icon = SEVERITY_ICON[primary.severity]

  return (
    <section
      aria-label="Inventory intelligence"
      className="shrink-0 overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-r from-primary/[0.07] via-primary/[0.03] to-transparent print:hidden"
    >
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', SEVERITY_TILE[primary.severity])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" aria-hidden />
            Aicountly intelligence
          </p>
          <p className="truncate text-[13px] font-semibold text-gray-900">{primary.title}</p>
          <p className="truncate text-[11px] text-gray-500">{primary.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to={hrefFor(primary.filter)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {primary.actionLabel} →
          </Link>
          {rest.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {expanded ? 'Hide' : `${rest.length} more`}
              {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : null}
        </div>
      </div>

      {expanded && rest.length > 0 ? (
        <ul className="border-t border-primary/15">
          {rest.map((insight) => {
            const RowIcon = SEVERITY_ICON[insight.severity]
            return (
              <li key={insight.id} className="flex items-center gap-3 border-b border-gray-100 px-3.5 py-2 last:border-b-0">
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', SEVERITY_TILE[insight.severity])}>
                  <RowIcon className="h-3 w-3" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-gray-900">{insight.title}</p>
                  <p className="truncate text-[11px] text-gray-500">{insight.description}</p>
                </div>
                <Link
                  to={hrefFor(insight.filter)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {insight.actionLabel} →
                </Link>
              </li>
            )
          })}
          <li className="px-3.5 py-2 text-[10px] text-gray-400">
            Derived from your inventory data — each figure is a count you can open and check.
          </li>
        </ul>
      ) : null}
    </section>
  )
}
