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
import { SummaryStrip } from '../../components/SummaryStrip'
import { WarehouseSelect } from '../../documents/WarehouseSelect'
import { useReferenceData } from '../../documents/useReferenceData'
import { useListParams } from '../../hooks/useListParams'
import { useQuery } from '../../hooks/useQuery'
import { P } from '../../services/access'
import { fetchAllRows } from '../../services/listAll'
import { stockBalancesApi } from '../../services/stockViewsApi'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import { csvFilename } from '../../utils/csv'
import { formatDateTime, formatQty, toNumber } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['warehouse_id', 'item_id', 'nonzero'] as const
const QTY_COLUMNS: { key: keyof StockBalanceGridRow; header: string }[] = [
  { key: 'on_hand_qty', header: 'On hand' },
  { key: 'reserved_qty', header: 'Reserved' },
  { key: 'committed_qty', header: 'Committed' },
  { key: 'packed_qty', header: 'Packed' },
  { key: 'in_transit_qty', header: 'In transit' },
  { key: 'job_worker_qty', header: 'Job worker' },
  { key: 'quality_hold_qty', header: 'On hold' },
  { key: 'damaged_qty', header: 'Damaged' },
  { key: 'blocked_qty', header: 'Blocked' },
  { key: 'expected_qty', header: 'Expected' },
]

export function StockBalancesPage() {
  const { scope, companyName } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'item_name', limit: 100, filterKeys: FILTER_KEYS })
  const { state } = params
  const nonzero = state.filters.nonzero !== '0'
  const query = useMemo(() => ({ ...params.query, nonzero: nonzero ? 1 : 0 }), [params.query, nonzero])
  const list = useQuery((signal) => stockBalancesApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const rows = list.data?.data ?? []

  const columns = useMemo<Column<StockBalanceGridRow>[]>(
    () => [
      { key: 'item_name', header: 'Item', sortKey: 'item_name', render: (r) => <Link to={`/stock/ledger?item_id=${r.item_id}${r.warehouse_id ? `&warehouse_id=${r.warehouse_id}` : ''}`}>{r.item_name ?? `Item #${r.item_id}`}{r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}</Link> },
      { key: 'warehouse_name', header: 'Warehouse', sortKey: 'warehouse_id', render: (r) => r.warehouse_name ?? <span className="muted">(none)</span> },
      { key: 'batch_no', header: 'Batch', render: (r) => r.batch_no ?? <span className="muted">—</span> },
      ...QTY_COLUMNS.map<Column<StockBalanceGridRow>>((c) => ({ key: c.key, header: c.header, align: 'right', sortKey: c.key, render: (r) => formatQty(r[c.key]) })),
      { key: 'available_qty', header: 'Available', align: 'right', sortKey: 'available_qty', render: (r) => <strong>{formatQty(r.available_qty)}</strong> },
      { key: 'last_movement_at', header: 'Last movement', sortKey: 'last_movement_at', render: (r) => formatDateTime(r.last_movement_at) },
    ],
    [],
  )
  const totals = useMemo(() => {
    const sum = (key: keyof StockBalanceGridRow) => rows.reduce((acc, r) => acc + (toNumber(r[key]) ?? 0), 0)
    return { on_hand: sum('on_hand_qty'), available: sum('available_qty'), reserved: sum('reserved_qty'), packed: sum('packed_qty') }
  }, [rows])
  const csvColumns = useMemo(() => columns.map((c) => ({ header: String(c.header), value: (r: StockBalanceGridRow) => (r[c.key as keyof StockBalanceGridRow] as string | number | null) ?? '' })), [columns])

  return (
    <>
      <PageHeader
        title="Stock balances"
        subtitle="Item × warehouse × batch, with every bucket that makes up on hand and what is actually available to promise."
        actions={<ExportCsvButton filename={csvFilename('stock-balances', companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<StockBalanceGridRow>((page, limit) => stockBalancesApi.list({ ...query, page, limit }))} disabled={rows.length === 0} />}
      />
      <RequirePermission permission={[P.report('warehouse_stock'), P.report('stock_summary')]} what="stock balances">
        <div className="toolbar">
          <ItemFilter value={state.filters.item_id ?? ''} onChange={(id) => params.setFilter('item_id', id)} />
          <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
          <label className="checkbox">
            <input type="checkbox" checked={nonzero} onChange={(e) => params.setFilter('nonzero', e.target.checked ? '' : '0')} /> Hide zero balances
          </label>
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        <SummaryStrip
          items={[
            { label: 'Rows', value: list.data?.meta.total ?? 0 },
            { label: 'On hand (page)', value: formatQty(totals.on_hand) },
            { label: 'Reserved (page)', value: formatQty(totals.reserved) },
            { label: 'Packed (page)', value: formatQty(totals.packed) },
            { label: 'Available (page)', value: formatQty(totals.available), tone: 'good' },
          ]}
        />
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.balance_id} loading={list.loading} error={list.error} emptyMessage="No stock balances match these filters." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} />
        <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
