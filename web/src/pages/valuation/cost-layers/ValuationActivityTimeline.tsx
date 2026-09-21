import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, PackagePlus, PackageMinus, RefreshCw, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatDateTime } from '../../../utils/format'
import type { ActivityEvent, ActivityKind } from './costLayersModel'

const ICON: Record<ActivityKind, LucideIcon> = {
  recalculation: CheckCircle2,
  revision: RefreshCw,
  receipt: PackagePlus,
  issue: PackageMinus,
}

const TONE: Record<ActivityKind, string> = {
  recalculation: 'bg-primary text-white',
  revision: 'bg-sky-50 text-sky-600',
  receipt: 'bg-emerald-50 text-emerald-600',
  issue: 'bg-gray-100 text-gray-600',
}

export interface ValuationActivityTimelineProps {
  events: readonly ActivityEvent[]
  loading?: boolean
  viewAllTo?: string
  emptyMessage?: string
}

/**
 * What has happened to this item's valuation lately.
 *
 * Four real sources merged into one column — recalculation jobs, the COGS
 * revisions they published, the receipts that opened the layers on screen and
 * the issues that consumed them. Nothing is fetched to fill it out and nothing
 * is summarised into a sentence no record supports: an empty timeline means
 * nothing has happened, and says so.
 */
export function ValuationActivityTimeline({
  events,
  loading = false,
  viewAllTo,
  emptyMessage = 'No valuation activity on record for this item yet.',
}: ValuationActivityTimelineProps) {
  return (
    <section aria-label="Recent valuation activity" className="min-w-0">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h3 className="text-[13px] font-semibold text-gray-900">Recent valuation activity</h3>
        {viewAllTo ? (
          <Link
            to={viewAllTo}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary no-underline hover:underline"
          >
            View all
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div className="px-3 pb-3">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="h-5 w-5 shrink-0" rounded="full" />
                <div className="min-w-0 flex-1 space-y-1">
                  <Skeleton className="h-2.5 w-2/3" rounded="md" />
                  <Skeleton className="h-2.5 w-1/2" rounded="md" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="py-2 text-[11px] leading-relaxed text-gray-500">{emptyMessage}</p>
        ) : (
          <ol className="relative space-y-0">
            {events.map((event, index) => {
              const Icon = event.failed ? TriangleAlert : ICON[event.kind]
              const last = index === events.length - 1
              return (
                <li key={event.key} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 pb-3 last:pb-0">
                  {last ? null : (
                    <span
                      className="absolute left-[0.59rem] top-6 bottom-0 w-px bg-gray-200"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cx(
                      'relative z-10 mt-0.5 grid h-5 w-5 place-items-center rounded-full',
                      event.failed ? 'bg-red-50 text-red-600' : TONE[event.kind],
                    )}
                    aria-hidden
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] font-semibold text-gray-900">
                      {event.to ? (
                        <Link to={event.to} className="text-gray-900 no-underline hover:text-primary hover:underline">
                          {event.title}
                        </Link>
                      ) : (
                        event.title
                      )}
                    </p>
                    <p className="truncate text-[10px] text-gray-500">
                      {formatDateTime(event.at)} · {event.meta}
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-600">{event.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

export default ValuationActivityTimeline
