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
import { METHOD_LABELS, REPORT_METHODS, valuationApi } from '../../services/valuationApi'
import type { ValuationSnapshotRow } from '../../services/valuationApi'
import { csvFilename } from '../../utils/csv'
import { formatInt, formatMoney, formatQty, todayIso } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['as_of', 'method', 'item_id', 'warehouse_id'] as const

export function ValuationSnapshotPage() {
  const { scope, companyName } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'item_name', limit: 100, filterKeys: FILTER_KEYS })
  const { state } = params
  const asOf = state.filters.as_of ?? todayIso()
  const method = state.filters.method ?? 'AS_PER_MASTER'
  const query = useMemo(() => ({ ...params.query, as_of: asOf, method }), [params.query, asOf, method])
  const snap = useQuery((signal) => valuationApi.snapshot(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null })
  const rows = snap.data?.data ?? []
  const s = snap.data?.summary

  const columns = useMemo<Column<ValuationSnapshotRow>[]>(
    () => [
      { key: 'item_name', header: 'Item', sortKey: 'item_name', render: (r) => <Link to={`/valuation/cost-layers?item_id=${r.item_id}`}>{r.item_name ?? `Item #${r.item_id}`}{r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}</Link> },
      { key: 'unit_symbol', header: 'Unit', render: (r) => r.unit_symbol ?? '—' },
      { key: 'valuation_method', header: 'Item method', render: (r) => r.valuation_method ?? <span className="muted">company default</span> },
      { key: 'closing_qty', header: 'Closing qty', align: 'right', sortKey: 'closing_qty', render: (r) => <strong>{formatQty(r.closing_qty)}</strong> },
      { key: 'unit_cost', header: 'Unit cost', align: 'right', sortKey: 'unit_cost', render: (r) => formatMoney(r.unit_cost) },
      { key: 'stock_value', header: 'Stock value', align: 'right', sortKey: 'stock_value', render: (r) => <strong>{formatMoney(r.stock_value)}</strong> },
      { key: 'valuation_method_applied', header: 'Applied', render: (r) => r.valuation_method_applied ?? '—' },
    ],
    [],
  )
  const csvColumns = useMemo(() => columns.map((c) => ({ header: String(c.header), value: (r: ValuationSnapshotRow) => (r[c.key as keyof ValuationSnapshotRow] as string | number | null) ?? '' })), [columns])

  return (
    <>
      <PageHeader
        title="Stock valuation"
        subtitle="Closing quantity, unit cost and value per item as at a date. Switch the method to compare FIFO, LIFO and weighted average with what the item masters prescribe."
        actions={<ExportCsvButton filename={csvFilename(`valuation-${method}-${asOf}`, companyName)} columns={csvColumns} rows={rows} fetchAll={() => fetchAllRows<ValuationSnapshotRow>((page, limit) => valuationApi.snapshot({ ...query, page, limit }))} disabled={rows.length === 0} />}
      />
      <RequirePermission permission={P.report('valuation')} what="stock valuation">
        <div className="toolbar">
          <input className="input date" type="date" value={asOf} onChange={(e) => params.setFilter('as_of', e.target.value)} aria-label="As at" />
          <select className="select" value={method} onChange={(e) => params.setFilter('method', e.target.value)} aria-label="Valuation method">
            {REPORT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          <ItemFilter value={state.filters.item_id ?? ''} onChange={(id) => params.setFilter('item_id', id)} />
          <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="Whole company" />
          {Object.keys(state.filters).length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
              Reset
            </button>
          ) : null}
        </div>
        {s ? (
          <SummaryStrip
            items={[
              { label: 'As at', value: s.as_of, hint: METHOD_LABELS[s.method as keyof typeof METHOD_LABELS] ?? s.method },
              { label: 'Items', value: formatInt(s.item_count) },
              { label: 'Total qty', value: formatQty(s.total_qty) },
              { label: 'Total value', value: formatMoney(s.total_value), tone: 'good' },
            ]}
          />
        ) : null}
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.item_id} loading={snap.loading} error={snap.error} emptyMessage="No stock on hand at this date." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} />
        <Pagination meta={snap.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      </RequirePermission>
    </>
  )
}
