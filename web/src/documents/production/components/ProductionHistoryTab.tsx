import { History } from 'lucide-react'
import { useQuery } from '../../../hooks/useQuery'
import { errorMessage, isApiError } from '../../../services/api'
import { documentsApi } from '../../../services/documentsApi'
import { EmptyState } from '../../../ui/EmptyState'
import { ErrorState } from '../../../ui/ErrorState'
import { SkeletonRows } from '../../../ui/Skeleton'
import { formatDateTime, humanize } from '../../../utils/format'

export interface ProductionHistoryTabProps {
  documentId: number | null
}

/**
 * The document's own audit trail — `GET /v1/audit-log/entity/document/{id}`, oldest first.
 *
 * Nothing is recorded from this screen: the trail is written by the server when the draft is
 * created, updated and posted, which is why an unsaved run has none to show. Reading it needs
 * `audit.read`; a profile without it gets that fact rather than an empty list.
 */
export function ProductionHistoryTab({ documentId }: ProductionHistoryTabProps) {
  const trail = useQuery((signal) => documentsApi.auditTrail(documentId as number, signal), [documentId], {
    enabled: documentId !== null,
    keepData: false,
  })

  if (documentId === null) {
    return (
      <EmptyState
        icon={History}
        size="sm"
        title="No history yet"
        description="Every change is recorded from the moment this run is saved as a draft — created, edited, posted, reversed."
      />
    )
  }
  if (trail.loading && !trail.data) return <div className="p-4"><SkeletonRows rows={5} /></div>
  if (trail.error) {
    const forbidden = isApiError(trail.error) && trail.error.status === 403
    return (
      <div className="p-4">
        <ErrorState
          size="sm"
          title={forbidden ? 'Audit trail is not visible to you' : 'History could not be loaded'}
          description={forbidden ? 'Reading the audit log needs the audit permission. Everything else on this screen still works.' : errorMessage(trail.error)}
          onRetry={forbidden ? undefined : trail.reload}
        />
      </div>
    )
  }

  const rows = trail.data?.data ?? []
  if (rows.length === 0) {
    return <EmptyState icon={History} size="sm" title="Nothing recorded yet" description="The trail fills in as this document is edited and posted." />
  }

  return (
    <ol className="divide-y divide-gray-100">
      {rows.map((row) => (
        <li key={row.audit_id} className="flex items-start gap-3 px-4 py-3">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-900">{humanize(row.action.replace(/^document\./, ''))}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {formatDateTime(row.created_at)}
              {row.source_app ? ` · ${row.source_app}` : ''}
              {row.reason ? ` · ${row.reason}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default ProductionHistoryTab
