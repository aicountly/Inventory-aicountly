import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { JsonBlock } from '../../components/JsonBlock'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { AUDIT_ENTITY_TYPES, auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { fetchAllRows } from '../../services/listAll'
import { csvFilename } from '../../utils/csv'
import { formatDateTime } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['entity_type', 'entity_id', 'action_prefix', 'actor_uuid', 'source_app', 'source_document_id', 'request_id', 'from', 'to'] as const

function entityLink(r: AuditLogRow) {
  const label = `${r.entity_type.replace(/_/g, ' ')} #${r.entity_id}`
  if (r.entity_type === 'document') return <Link to={`/documents/${r.entity_id}`}>{label}</Link>
  if (r.entity_type === 'item') return <Link to={`/items/${r.entity_id}`}>{label}</Link>
  if (r.entity_type === 'reconciliation_run') return <Link to={`/reconciliation/${r.entity_id}`}>{label}</Link>
  return label
}

export function AuditLogPage() {
  const { scope, companyName } = useCompany()
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => auditApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id], { enabled: scope !== null })
  const rows = list.data?.data ?? []
  const [detail, setDetail] = useState<AuditLogRow | null>(null)

  const columns = useMemo<Column<AuditLogRow>[]>(
    () => [
      { key: 'created_at', header: 'When', sortKey: 'created_at', render: (r) => <button type="button" className="link" onClick={() => setDetail(r)}>{formatDateTime(r.created_at)}</button> },
      { key: 'action', header: 'Action', sortKey: 'action', render: (r) => <code>{r.action}</code> },
      { key: 'entity', header: 'Entity', render: entityLink },
      { key: 'actor_uuid', header: 'Actor', render: (r) => r.actor_uuid ?? <span className="muted">system</span> },
      { key: 'source', header: 'Source', render: (r) => (r.source_app ? `${r.source_app}${r.source_document_type ? ` · ${r.source_document_type}` : ''}${r.source_document_id ? ` #${r.source_document_id}` : ''}` : <span className="muted">—</span>) },
      { key: 'reason', header: 'Reason', render: (r) => r.reason ?? <span className="muted">—</span> },
      { key: 'changes', header: 'Changed fields', render: (r) => { const keys = Object.keys(r.after ?? {}); return keys.length ? keys.slice(0, 6).join(', ') + (keys.length > 6 ? '…' : '') : <span className="muted">—</span> } },
      { key: 'request_id', header: 'Request', render: (r) => (r.request_id ? <code className="small">{r.request_id.slice(0, 12)}</code> : '—') },
    ],
    [],
  )
  const csvColumns = useMemo(() => [
    { header: 'When', value: (r: AuditLogRow) => r.created_at },
    { header: 'Action', value: (r: AuditLogRow) => r.action },
    { header: 'Entity type', value: (r: AuditLogRow) => r.entity_type },
    { header: 'Entity id', value: (r: AuditLogRow) => r.entity_id },
    { header: 'Actor', value: (r: AuditLogRow) => r.actor_uuid },
    { header: 'Source app', value: (r: AuditLogRow) => r.source_app },
    { header: 'Source document', value: (r: AuditLogRow) => r.source_document_id },
    { header: 'Reason', value: (r: AuditLogRow) => r.reason },
    { header: 'Before', value: (r: AuditLogRow) => (r.before ? JSON.stringify(r.before) : '') },
    { header: 'After', value: (r: AuditLogRow) => (r.after ? JSON.stringify(r.after) : '') },
    { header: 'Request id', value: (r: AuditLogRow) => r.request_id },
    { header: 'IP', value: (r: AuditLogRow) => r.ip_address },
  ], [])

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="Who changed what, when — masters, documents, valuation, settings and access. Entries are append-only; before / after snapshots are kept for every write."
        actions={<ExportCsvButton filename={csvFilename('audit-log', companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<AuditLogRow>((page, limit) => auditApi.list({ ...query, page, limit }))} disabled={rows.length === 0} />}
      />
      <RequirePermission permission={P.auditRead} what="the audit log">
        <div className="toolbar">
          <select className="select" value={state.filters.entity_type ?? ''} onChange={(e) => params.setFilter('entity_type', e.target.value)} aria-label="Entity type">
            <option value="">All entities</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input className="input short" inputMode="numeric" placeholder="Entity id" value={state.filters.entity_id ?? ''} onChange={(e) => params.setFilter('entity_id', e.target.value.replace(/[^\d]/g, ''))} aria-label="Entity id" />
          <input className="input" placeholder="Action starts with (document.post…)" value={state.filters.action_prefix ?? ''} onChange={(e) => params.setFilter('action_prefix', e.target.value)} aria-label="Action prefix" />
          <input className="input" placeholder="Actor uuid" value={state.filters.actor_uuid ?? ''} onChange={(e) => params.setFilter('actor_uuid', e.target.value)} aria-label="Actor" />
          <input className="input short" placeholder="Source app" value={state.filters.source_app ?? ''} onChange={(e) => params.setFilter('source_app', e.target.value)} aria-label="Source app" />
          <input className="input date" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From" />
          <input className="input date" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.audit_id} loading={list.loading} error={list.error} emptyMessage="No audit entries match these filters." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
      <Modal open={detail !== null} title={detail ? `${detail.action} — ${detail.entity_type} #${detail.entity_id}` : ''} onClose={() => setDetail(null)} size="lg">
        {detail ? (
          <div className="stack">
            <p className="muted">{formatDateTime(detail.created_at)} · actor {detail.actor_uuid ?? 'system'}{detail.source_app ? ` · via ${detail.source_app}` : ''}{detail.ip_address ? ` · ${detail.ip_address}` : ''}{detail.request_id ? ` · request ${detail.request_id}` : ''}</p>
            {detail.reason ? <p>Reason: {detail.reason}</p> : null}
            <JsonBlock value={detail.before} label="Before" open />
            <JsonBlock value={detail.after} label="After" open />
            {detail.meta ? <JsonBlock value={detail.meta} label="Meta" /> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
