import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { JsonBlock } from '../../components/JsonBlock'
import { ListSheetActions } from '../../components/ListSheetActions'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import type { ExportableColumn } from '../../registers/registerCells'
import { P } from '../../services/access'
import { AUDIT_ENTITY_TYPES, auditApi } from '../../services/auditApi'
import type { AuditLogRow } from '../../services/auditApi'
import { fetchAllRows } from '../../services/listAll'
import { formatDateTime, humanize } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['entity_type', 'entity_id', 'action_prefix', 'actor_uuid', 'source_app', 'source_document_id', 'request_id', 'from', 'to'] as const

/**
 * The sheet's columns.
 *
 * The before / after snapshots stay in, and stay last. They are the reason an
 * auditor asks for this file at all, and a sheet that showed only the changed
 * field names would answer a different question than the one that was asked.
 */
const EXPORT_COLUMNS: ExportableColumn<AuditLogRow>[] = [
  { key: 'created_at', csvHeader: 'When', format: 'datetime' },
  { key: 'action', csvHeader: 'Action' },
  { key: 'entity_type', csvHeader: 'Entity type', csv: (r) => humanize(r.entity_type) },
  { key: 'entity_id', csvHeader: 'Entity id', align: 'right', format: 'int' },
  { key: 'actor_uuid', csvHeader: 'Actor', csv: (r) => r.actor_uuid ?? 'system' },
  { key: 'source_app', csvHeader: 'Source app', csv: (r) => r.source_app ?? '' },
  { key: 'source_document', csvHeader: 'Source document', csv: (r) => (r.source_document_id ? `${r.source_document_type ?? ''} #${r.source_document_id}`.trim() : '') },
  { key: 'reason', csvHeader: 'Reason', csv: (r) => r.reason ?? '' },
  { key: 'changed_fields', csvHeader: 'Changed fields', csv: (r) => Object.keys(r.after ?? {}).join('; ') },
  { key: 'before', csvHeader: 'Before', csv: (r) => (r.before ? JSON.stringify(r.before) : '') },
  { key: 'after', csvHeader: 'After', csv: (r) => (r.after ? JSON.stringify(r.after) : '') },
  { key: 'request_id', csvHeader: 'Request id', csv: (r) => r.request_id ?? '' },
  { key: 'ip_address', csvHeader: 'IP', csv: (r) => r.ip_address ?? '' },
]

function entityLink(r: AuditLogRow) {
  const label = `${r.entity_type.replace(/_/g, ' ')} #${r.entity_id}`
  if (r.entity_type === 'document') return <Link to={`/documents/${r.entity_id}`}>{label}</Link>
  if (r.entity_type === 'item') return <Link to={`/items/${r.entity_id}`}>{label}</Link>
  if (r.entity_type === 'reconciliation_run') return <Link to={`/reconciliation/${r.entity_id}`}>{label}</Link>
  return label
}

export function AuditLogPage() {
  const { scope } = useCompany()
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

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="Who changed what, when — masters, documents, valuation, settings and access. Entries are append-only; before / after snapshots are kept for every write."
        actions={
          <ListSheetActions<AuditLogRow>
            columns={EXPORT_COLUMNS}
            rows={rows}
            fetchAll={() => fetchAllRows<AuditLogRow>((page, limit) => auditApi.list({ ...query, page, limit }))}
            filenameBase="audit-log"
            title="Audit log"
            description="Append-only record of every write, with the before and after snapshot"
            metaLines={[
              state.filters.entity_type ? `Entity: ${humanize(state.filters.entity_type)}${state.filters.entity_id ? ` #${state.filters.entity_id}` : ''}` : '',
              state.filters.action_prefix ? `Action starts with: ${state.filters.action_prefix}` : '',
              state.filters.actor_uuid ? `Actor: ${state.filters.actor_uuid}` : '',
              state.filters.source_app ? `Source app: ${state.filters.source_app}` : '',
              state.filters.from || state.filters.to ? `Between: ${state.filters.from || '…'} and ${state.filters.to || '…'}` : '',
            ].filter(Boolean)}
            onRefresh={list.reload}
            refreshing={list.loading}
            disabled={!list.data || list.data.meta.total === 0}
          />
        }
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
