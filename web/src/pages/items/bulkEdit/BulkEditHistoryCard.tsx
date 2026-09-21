import { History, Lock, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Skeleton } from '../../../ui/Skeleton'
import { Notice } from '../../../components/Notice'
import { formatInt } from '../../../utils/format'
import { actorIdentity } from '../../audit/auditPresentation'
import type { ItemFormOptions } from '../../../services/items'
import type { BulkEditBatch } from './bulkEditHistory'
import { describeBatch, formatWhen } from './bulkEditHistory'

/**
 * The last few bulk edits, read out of the audit trail.
 *
 * Not a log this screen keeps: these are `item.bulk_update` entries grouped
 * back into the operations that wrote them (see bulkEditHistory.ts), so they
 * include edits made by a colleague, from another browser, last week. A reader
 * who cannot see the audit trail is told that, rather than shown an empty card
 * that reads as "nothing has ever happened here".
 *
 * The panel fails on its own. A trail that will not load is a line inside this
 * card and nothing else — bulk editing carries on regardless.
 */

export interface BulkEditHistoryCardProps {
  batches: readonly BulkEditBatch[]
  options: ItemFormOptions | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  readable: boolean
  onOpen: (batch: BulkEditBatch) => void
}

export function BulkEditHistoryCard({
  batches,
  options,
  loading,
  error,
  onRetry,
  readable,
  onOpen,
}: BulkEditHistoryCardProps) {
  return (
    <Card padding="md" className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Recent bulk edits</h3>
        {readable ? (
          <Link
            to="/audit?entity_type=item&action=item.bulk_update"
            className="text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
          >
            View all
          </Link>
        ) : null}
      </div>

      {!readable ? (
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          Bulk edit history comes from the audit trail, which your access profile does not include.
        </p>
      ) : error ? (
        <Notice
          kind="warning"
          title="History unavailable"
          className="mt-3"
          actions={
            <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
              Retry
            </Button>
          }
        >
          Bulk editing is unaffected.
        </Notice>
      ) : loading ? (
        <div className="mt-3 space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-2.5 w-3/4" />
                <Skeleton className="h-2 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : batches.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          No bulk edits yet. Completed bulk changes will appear here.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-gray-100">
          {batches.map((batch) => {
            const actor = actorIdentity({ actor_uuid: batch.actorUuid })
            return (
              <li key={batch.id}>
                <button
                  type="button"
                  onClick={() => onOpen(batch)}
                  className="flex w-full items-center gap-2.5 py-2.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50" aria-hidden>
                    <History className="h-3.5 w-3.5 text-emerald-600" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-gray-800">
                      {describeBatch(batch, options)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-gray-500">
                      {formatInt(batch.itemCount)} item{batch.itemCount === 1 ? '' : 's'} · {formatWhen(batch.at)}
                    </span>
                  </span>
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-600"
                    title={actor.title}
                  >
                    {actor.initials}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
