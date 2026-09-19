import { Link } from 'react-router-dom'
import { ArrowRight, CircleCheck, FileClock, PackageMinus, PackagePlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../../../ui/Card'
import { EmptyState } from '../../../ui/EmptyState'
import { SkeletonRows } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatDateTime } from '../../../utils/format'
import type { ActivityEvent, ActivityKind } from '../costLayerModel'

const ICON: Record<ActivityKind, LucideIcon> = {
  receipt: PackagePlus,
  issue: PackageMinus,
  recalculation: CircleCheck,
  revision: FileClock,
}

const TINT: Record<ActivityKind, string> = {
  receipt: 'bg-emerald-50 text-emerald-600',
  issue: 'bg-sky-50 text-sky-600',
  recalculation: 'bg-primary text-white',
  revision: 'bg-violet-50 text-violet-600',
}

export interface ValuationActivityTimelineProps {
  events: ActivityEvent[]
  loading: boolean
  itemSelected: boolean
  /** Where "View all" goes — the register that holds the full history. */
  viewAllTo: string
  className?: string
}

/**
 * The item's valuation history.
 *
 * Not a feed: Inventory has no activity endpoint, and inventing one in the
 * browser would mean deciding which events exist. This merges four lists that
 * already do — the layers (a receipt), their consumptions (an issue), the
 * recalculation queue and the published revisions — on their own timestamps,
 * so every entry is a record somebody can open.
 */
export function ValuationActivityTimeline({
  events,
  loading,
  itemSelected,
  viewAllTo,
  className,
}: ValuationActivityTimelineProps) {
  return (
    <Card padding="none" className={cx('overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold text-gray-900">Recent valuation activity</h2>
        <Link
          to={viewAllTo}
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary no-underline hover:underline"
        >
          View all
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {loading && events.length === 0 ? (
        <div className="px-3 pb-3">
          <SkeletonRows rows={4} />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          size="sm"
          icon={FileClock}
          title={itemSelected ? 'No activity yet' : 'No item selected'}
          description={
            itemSelected
              ? 'Receipts, issues, recalculations and revisions for this item appear here as they happen.'
              : 'Pick an item to see its receipts, issues and re-costings.'
          }
        />
      ) : (
        <ol className="px-3 pb-3">
          {events.map((event, index) => {
            const Icon = ICON[event.kind]
            const last = index === events.length - 1
            return (
              <li key={event.id} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2 py-1.5">
                {/* The rail is drawn between the dots, not behind them, so a
                    long entry does not leave a line running through its text. */}
                {last ? null : (
                  <span
                    aria-hidden
                    className="absolute left-[10px] top-[26px] bottom-[-6px] w-px bg-gray-200"
                  />
                )}
                <span
                  className={cx(
                    'relative z-[1] mt-0.5 grid h-[21px] w-[21px] place-items-center rounded-full',
                    TINT[event.kind],
                  )}
                  aria-hidden
                >
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold text-gray-900">{event.title}</p>
                  <p className="text-[10px] text-gray-500">
                    {formatDateTime(event.at)}
                    {event.reference ? (
                      <>
                        {' · '}
                        {event.to ? (
                          <Link to={event.to} className="text-gray-600 no-underline hover:text-primary hover:underline">
                            {event.reference}
                          </Link>
                        ) : (
                          event.reference
                        )}
                      </>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-gray-600">{event.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

export default ValuationActivityTimeline
