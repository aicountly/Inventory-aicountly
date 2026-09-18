import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { useQuery } from '../../hooks/useQuery'
import { isApiError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { pendingApi } from '../../services/stockApi'
import type { PendingRow } from '../../services/stockApi'
import type { DocumentListRow } from '../types'
import { buildJobWorkerOptions } from './jobWorkers'
import type { JobWorkerOption } from './jobWorkers'

/** How far back the picker looks. Enough to cover a year of job work without paging. */
const DOCUMENT_WINDOW = 200
const PENDING_WINDOW = 500

export interface JobWorkDirectory {
  jobWorkers: JobWorkerOption[]
  /** Every open job-work-out pending row in scope; the line hints read it per item. */
  pending: PendingRow[]
  documents: DocumentListRow[]
  loading: boolean
  /** True when the reader may not see documents or pending quantities (403). */
  forbidden: boolean
  error: string | null
  reload: () => void
}

/**
 * The live job-worker context for the dispatch screen: who this company sends job work to and
 * what is still open with them.
 *
 * Two reads, both already served and both already scoped to company / FY / branch by the API
 * client. Nothing is cached beyond the query's own lifetime — `qty_open` moves whenever anyone
 * posts a settlement, and a stale figure here would be read as fact.
 */
export function useJobWorkDirectory(enabled = true): JobWorkDirectory {
  const { scope } = useCompany()
  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : null

  const documents = useQuery(
    (signal) =>
      documentsApi.list(
        { document_type: 'JOB_WORK_OUT,JOB_WORK_IN', limit: DOCUMENT_WINDOW, sort: 'document_date', order: 'desc' },
        signal,
      ),
    [scopeKey],
    { enabled: enabled && scopeKey !== null, resetKey: scopeKey },
  )

  const pending = useQuery(
    (signal) => pendingApi.list({ kind: 'job_work', direction: 'out', limit: PENDING_WINDOW }, signal),
    [scopeKey],
    { enabled: enabled && scopeKey !== null, resetKey: scopeKey },
  )

  const rows = documents.data?.data
  const pendingRows = pending.data?.data

  const jobWorkers = useMemo(() => buildJobWorkerOptions(rows ?? [], pendingRows ?? []), [rows, pendingRows])

  const firstError = documents.error ?? pending.error
  const forbidden = [documents.error, pending.error].some((e) => isApiError(e) && e.status === 403)

  return {
    jobWorkers,
    pending: pendingRows ?? [],
    documents: rows ?? [],
    loading: documents.loading || pending.loading,
    forbidden,
    // A 403 is not an error the form should shout about: the directory is a convenience and
    // the ledger id can still be typed. Anything else is worth surfacing.
    error: forbidden || !firstError ? null : firstError.message,
    reload: () => {
      documents.reload()
      pending.reload()
    },
  }
}
