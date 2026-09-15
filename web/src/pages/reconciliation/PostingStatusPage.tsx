import { useMemo } from 'react'
import { useCompany } from '../../company/CompanyContext'
import { ListSheetActions } from '../../components/ListSheetActions'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { SummaryStrip } from '../../components/SummaryStrip'
import { Notice } from '../../components/Notice'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { fetchAllRows } from '../../services/listAll'
import { SYNC_STATUSES, reconciliationApi } from '../../services/reconciliationApi'
import type { PostingStatusEntry } from '../../services/reconciliationApi'
import { humanize } from '../../utils/format'
import { PostingStatusTable } from './PostingStatusTable'
import { ReconciliationExplainer } from './ReconciliationExplainer'
import { postingStatusCards } from './postingStatusCards'
import '../views.css'

const FILTER_KEYS = ['sync_status', 'source_document_type', 'source_document_id'] as const

/**
 * The sheet's columns.
 *
 * Both money columns are named for what they are: the Books figure is the
 * voucher's commercial value, the Inventory figure is what the stock was valued
 * at. They are different numbers with different owners, and a reader holding a
 * printed sheet has no other way to tell them apart.
 */
const EXPORT_COLUMNS: ExportableColumn<PostingStatusEntry>[] = [
  { key: 'sync_status', csvHeader: 'Sync', csv: (e) => humanize(e.sync_status) },
  { key: 'source_document_type', csvHeader: 'Books voucher type', csv: (e) => e.source.source_document_type ?? e.books?.source_document_type ?? '' },
  { key: 'books_document_no', csvHeader: 'Books voucher', csv: (e) => e.books?.document_no ?? e.source.source_document_no ?? (e.source.source_document_id ? `#${e.source.source_document_id}` : '') },
  { key: 'books_date', csvHeader: 'Books date', format: 'date', csv: (e) => e.books?.document_date ?? '' },
  { key: 'books_status', csvHeader: 'Books status', csv: (e) => e.books?.status ?? '' },
  { key: 'books_amount', csvHeader: 'Books amount (voucher value)', align: 'right', format: 'amount', csv: (e) => e.books?.amount ?? '' },
  { key: 'inventory_document_no', csvHeader: 'Inventory document', csv: (e) => (e.inventory ? e.inventory.document_no ?? `#${e.inventory.document_id}` : '') },
  { key: 'inventory_document_type', csvHeader: 'Inventory type', csv: (e) => e.inventory?.document_type ?? '' },
  { key: 'inventory_status', csvHeader: 'Inventory status', csv: (e) => e.inventory?.status ?? '' },
  { key: 'stock_effect', csvHeader: 'Stock effect (valuation)', align: 'right', format: 'amount', csv: (e) => e.inventory?.stock_effect ?? '' },
  { key: 'failure_reason', csvHeader: 'Failure', csv: (e) => e.inventory?.failure_reason ?? '' },
]

export function PostingStatusPage() {
  const { scope } = useCompany()
  const params = useListParams({ sort: 'document_date', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => reconciliationApi.postingStatus(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const cards = useMemo(() => postingStatusCards(list.data?.summary), [list.data?.summary])
  // The endpoint filters the rows it returns and leaves the summary whole, so a
  // narrowed table under untouched cards is correct — but only if the screen
  // says so.
  const narrowed = Boolean(state.filters.source_document_type || state.filters.source_document_id)
  const fetchAll = useMemo(
    () => () => fetchAllRows<PostingStatusEntry>((page, limit) => reconciliationApi.postingStatus({ ...query, page, limit })),
    [query],
  )

  return (
    <>
      <PageHeader
        title="Posting status"
        subtitle="Every Books voucher with stock lines against the Inventory document it produced: pending, failed, reversed, cancelled, or in sync. Failed and pending rows are the first thing to clear before a reconciliation can balance."
        actions={
          <ListSheetActions<PostingStatusEntry>
            columns={EXPORT_COLUMNS}
            rows={list.data?.data ?? []}
            fetchAll={fetchAll}
            filenameBase="posting-status"
            title="Posting status"
            description="Books vouchers with stock lines against the Inventory documents they produced"
            metaLines={[
              state.filters.sync_status ? `Sync status: ${humanize(state.filters.sync_status)}` : '',
              state.filters.source_document_type ? `Books voucher type: ${state.filters.source_document_type}` : '',
              state.filters.source_document_id ? `Books voucher id: ${state.filters.source_document_id}` : '',
              list.data && !list.data.books_available ? 'Books was not reachable — only the Inventory side is shown' : '',
            ].filter(Boolean)}
            onRefresh={list.reload}
            refreshing={list.loading}
            disabled={!list.data || list.data.meta.total === 0}
          />
        }
      />
      <RequirePermission permission={P.reconciliationRead} what="posting status">
        <ReconciliationExplainer screen="posting-status" />
        {list.data && !list.data.books_available ? <Notice kind="warning" title="Books not reachable">{list.data.books_error ?? 'Only the Inventory side is shown.'}</Notice> : null}
        <SummaryStrip items={cards} />
        {narrowed && cards.length > 0 ? (
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem' }}>
            The cards count every voucher in this company and year. The voucher-type and voucher-id
            filters narrow the table below them; clicking a card shows exactly the vouchers it counted.
          </p>
        ) : null}
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
