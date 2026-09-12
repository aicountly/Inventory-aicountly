import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { ItemFilter } from '../../components/ItemFilter'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { WarehouseSelect } from '../../documents/WarehouseSelect'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { fetchAllRows } from '../../services/listAll'
import { settingsApi } from '../../services/settingsApi'
import { stockMovementsApi } from '../../services/stockViewsApi'
import type { StockMovementRow } from '../../services/stockViewsApi'
import { csvFilename } from '../../utils/csv'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['item_id', 'warehouse_id', 'document_type', 'direction', 'movement_kind', 'from', 'to', 'document_id'] as const

export function StockMovementsPage() {
  const { scope, companyName } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'movement_date', order: 'desc', limit: 100, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const list = useQuery((signal) => stockMovementsApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const types = useQuery((signal) => settingsApi.documentTypes(signal), [scope?.cmp_id], { enabled: scope !== null })
  const rows = list.data?.data ?? []

  const columns = useMemo<Column<StockMovementRow>[]>(
    () => [
      { key: 'movement_date', header: 'Date', sortKey: 'movement_date', render: (r) => formatDate(r.movement_date) },
      { key: 'document', header: 'Document', render: (r) => (r.document_id ? <Link to={`/documents/${r.document_id}`}>{r.document_no ?? `#${r.document_id}`}</Link> : <span className="muted">—</span>) },
      { key: 'document_type', header: 'Type', sortKey: 'document_type', render: (r) => r.document_type_label ?? r.document_type },
      { key: 'item_name', header: 'Item', sortKey: 'item_id', render: (r) => <Link to={`/stock/ledger?item_id=${r.item_id}`}>{r.item_name ?? `Item #${r.item_id}`}</Link> },
      { key: 'warehouse_name', header: 'Warehouse', render: (r) => r.warehouse_name ?? <span className="muted">—</span> },
      { key: 'batch_no', header: 'Batch', render: (r) => r.batch_no ?? <span className="muted">—</span> },
      { key: 'direction', header: 'Dir.', sortKey: 'direction', render: (r) => <StatusBadge value={r.direction} tone={r.direction === 'in' ? 'good' : 'warning'} /> },
      { key: 'qty', header: 'Qty', align: 'right', sortKey: 'qty', render: (r) => <strong>{formatQty(r.qty)} {r.unit_symbol ?? ''}</strong> },
      { key: 'unit_cost', header: 'Rate', align: 'right', render: (r) => formatMoney(r.unit_cost) },
      { key: 'value', header: 'Value', align: 'right', sortKey: 'value', render: (r) => formatMoney(r.value) },
      { key: 'movement_kind', header: 'Kind', render: (r) => (r.movement_kind === 'physical' ? <span className="muted">physical</span> : <StatusBadge value={r.movement_kind} tone={r.movement_kind === 'reversal' ? 'warning' : 'info'} />) },
      { key: 'source', header: 'Source', render: (r) => (r.source_app ? `${r.source_app} · ${r.source_document_no ?? r.source_document_id ?? ''}` : <span className="muted">—</span>) },
      { key: 'party_name', header: 'Party', render: (r) => r.party_name ?? <span className="muted">—</span> },
    ],
    [],
  )
  const csvColumns = useMemo(() => columns.filter((c) => c.key !== 'document').map((c) => ({ header: String(c.header), value: (r: StockMovementRow) => (r[c.key as keyof StockMovementRow] as string | number | null) ?? '' })), [columns])

  return (
    <>
      <PageHeader
        title="Stock movements"
        subtitle="Every posted movement in the selected year and branch — physical receipts and issues, reversals and revaluations."
        actions={<ExportCsvButton filename={csvFilename('stock-movements', companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<StockMovementRow>((page, limit) => stockMovementsApi.list({ ...query, page, limit }))} disabled={rows.length === 0} />}
      />
      <RequirePermission permission={[P.report('stock_ledger'), P.documentsRead]} what="stock movements">
        <div className="toolbar">
          <ItemFilter value={state.filters.item_id ?? ''} onChange={(id) => params.setFilter('item_id', id)} />
          <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
          <select className="select" value={state.filters.document_type ?? ''} onChange={(e) => params.setFilter('document_type', e.target.value)} aria-label="Document type">
            <option value="">All types</option>
            {(types.data ?? []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          <select className="select" value={state.filters.direction ?? ''} onChange={(e) => params.setFilter('direction', e.target.value)} aria-label="Direction">
            <option value="">In and out</option>
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>
          <select className="select" value={state.filters.movement_kind ?? ''} onChange={(e) => params.setFilter('movement_kind', e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>
            <option value="physical">Physical</option>
            <option value="reversal">Reversal</option>
            <option value="revaluation">Revaluation</option>
          </select>
          <input className="input date" type="date" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From" />
          <input className="input date" type="date" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.movement_id} loading={list.loading} error={list.error} emptyMessage="No movements match these filters." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} rowClassName={(r) => (r.movement_kind === 'reversal' ? 'row-warning' : undefined)} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
