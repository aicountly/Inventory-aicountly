import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import type { AuditLogRow } from '../../services/auditApi'
import { Skeleton } from '../../ui/Skeleton'
import { AIC, cx } from '../../ui/cx'
import { formatDateTime, humanize } from '../../utils/format'
import { actorIdentity, splitAction } from '../audit/auditPresentation'
import { AsideCard } from './ItemWorkspaceKit'

/**
 * What has happened to this item, from the real audit trail.
 *
 * `GET /v1/audit-log/entity/item/{id}` — the same append-only log the Audit screen reads, written
 * by the server on every write. Nothing is composed in the browser: there is no client-side record
 * of "you just saved", because a second, softer history that only one tab can see is not an audit
 * trail and would disagree with the real one the moment anything went wrong.
 *
 * Four states are told apart rather than blurred into one empty box: still loading, nothing has
 * happened yet, this item has not been saved at all, and this profile may not read the audit log.
 * "No activity" and "you are not allowed to see the activity" are different answers.
 */
export interface ItemRecentActivityCardProps {
  rows: AuditLogRow[] | null
  loading: boolean
  /** Set when the audit call failed — a 403 reads differently from an outage. */
  error: string | null
  permitted: boolean
  isNew: boolean
  viewAllTo: string | null
}

export function ItemRecentActivityCard({
  rows,
  loading,
  error,
  permitted,
  isNew,
  viewAllTo,
}: ItemRecentActivityCardProps) {
  const body = () => {
    if (isNew) return <p className="text-[11px] text-gray-500">Activity starts once this item is created.</p>
    if (!permitted)
      return (
        <p className="text-[11px] text-gray-500">
          Your access profile does not include the audit trail, so this item’s history is not shown here.
        </p>
      )
    if (loading && !rows)
      return (
        <div className={cx(AIC, 'space-y-2')}>
          <Skeleton height="h-8" />
          <Skeleton height="h-8" />
        </div>
      )
    if (error) return <p className="text-[11px] text-gray-500">No recent activity available — {error}</p>
    if (!rows || rows.length === 0) return <p className="text-[11px] text-gray-500">No recent activity available.</p>

    return (
      <ol className="space-y-2.5">
        {rows.slice(0, 4).map((row) => {
          const actor = actorIdentity(row)
          const { verb } = splitAction(row.action)
          return (
            <li key={row.audit_id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                <Pencil className="h-3 w-3" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-gray-900">
                  Item {humanize(verb).toLowerCase()}
                </p>
                <p className="truncate text-[10px] text-gray-500" title={actor.title}>
                  {actor.label}
                </p>
                <time dateTime={row.created_at} className="text-[10px] tabular-nums text-gray-400">
                  {formatDateTime(row.created_at)}
                </time>
              </div>
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <AsideCard
      title="Recent Activity"
      action={
        viewAllTo && permitted && !isNew ? (
          <Link
            to={viewAllTo}
            className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary no-underline transition-colors hover:underline"
          >
            View all
          </Link>
        ) : null
      }
    >
      {body()}
    </AsideCard>
  )
}

export default ItemRecentActivityCard
