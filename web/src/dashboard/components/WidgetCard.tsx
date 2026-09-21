import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { EmptyState } from '../../ui/EmptyState'
import { cardErrorCopy } from '../errorCopy'

/**
 * The shell every dashboard widget sits in, so all of them behave the same way.
 *
 * Each widget loads on its own request, which means each one has to own its
 * four states rather than the page owning one global one:
 *
 *   loading  → the widget's own skeleton, shaped like the content (never a
 *              spinner, never the word "Loading…"), so nothing reflows on land
 *   error    → an inline message with a Retry that re-runs *this* widget only;
 *              a slow valuation walk or a 403 on one report never blanks the page
 *   empty    → a sentence explaining why it is empty, not a dash
 *   ready    → the content
 *
 * The header's "view all" is the same drill-through contract as the KPI cards:
 * it must land on the register this widget was summarising.
 */
export interface WidgetState {
  loading: boolean
  error: Error | null
  /** True when the request succeeded but there is nothing to draw. */
  empty: boolean
  reload?: () => void
}

export interface WidgetCardProps {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  tone?: IconTone
  viewAll?: { to: string; label?: string }
  state: WidgetState
  skeleton: ReactNode
  emptyTitle?: ReactNode
  emptyDescription?: ReactNode
  emptyIcon?: LucideIcon
  /**
   * What this card is about, in the user's words — "inventory value", "stock
   * ageing". Used to write the failure message; never the API's own text.
   */
  errorSubject?: string
  /** Pinned under the content — a total, a count, a secondary link. */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

export function WidgetCard({
  title,
  description,
  icon,
  tone = 'primary',
  viewAll,
  state,
  skeleton,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  emptyIcon,
  errorSubject,
  footer,
  className = '',
  children,
}: WidgetCardProps) {
  const { loading, error, empty, reload } = state
  // The card says what the reader can do about it. The API's own message —
  // status codes, column names, SQL — goes to the console for us instead.
  const failure = error ? cardErrorCopy(error, errorSubject ?? 'this') : null

  return (
    <Card padding="md" className={`flex flex-col ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          {icon ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
            {description ? <p className="text-label-md text-gray-500 mt-0.5 truncate">{description}</p> : null}
          </div>
        </div>
        {viewAll ? (
          <Link
            to={viewAll.to}
            className="shrink-0 inline-flex items-center gap-1 text-label-md font-semibold text-primary hover:underline print:hidden"
          >
            {viewAll.label ?? 'View all'}
            <ArrowRight className="w-3 h-3" />
          </Link>
        ) : null}
      </div>

      <div className="flex-1 min-h-0">
        {failure ? (
          <div
            role="status"
            className={
              failure.tone === 'notice'
                ? 'rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900'
                : 'rounded-lg border border-red-100 bg-red-50/60 p-3 text-xs text-red-700'
            }
          >
            <p className="font-semibold">{failure.title}</p>
            <p className={failure.tone === 'notice' ? 'mt-0.5 text-amber-800' : 'mt-0.5 text-red-600/90'}>
              {failure.message}
            </p>
            {reload && failure.retryable ? (
              <button
                type="button"
                onClick={reload}
                className={
                  failure.tone === 'notice'
                    ? 'mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-900 hover:border-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 print:hidden'
                    : 'mt-2 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 font-semibold text-red-700 hover:border-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 print:hidden'
                }
              >
                <RefreshCw className="w-3 h-3" aria-hidden />
                Retry
              </button>
            ) : null}
          </div>
        ) : loading ? (
          skeleton
        ) : empty ? (
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} compact />
        ) : (
          children
        )}
      </div>

      {footer && !error && !loading ? (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">{footer}</div>
      ) : null}
    </Card>
  )
}

export default WidgetCard
