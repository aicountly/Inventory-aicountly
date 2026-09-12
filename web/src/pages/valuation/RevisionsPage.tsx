import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCan } from '../../access/AccessContext'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { ItemFilter } from '../../components/ItemFilter'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { ApiError } from '../../services/api'
import { fetchAllRows } from '../../services/listAll'
import { valuationApi } from '../../services/valuationApi'
import type { ValuationRevision } from '../../services/valuationApi'
import { useToast } from '../../ui/ToastContext'
import { csvFilename } from '../../utils/csv'
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['acknowledged', 'job_id', 'document_id', 'item_id', 'source_app', 'from', 'to'] as const

export function RevisionsPage() {
  const { scope, companyName } = useCompany()
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
      { key: 'old_valuation_rate', header: 'Old rate', align: 'right', render: (r) => formatMoney(r.old_valuation_rate) },
      { key: 'new_valuation_rate', header: 'New rate', align: 'right', render: (r) => formatMoney(r.new_valuation_rate) },
      { key: 'old_valuation_amount', header: 'Old amount', align: 'right', render: (r) => formatMoney(r.old_valuation_amount) },
      { key: 'new_valuation_amount', header: 'New amount', align: 'right', render: (r) => formatMoney(r.new_valuation_amount) },
      { key: 'delta_amount', header: 'Delta', align: 'right', sortKey: 'delta_amount', render: (r) => <strong className={(r.delta_amount ?? 0) < 0 ? 'text-critical' : undefined}>{formatMoney(r.delta_amount)}</strong> },
      { key: 'job_id', header: 'Job', render: (r) => (r.job_id ? <Link to={`/valuation/recalculations?all_fy=1`}>#{r.job_id}</Link> : '—') },
      { key: 'acknowledged_at', header: 'Acknowledged', render: (r) => (r.acknowledged_at ? `${formatDateTime(r.acknowledged_at)} · ${r.acknowledged_by_app ?? ''}` : '—') },
    ],
    [canAck, selected],
  )
  const csvColumns = useMemo(() => columns.filter((c) => !['pick', 'document', 'source', 'job_id'].includes(c.key)).map((c) => ({ header: String(c.header), value: (r: ValuationRevision) => (r[c.key as keyof ValuationRevision] as string | number | null) ?? '' })), [columns])

  return (
    <>
      <PageHeader
        title="Valuation revisions"
        subtitle="Line-level cost changes produced by recalculations. Books acknowledges each one after it has re-posted the COGS; anything unacknowledged shows up in reconciliation."
        actions={
          <>
            {canAck ? <button type="button" className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={ack}>{busy ? 'Acknowledging…' : `Acknowledge selected (${selected.size})`}</button> : null}
            <ExportCsvButton filename={csvFilename('valuation-revisions', companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<ValuationRevision>((page, limit) => valuationApi.revisions({ ...query, page, limit }))} disabled={rows.length === 0} />
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
