import { Clock3, PencilLine, SquareCheckBig, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { METRIC_CARD_GRID } from '../../../styles/designTokens'
import { formatInt } from '../../../utils/format'
import type { PlanCounts } from './bulkEditModel'
import type { BulkEditBatch } from './bulkEditHistory'
import { formatWhen } from './bulkEditHistory'

/**
 * The four figures over the workspace: what is ticked, what would be written,
 * what is in the way, and when this was last done.
 *
 * Each one is counted from something real. "Selected" is the size of the
 * explicit id set the write will carry; "out of N filtered" is the server's
 * own count for the current filters (`meta.total`), never the length of the
 * page on screen. "Pending changes" is the number of ticked items whose value
 * would actually change — an item that already holds the value is not a
 * pending change, and counting it as one would promise a write that is not
 * going to happen. "Last bulk edit" is the newest `item.bulk_update` batch in
 * the audit trail, and renders nothing at all when the trail is unreadable or
 * empty rather than inventing a date.
 */

export interface BulkEditKpiCardsProps {
  selectedCount: number
  /** The server's count for the current filters. Null until the first page lands. */
  filteredTotal: number | null
  counts: PlanCounts
  /** Blocking problems with the value in the editor, if any. */
  valueIssue: boolean
  lastBatch: BulkEditBatch | null
  /** Who ran `lastBatch`, already resolved to a name / label. */
  lastActorLabel: string | null
  historyLoading: boolean
  /** False when the user may not read the audit trail — the card says so. */
  historyReadable: boolean
  loading: boolean
  onViewSelected: () => void
}

export function BulkEditKpiCards({
  selectedCount,
  filteredTotal,
  counts,
  valueIssue,
  lastBatch,
  lastActorLabel,
  historyLoading,
  historyReadable,
  loading,
  onViewSelected,
}: BulkEditKpiCardsProps) {
  if (loading) {
    return (
      <section className={METRIC_CARD_GRID} aria-label="Bulk edit summary" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </section>
    )
  }

  const issues = counts.invalid + counts.locked + (valueIssue ? 1 : 0)

  return (
    <section className={METRIC_CARD_GRID} aria-label="Bulk edit summary">
      <StatCard
        layout="metric"
        icon={SquareCheckBig}
        tone="success"
        label="Selected items"
        value={formatInt(selectedCount)}
        hint={filteredTotal === null ? 'Loading the catalogue…' : `out of ${formatInt(filteredTotal)} filtered`}
        footer={
          selectedCount > 0 ? (
            <button
              type="button"
              onClick={onViewSelected}
              className="text-[11px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
            >
              View selected
            </button>
          ) : null
        }
      />

      <StatCard
        layout="metric"
        icon={PencilLine}
        tone="warning"
        label="Pending changes"
        value={formatInt(counts.willUpdate)}
        hint={
          counts.willUpdate > 0
            ? 'Ready to apply'
            : counts.unchanged > 0
              ? `${formatInt(counts.unchanged)} already have this value`
              : 'Nothing to write yet'
        }
      />

      <StatCard
        layout="metric"
        icon={TriangleAlert}
        tone={issues > 0 ? 'danger' : 'slate'}
        label="Validation issues"
        value={formatInt(issues)}
        hint={
          issues > 0 ? (
            'Needs attention'
          ) : (
            /* Not colour alone: the words carry the verdict for a reader who
               cannot tell the green from the grey. */
            <span className="text-emerald-600 font-medium">All good!</span>
          )
        }
      />

      <StatCard
        layout="metric"
        icon={Clock3}
        tone="info"
        label="Last bulk edit"
        value={
          !historyReadable ? (
            <span className="text-sm font-medium text-gray-500">Not visible to you</span>
          ) : historyLoading ? (
            <span className="text-sm font-medium text-gray-400">Loading…</span>
          ) : lastBatch ? (
            <span className="text-sm">{formatWhen(lastBatch.at)}</span>
          ) : (
            <span className="text-sm font-medium text-gray-500">No bulk edits yet</span>
          )
        }
        hint={
          !historyReadable ? (
            'Reading the audit trail needs the audit permission'
          ) : lastBatch ? (
            <span className="truncate">By {lastActorLabel ?? 'unknown'}</span>
          ) : (
            'Completed bulk changes appear here'
          )
        }
        footer={
          historyReadable && lastBatch ? (
            <Link
              to="/audit?entity_type=item&action=item.bulk_update"
              className="text-[11px] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
            >
              View history
            </Link>
          ) : null
        }
      />
    </section>
  )
}
