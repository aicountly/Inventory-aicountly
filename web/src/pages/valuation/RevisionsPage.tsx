import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ItemFilter } from '../../components/ItemFilter'
import { ListSheetActions } from '../../components/ListSheetActions'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { valuationApi } from '../../services/valuationApi'
import type { ValuationRevision } from '../../services/valuationApi'
import { useToast } from '../../ui/ToastContext'
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['acknowledged', 'job_id', 'document_id', 'item_id', 'source_app', 'from', 'to'] as const

/** Applied in Books / Published to Books / Pending — the same words the badge uses. */
function booksState(r: ValuationRevision): string {
  if (r.acknowledged) return 'Applied in Books'
  return r.published_at ? 'Published to Books' : 'Pending'
}

/**
 * The sheet's columns.
 *
 * Every rate and amount here is a VALUATION figure — what the stock cost, which
 * is what drives COGS and closing stock. None of it is the commercial rate
 * agreed with a party; that number belongs to Books and is not in this table.
 * The column names say so in full, because a printed sheet headed "Old rate"
 * is a sheet somebody will read as a price.
 */
const EXPORT_COLUMNS: ExportableColumn<ValuationRevision>[] = [
  { key: 'revision_id', csvHeader: 'Revision', align: 'right', format: 'int' },
  { key: 'created_at', csvHeader: 'Created', format: 'datetime' },
  { key: 'books_state', csvHeader: 'Books', csv: booksState },
  { key: 'document_no', csvHeader: 'Document', csv: (r) => r.document_no ?? (r.document_id ? `#${r.document_id}` : '') },
  { key: 'document_date', csvHeader: 'Document date', format: 'date' },
  { key: 'source', csvHeader: 'Source', csv: (r) => (r.source_app ? `${r.source_app} · ${r.source_document_no ?? r.source_document_id ?? ''}`.trim() : '') },
  { key: 'item_name', csvHeader: 'Item', csv: (r) => r.item_name ?? (r.item_id ? `Item #${r.item_id}` : '') },
  { key: 'base_qty', csvHeader: 'Qty', align: 'right', format: 'qty' },
  { key: 'old_valuation_rate', csvHeader: 'Old valuation rate', align: 'right', format: 'amount' },
  { key: 'new_valuation_rate', csvHeader: 'New valuation rate', align: 'right', format: 'amount' },
  { key: 'old_valuation_amount', csvHeader: 'Old valuation amount', align: 'right', format: 'amount' },
  { key: 'new_valuation_amount', csvHeader: 'New valuation amount', align: 'right', format: 'amount' },
  { key: 'delta_amount', csvHeader: 'Valuation delta (new − old)', align: 'right', format: 'amount' },
  { key: 'job_id', csvHeader: 'Recalculation job', align: 'right', format: 'int' },
  { key: 'acknowledged_at', csvHeader: 'Acknowledged', format: 'datetime' },
  { key: 'acknowledged_by_app', csvHeader: 'Acknowledged by' },
]

