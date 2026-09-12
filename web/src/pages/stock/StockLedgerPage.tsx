import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { ItemFilter } from '../../components/ItemFilter'
import { Notice } from '../../components/Notice'
import { PageHeader } from '../../components/PageHeader'
import { Pagination } from '../../components/Pagination'
import { RequirePermission } from '../../components/RequirePermission'
import { StatusBadge } from '../../components/StatusBadge'
import { SummaryStrip } from '../../components/SummaryStrip'
import { WarehouseSelect } from '../../documents/WarehouseSelect'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { fetchAllRows } from '../../services/listAll'
import { stockLedgerApi } from '../../services/stockViewsApi'
import type { LedgerRow } from '../../services/stockViewsApi'
import { csvFilename } from '../../utils/csv'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['item_id', 'warehouse_id', 'from', 'to'] as const

export function StockLedgerPage() {
  const { scope, fyRange, companyName } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'movement_date', limit: 100, filterKeys: FILTER_KEYS })
  const { state } = params
  const itemId = state.filters.item_id ?? ''
  const from = state.filters.from ?? fyRange.from
  const to = state.filters.to ?? fyRange.to
  const query = useMemo(() => ({ ...params.query, item_id: itemId, from, to }), [params.query, itemId, from, to])
  const ledger = useQuery((signal) => stockLedgerApi.get(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null && itemId !== '' })
  const rows = ledger.data?.data ?? []
  const summary = ledger.data?.summary
  const item = ledger.data?.item

  const columns = useMemo<Column<LedgerRow>[]>(
    () => [
      { key: 'movement_date', header: 'Date', sortKey: 'movement_date', render: (r) => formatDate(r.movement_date) },
      { key: 'document', header: 'Document', render: (r) => <Link to={`/documents/${r.document_id}`}>{r.document_no ?? `#${r.document_id}`}</Link> },
      { key: 'document_type_label', header: 'Type', render: (r) => r.document_type_label ?? r.document_type },
      { key: 'source', header: 'Source', render: (r) => (r.source_app ? <span>{r.source_app}{r.source_document_no ? ` · ${r.source_document_no}` : ''}</span> : <span className="muted">—</span>) },
      { key: 'party_name', header: 'Party / narration', render: (r) => r.party_name ?? r.narration ?? <span className="muted">—</span> },
      { key: 'warehouse_name', header: 'Warehouse', render: (r) => r.warehouse_name ?? <span className="muted">—</span> },
      { key: 'batch_no', header: 'Batch', render: (r) => r.batch_no ?? <span className="muted">—</span> },
      { key: 'in_qty', header: 'In', align: 'right', render: (r) => (r.in_qty ? formatQty(r.in_qty) : '') },
      { key: 'out_qty', header: 'Out', align: 'right', render: (r) => (r.out_qty ? formatQty(r.out_qty) : '') },
      { key: 'unit_cost', header: 'Rate', align: 'right', render: (r) => formatMoney(r.unit_cost) },
      { key: 'value', header: 'Value', align: 'right', render: (r) => formatMoney(r.value) },
      { key: 'balance_qty', header: 'Balance', align: 'right', render: (r) => <strong>{formatQty(r.balance_qty)}</strong> },
      { key: 'balance_value', header: 'Balance value', align: 'right', render: (r) => formatMoney(r.balance_value) },
      { key: 'movement_kind', header: 'Kind', render: (r) => (r.movement_kind === 'physical' ? <span className="muted">physical</span> : <StatusBadge value={r.movement_kind} tone={r.movement_kind === 'reversal' ? 'warning' : 'info'} />) },
    ],
    [],
  )
  const csvColumns = useMemo(() => columns.filter((c) => c.key !== 'document' && c.key !== 'source').map((c) => ({ header: String(c.header), value: (r: LedgerRow) => (r[c.key as keyof LedgerRow] as string | number | null) ?? '' })), [columns])

  return (
    <>
      <PageHeader
        title={item ? `Stock ledger — ${item.item_name ?? `Item #${item.item_id}`}` : 'Stock ledger'}
        subtitle={item ? `${item.item_sku ? `${item.item_sku} · ` : ''}${item.grp_name ?? ''}${item.unit_symbol ? ` · in ${item.unit_symbol}` : ''} · valued ${item.valuation_method ?? 'as per company default'}` : 'Pick an item to see every movement with its running quantity and value.'}
        actions={<ExportCsvButton filename={csvFilename(`stock-ledger-${item?.item_sku ?? itemId}`, companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<LedgerRow>((page, limit) => stockLedgerApi.get({ ...query, page, limit }))} disabled={rows.length === 0} />}
      />
      <RequirePermission permission={P.report('stock_ledger')} what="the stock ledger">
        <div className="toolbar">
          <ItemFilter value={itemId} onChange={(id) => params.setFilter('item_id', id)} placeholder="Item…" />
          <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
          <input className="input date" type="date" value={from} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From" />
          <input className="input date" type="date" value={to} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        {itemId === '' ? (
          <Notice kind="info">Choose an item to load its ledger.</Notice>
        ) : (
          <>
            {summary ? (
              <SummaryStrip
                items={[
                  { label: 'Opening', value: formatQty(summary.opening_qty), hint: formatMoney(summary.opening_value) },
                  { label: 'In', value: formatQty(summary.in_qty), hint: formatMoney(summary.in_value), tone: 'good' },
                  { label: 'Out', value: formatQty(summary.out_qty), hint: formatMoney(summary.out_value), tone: 'warning' },
                  { label: 'Closing', value: formatQty(summary.closing_qty), hint: formatMoney(summary.closing_value) },
                ]}
              />
            ) : null}
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.movement_id} loading={ledger.loading} error={ledger.error} emptyMessage="No movements in this period." rowClassName={(r) => (r.movement_kind === 'reversal' ? 'row-warning' : undefined)} />
            <Pagination meta={ledger.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
          </>
        )}
      </RequirePermission>
    </>
  )
}
