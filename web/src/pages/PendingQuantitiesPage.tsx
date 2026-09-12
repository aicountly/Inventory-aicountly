import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../company/CompanyContext'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { labelForCode } from '../documents/registry'
import { useReferenceData } from '../documents/useReferenceData'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { pendingApi } from '../services/stockApi'
import type { PendingRow } from '../services/stockApi'
import { formatDate, formatQty } from '../utils/format'
import '../documents/documents.css'

const FILTER_KEYS = ['kind', 'direction', 'warehouse_id', 'party_ref'] as const

export function PendingQuantitiesPage() {
  const { scope } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'document_date', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => pendingApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })

  const columns = useMemo<Column<PendingRow>[]>(
    () => [
      { key: 'document', header: 'Document', render: (r) => <Link to={`/documents/${r.document_id}`}>{r.document_no ?? `#${r.document_id}`}</Link> },
      { key: 'document_type', header: 'Type', render: (r) => r.document_type_label ?? labelForCode(r.document_type) },
      { key: 'document_date', header: 'Date', render: (r) => formatDate(r.document_date) },
      { key: 'pending_kind', header: 'Kind', render: (r) => r.pending_kind.replace(/_/g, ' ') },
      { key: 'direction', header: 'Dir.' },
      { key: 'item_name', header: 'Item', render: (r) => r.item_name ?? `Item #${r.item_id}` },
      { key: 'warehouse_name', header: 'Warehouse', render: (r) => r.warehouse_name ?? <span className="muted">—</span> },
      { key: 'party_ref', header: 'Party', render: (r) => (r.party_ref ? `#${r.party_ref}` : <span className="muted">—</span>) },
      { key: 'qty_original', header: 'Original', align: 'right', render: (r) => formatQty(r.qty_original) },
      { key: 'qty_settled', header: 'Settled', align: 'right', render: (r) => formatQty(r.qty_settled) },
      { key: 'qty_open', header: 'Open', align: 'right', render: (r) => <strong>{formatQty(r.qty_open)} {r.unit_symbol ?? ''}</strong> },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} tone={r.status === 'partial' ? 'info' : 'warning'} /> },
    ],
    [],
  )

  return (
    <div className="page">
      <PageHeader title="Pending quantities" subtitle={`Goods out on challan, in on inward challan, with a job worker, or invoiced but not received.${list.data?.summary ? ` Open in total: ${formatQty(list.data.summary.qty_open)} across ${list.data.summary.rows} rows.` : ''}`} />
      <div className="toolbar">
        <select className="select" value={state.filters.kind ?? ''} onChange={(e) => params.setFilter('kind', e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          <option value="challan">Challan</option>
          <option value="deferred_purchase">Deferred purchase</option>
          <option value="job_work">Job work</option>
        </select>
        <select className="select" value={state.filters.direction ?? ''} onChange={(e) => params.setFilter('direction', e.target.value)} aria-label="Direction">
          <option value="">In and out</option>
          <option value="out">Out</option>
          <option value="in">In</option>
        </select>
        <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
        <input className="input" inputMode="numeric" placeholder="Party ledger id" value={state.filters.party_ref ?? ''} onChange={(e) => params.setFilter('party_ref', e.target.value.replace(/[^\d]/g, ''))} aria-label="Party ledger id" />
        {Object.keys(state.filters).length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
            Reset
          </button>
        ) : null}
      </div>
      <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => r.pending_id} loading={list.loading} error={list.error} emptyMessage="Nothing pending." />
      <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
    </div>
  )
}
