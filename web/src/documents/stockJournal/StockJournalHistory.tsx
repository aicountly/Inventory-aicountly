import { useAccess } from '../../access/AccessContext'
import { Card } from '../../ui/Card'
import { EmptyState } from '../../ui/EmptyState'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { formatDateTime } from '../../utils/format'
import { buildTimeline } from '../timeline'
import type { InventoryDocument } from '../types'

interface StockJournalHistoryProps {
  /** Null until the draft has been saved once — there is nothing to show before that. */
  documentId: number | null
  document: InventoryDocument | null
}

const TONE_DOT = {
  neutral: 'bg-gray-400',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
} as const

/**
 * Everything that has happened to this document.
 *
 * Read-only by construction: it is assembled from the document's own stamps, the
 * approvals trail and `GET /v1/audit-log/entity/document/{id}`, none of which
 * this screen can write to. The audit read needs `audit.read`, and a profile
 * without it sees the lifecycle stamps rather than an error.
 */
export function StockJournalHistory({ documentId, document }: StockJournalHistoryProps) {
  const { can } = useAccess()
  const mayReadAudit = can('audit.read')
  const audit = useQuery(
    (signal) => documentsApi.auditTrail(documentId as number, signal),
    [documentId, mayReadAudit],
    { enabled: documentId !== null && mayReadAudit, keepData: false },
  )

  if (documentId === null || !document) {
    return (
      <Card padding="lg">
        <EmptyState
          title="No history yet"
          description="This journal has not been saved. Once it is saved as a draft, every edit, posting and reversal is recorded here."
        />
      </Card>
    )
  }

  const events = buildTimeline(document, document.approvals ?? [], audit.data?.data ?? [])

  return (
    <Card padding="lg">
      <div className="mb-3 border-b border-gray-100 pb-3">
        <h3 className="text-sm font-semibold text-gray-900">History</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Created, edited, posted, cancelled and reversed — with who and when. This trail is append-only
          and cannot be edited from the application.
        </p>
      </div>

      {audit.loading && events.length === 0 ? (
        <p className="flex items-center gap-2 py-4 text-xs text-gray-500">
          <Spinner /> Loading the trail…
        </p>
      ) : null}

      {!mayReadAudit ? (
        <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          Showing the lifecycle stamps only — the full audit log needs the &ldquo;read audit log&rdquo; permission.
        </p>
      ) : audit.error ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {errorMessage(audit.error, 'The audit log could not be read.')}
        </p>
      ) : null}

      {events.length === 0 && !audit.loading ? (
        <EmptyState compact title="Nothing recorded yet" description="The first entry appears when the draft is saved." />
      ) : (
        <ol className={cx(AIC, 'space-y-2.5')}>
          {events.map((e, i) => (
            <li key={`${e.when}-${i}`} className="grid grid-cols-[0.625rem_1fr] items-start gap-2.5">
              <span className={cx('mt-1.5 h-2.5 w-2.5 rounded-full', TONE_DOT[e.tone])} aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-900">{e.label}</p>
                <p className="text-[11px] text-gray-500">
                  {formatDateTime(e.when)}
                  {e.actor ? ` · ${e.actor}` : ''}
                </p>
                {e.note ? <p className="mt-0.5 text-[11px] italic text-gray-500">{e.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