export function RevisionsPage() {
  const { scope } = useCompany()
  const toast = useToast()
  const canAck = useCan([P.valuationRecalculate, P.reconciliationResolve])
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state } = params
  const acknowledged = state.filters.acknowledged ?? '0'
  const query = useMemo(() => ({ ...params.query, acknowledged: acknowledged === 'all' ? '' : acknowledged }), [params.query, acknowledged])
  const list = useQuery((signal) => valuationApi.revisions(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const rows = list.data?.data ?? []
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (id: number) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const ack = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await valuationApi.ackRevisions(ids)
      toast.success(`${res.acknowledged} revision(s) acknowledged as ${res.acknowledged_by_app}${res.already_acknowledged ? `, ${res.already_acknowledged} already were` : ''}.`)
      setSelected(new Set())
      list.reload()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not acknowledge the revisions.')
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo<Column<ValuationRevision>[]>(
    () => [
      ...(canAck ? [{ key: 'pick', header: '', render: (r: ValuationRevision) => (r.acknowledged ? null : <input type="checkbox" aria-label={`Select revision ${r.revision_id}`} checked={selected.has(r.revision_id)} onChange={() => toggle(r.revision_id)} />) } as Column<ValuationRevision>] : []),
      { key: 'revision_id', header: '#', sortKey: 'revision_id' },
      { key: 'created_at', header: 'Created', sortKey: 'created_at', render: (r) => formatDateTime(r.created_at) },
      { key: 'acknowledged', header: 'Books', render: (r) => (r.acknowledged ? <StatusBadge value="applied" tone="good" /> : r.published_at ? <StatusBadge value="published" tone="warning" /> : <StatusBadge value="pending" tone="info" />) },
      { key: 'document', header: 'Document', render: (r) => (r.document_id ? <Link to={`/documents/${r.document_id}`}>{r.document_no ?? `#${r.document_id}`}</Link> : '—') },
      { key: 'document_date', header: 'Date', render: (r) => formatDate(r.document_date) },
      { key: 'source', header: 'Source', render: (r) => (r.source_app ? `${r.source_app} · ${r.source_document_no ?? r.source_document_id ?? ''}` : <span className="muted">—</span>) },
      { key: 'item_name', header: 'Item', render: (r) => (r.item_id ? <Link to={`/valuation/cost-layers?item_id=${r.item_id}`}>{r.item_name ?? `Item #${r.item_id}`}</Link> : '—') },
      { key: 'base_qty', header: 'Qty', align: 'right', render: (r) => formatQty(r.base_qty) },
      { key: 'old_valuation_rate', header: 'Old valuation rate', align: 'right', render: (r) => formatMoney(r.old_valuation_rate) },
      { key: 'new_valuation_rate', header: 'New valuation rate', align: 'right', render: (r) => formatMoney(r.new_valuation_rate) },
      { key: 'old_valuation_amount', header: 'Old valuation amount', align: 'right', render: (r) => formatMoney(r.old_valuation_amount) },
      { key: 'new_valuation_amount', header: 'New valuation amount', align: 'right', render: (r) => formatMoney(r.new_valuation_amount) },
      { key: 'delta_amount', header: 'Valuation delta', align: 'right', sortKey: 'delta_amount', render: (r) => <strong className={(r.delta_amount ?? 0) < 0 ? 'text-critical' : undefined}>{formatMoney(r.delta_amount)}</strong> },
      { key: 'job_id', header: 'Job', render: (r) => (r.job_id ? <Link to={`/valuation/recalculations?all_fy=1`}>#{r.job_id}</Link> : '—') },
      { key: 'acknowledged_at', header: 'Acknowledged', render: (r) => (r.acknowledged_at ? `${formatDateTime(r.acknowledged_at)} · ${r.acknowledged_by_app ?? ''}` : '—') },
    ],
    [canAck, selected],
  )

  return (
    <>
      <PageHeader
        title="Valuation revisions"
        subtitle="Line-level cost changes produced by recalculations. Books acknowledges each one after it has re-posted the COGS; anything unacknowledged shows up in reconciliation."
        actions={
          <>
            {canAck ? <button type="button" className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={ack}>{busy ? 'Acknowledging…' : `Acknowledge selected (${selected.size})`}</button> : null}
            <ListSheetActions<ValuationRevision>
              columns={EXPORT_COLUMNS}
              rows={rows}
              fetchAll={() => fetchAllRows<ValuationRevision>((page, limit) => valuationApi.revisions({ ...query, page, limit }))}
              filenameBase="valuation-revisions"
              title="Valuation revisions"
              description="Line-level cost changes a recalculation produced, and whether Books has applied them"
              metaLines={[
                `Books: ${acknowledged === '1' ? 'acknowledged only' : acknowledged === 'all' ? 'acknowledged and awaiting' : 'awaiting Books'}`,
                state.filters.item_id ? `Item id: ${state.filters.item_id}` : '',
                state.filters.job_id ? `Recalculation job: #${state.filters.job_id}` : '',
                state.filters.document_id ? `Document id: ${state.filters.document_id}` : '',
                state.filters.from || state.filters.to ? `Created between: ${state.filters.from || '…'} and ${state.filters.to || '…'}` : '',
              ].filter(Boolean)}
              footerNotes={['Every rate and amount here is a valuation figure — what the stock cost. Commercial rates and amounts live in Books.']}
              onRefresh={list.reload}
              refreshing={list.loading}
              disabled={!list.data || list.data.meta.total === 0}
            />
          </>
        }
      />
      <RequirePermission permission={P.report('valuation')} what="valuation revisions">
        <div className="toolbar">
          <select className="select" value={acknowledged} onChange={(e) => params.setFilter('acknowledged', e.target.value)} aria-label="Acknowledged">
            <option value="0">Awaiting Books</option>
            <option value="1">Acknowledged</option>
            <option value="all">All</option>
          </select>
          <ItemFilter value={state.filters.item_id ?? ''} onChange={(id) => params.setFilter('item_id', id)} />
          <input className="input short" inputMode="numeric" placeholder="Job #" value={state.filters.job_id ?? ''} onChange={(e) => params.setFilter('job_id', e.target.value.replace(/[^\d]/g, ''))} aria-label="Job id" />
          <input className="input short" inputMode="numeric" placeholder="Document #" value={state.filters.document_id ?? ''} onChange={(e) => params.setFilter('document_id', e.target.value.replace(/[^\d]/g, ''))} aria-label="Document id" />
          <input className="input date" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From" />
          <input className="input date" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.revision_id} loading={list.loading} error={list.error} emptyMessage="No revisions match these filters." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
