import { useCompany } from '../../company/CompanyContext'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { SummaryStrip } from '../../components/SummaryStrip'
import { Notice } from '../../components/Notice'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { SYNC_STATUSES, reconciliationApi } from '../../services/reconciliationApi'
import { formatInt } from '../../utils/format'
import { PostingStatusTable, syncTone } from './PostingStatusTable'
import '../views.css'

const FILTER_KEYS = ['sync_status', 'source_document_type', 'source_document_id'] as const

export function PostingStatusPage() {
  const { scope } = useCompany()
  const params = useListParams({ sort: 'document_date', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => reconciliationApi.postingStatus(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const summary = list.data?.summary ?? {}

  return (
    <>
      <PageHeader title="Posting status" subtitle="Every Books voucher with stock lines against the Inventory document it produced: pending, failed, reversed, cancelled, or in sync. Failed and pending rows are the first thing to clear before a reconciliation can balance." />
      <RequirePermission permission={P.reconciliationRead} what="posting status">
        {list.data && !list.data.books_available ? <Notice kind="warning" title="Books not reachable">{list.data.books_error ?? 'Only the Inventory side is shown.'}</Notice> : null}
        <SummaryStrip items={Object.entries(summary).map(([k, n]) => ({ label: k.replace(/_/g, ' '), value: formatInt(n), tone: syncTone(k) === 'info' ? 'neutral' : (syncTone(k) as 'good' | 'warning' | 'critical' | 'neutral') }))} />
        <div className="toolbar">
          <select className="select" value={state.filters.sync_status ?? ''} onChange={(e) => params.setFilter('sync_status', e.target.value)} aria-label="Sync status">
            <option value="">All</option>
            {SYNC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Source type (books.sales…)" value={state.filters.source_document_type ?? ''} onChange={(e) => params.setFilter('source_document_type', e.target.value)} aria-label="Source document type" />
          <input className="input short" inputMode="numeric" placeholder="Voucher id" value={state.filters.source_document_id ?? ''} onChange={(e) => params.setFilter('source_document_id', e.target.value.replace(/[^\d]/g, ''))} aria-label="Source document id" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        <PostingStatusTable entries={list.data?.data ?? []} loading={list.loading} error={list.error} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
