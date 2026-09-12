import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '../company/CompanyContext'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { ItemPicker } from '../components/ItemPicker'
import type { PickedItem } from '../components/ItemPicker'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { documentsApi } from '../services/documentsApi'
import { formatDate, formatInt, formatMoney } from '../utils/format'
import { NewDocumentMenu } from './NewDocumentMenu'
import { WarehouseSelect } from './WarehouseSelect'
import { STATUS_LABELS } from './actions'
import { NATIVE_DOCUMENT_TYPES, labelForCode } from './registry'
import { DOCUMENT_STATUSES } from './types'
import type { DocumentListRow, DocumentStatus } from './types'
import { useReferenceData } from './useReferenceData'
import './documents.css'

const FILTER_KEYS = ['document_type', 'status', 'from', 'to', 'warehouse_id', 'item_id'] as const

const SOURCED_TYPES = ['SALES_ISSUE', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'PURCHASE_RETURN', 'JOURNAL_ADJUSTMENT', 'RESERVATION', 'RESERVATION_RELEASE']

export function DocumentsListPage() {
  const navigate = useNavigate()
  const { scope } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'document_date', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const [pickedItem, setPickedItem] = useState<PickedItem | null>(null)

  const list = useQuery((signal) => documentsApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })

  const columns = useMemo<Column<DocumentListRow>[]>(
    () => [
      { key: 'document_date', header: 'Date', sortKey: 'document_date', render: (r) => formatDate(r.document_date), width: '7rem' },
      { key: 'document_type', header: 'Type', sortKey: 'document_type', render: (r) => r.document_type_label ?? labelForCode(r.document_type) },
      { key: 'document_no', header: 'Number', sortKey: 'document_no', render: (r) => <span className="mono">{r.document_no ?? `#${r.document_id}`}</span> },
      { key: 'party_name', header: 'Party', render: (r) => r.party_name ?? (r.party_ref ? `#${r.party_ref}` : <span className="muted">—</span>) },
      { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} label={STATUS_LABELS[r.status as DocumentStatus] ?? r.status} /> },
      { key: 'line_count', header: 'Lines', align: 'right', render: (r) => formatInt(r.line_count) },
      { key: 'valuation_total', header: 'Value', align: 'right', render: (r) => (Number(r.valuation_total) ? formatMoney(r.valuation_total) : <span className="muted">—</span>) },
      { key: 'source_app', header: 'Source', render: (r) => (r.source_app === 'inventory' ? <span className="muted">Inventory</span> : `${r.source_app}${r.source_document_no ? ` · ${r.source_document_no}` : ''}`) },
    ],
    [],
  )

  const itemFilter = state.filters.item_id ?? ''

  return (
    <div className="page">
      <PageHeader title="Inventory documents" subtitle="Every stock document in the selected company, financial year and branch." actions={<NewDocumentMenu />} />
      <div className="toolbar">
        <SearchInput value={state.q} onChange={params.setQ} placeholder="Search number, party or source…" />
        <select className="select" value={state.filters.document_type ?? ''} onChange={(e) => params.setFilter('document_type', e.target.value)} aria-label="Document type">
          <option value="">All types</option>
          <optgroup label="Inventory">
            {NATIVE_DOCUMENT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="From other products">
            {SOURCED_TYPES.map((c) => (
              <option key={c} value={c}>
                {labelForCode(c)}
              </option>
            ))}
          </optgroup>
        </select>
        <select className="select" value={state.filters.status ?? ''} onChange={(e) => params.setFilter('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input type="date" className="input" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From date" />
        <input type="date" className="input" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To date" />
        <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
        <div className="grow" style={{ maxWidth: '20rem' }}>
          {itemFilter && !pickedItem ? (
            <div className="typeahead-selected">
              <span>Item #{itemFilter}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => params.setFilter('item_id', '')}>
                Clear
              </button>
            </div>
          ) : (
            <ItemPicker
              value={pickedItem}
              placeholder="Filter by item…"
              onChange={(it) => {
                setPickedItem(it)
                params.setFilter('item_id', it ? String(it.item_id) : '')
              }}
            />
          )}
        </div>
        {state.q || Object.keys(state.filters).length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setPickedItem(null)
              params.reset()
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(r) => r.document_id}
        loading={list.loading}
        error={list.error}
        emptyMessage="No documents match these filters."
        sort={{ key: state.sort, order: state.order }}
        onSort={params.toggleSort}
        onRowClick={(r) => navigate(`/documents/${r.document_id}`)}
      />
      <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
    </div>
  )
}
