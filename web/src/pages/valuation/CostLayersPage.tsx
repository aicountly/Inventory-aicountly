import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../../company/CompanyContext'
import { DataTable } from '../../components/DataTable'
import type { Column } from '../../components/DataTable'
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
import { valuationApi } from '../../services/valuationApi'
import type { CostLayerRow } from '../../services/valuationApi'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import '../views.css'

const FILTER_KEYS = ['item_id', 'warehouse_id', 'open_only', 'layer_kind', 'all_fy'] as const
const KIND_TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'info'> = { opening: 'neutral', receipt: 'good', backorder: 'critical', revaluation: 'info' }

export function CostLayersPage() {
  const { scope } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'received_at', limit: 100, filterKeys: FILTER_KEYS })
  const { state } = params
  const itemId = state.filters.item_id ?? ''
  const openOnly = state.filters.open_only !== '0'
  const query = useMemo(() => ({ ...params.query, item_id: itemId, open_only: openOnly ? 1 : 0 }), [params.query, itemId, openOnly])
  const layers = useQuery((signal) => valuationApi.costLayers(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id], { enabled: scope !== null && itemId !== '' })
  const rows = layers.data?.data ?? []
  const item = layers.data?.item
  const s = layers.data?.summary

  const columns = useMemo<Column<CostLayerRow>[]>(
    () => [
      { key: 'received_at', header: 'Received', sortKey: 'received_at', render: (r) => formatDate(r.received_at) },
      { key: 'layer_kind', header: 'Kind', render: (r) => <StatusBadge value={r.layer_kind} tone={KIND_TONE[r.layer_kind] ?? 'neutral'} /> },
      { key: 'source', header: 'Source document', render: (r) => (r.source_document_id ? <Link to={`/documents/${r.source_document_id}`}>{r.source_document_no ?? `#${r.source_document_id}`}</Link> : <span className="muted">—</span>) },
      { key: 'warehouse_name', header: 'Warehouse', render: (r) => r.warehouse_name ?? <span className="muted">—</span> },
      { key: 'qty_received', header: 'Received qty', align: 'right', render: (r) => formatQty(r.qty_received) },
      { key: 'qty_consumed', header: 'Consumed', align: 'right', render: (r) => formatQty(r.qty_consumed) },
      { key: 'qty_remaining', header: 'Remaining', align: 'right', sortKey: 'qty_remaining', render: (r) => <strong>{formatQty(r.qty_remaining)}</strong> },
      { key: 'unit_cost', header: 'Unit cost', align: 'right', sortKey: 'unit_cost', render: (r) => formatMoney(r.unit_cost) },
      { key: 'remaining_value', header: 'Remaining value', align: 'right', render: (r) => formatMoney(r.remaining_value) },
      {
        key: 'consumptions',
        header: 'Consumed by',
        render: (r) =>
          r.consumptions?.length ? (
            <details>
              <summary>{r.consumptions.length} issue{r.consumptions.length === 1 ? '' : 's'}</summary>
              <ul className="plain-list">
                {r.consumptions.map((c) => (
                  <li key={c.consumption_id}>
                    {c.document_id ? <Link to={`/documents/${c.document_id}`}>{c.document_no ?? `#${c.document_id}`}</Link> : 'movement'} · {formatDate(c.document_date)} · {formatQty(c.qty)} @ {formatMoney(c.unit_cost)} = {formatMoney(c.amount)}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <span className="muted">—</span>
          ),
      },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title={item ? `Cost layers — ${item.item_name}` : 'Cost layers'}
        subtitle={item ? `${item.item_sku ? `${item.item_sku} · ` : ''}valued ${item.valuation_method ?? 'as per company default'}. Each receipt opens a layer; issues consume layers in FIFO / LIFO order, weighted average pools them.` : 'Pick an item to see the receipt layers its valuation is built from and which issues consumed them.'}
      />
      <RequirePermission permission={P.report('valuation')} what="cost layers">
        <div className="toolbar">
          <ItemFilter value={itemId} onChange={(id) => params.setFilter('item_id', id)} placeholder="Item…" />
          <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
          <select className="select" value={state.filters.layer_kind ?? ''} onChange={(e) => params.setFilter('layer_kind', e.target.value)} aria-label="Layer kind">
            <option value="">All kinds</option>
            <option value="opening">Opening</option>
            <option value="receipt">Receipt</option>
            <option value="backorder">Backorder</option>
            <option value="revaluation">Revaluation</option>
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={openOnly} onChange={(e) => params.setFilter('open_only', e.target.checked ? '' : '0')} /> Open layers only
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={state.filters.all_fy === '1'} onChange={(e) => params.setFilter('all_fy', e.target.checked ? '1' : '')} /> All years
          </label>
        </div>
        {itemId === '' ? (
          <Notice kind="info">Choose an item to load its cost layers.</Notice>
        ) : (
          <>
            {s ? (
              <SummaryStrip
                items={[
                  { label: 'Open qty', value: formatQty(s.open_qty) },
                  { label: 'Open value', value: formatMoney(s.open_value), tone: 'good' },
                  { label: 'Backorder qty', value: formatQty(s.backorder_qty), tone: s.backorder_qty > 0 ? 'critical' : 'neutral', hint: s.backorder_qty > 0 ? 'issued below zero — costed at the last known rate until a receipt arrives' : undefined },
                ]}
              />
            ) : null}
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.layer_id} loading={layers.loading} error={layers.error} emptyMessage="No layers." sort={{ key: state.sort, order: state.order }} onSort={params.toggleSort} rowClassName={(r) => (r.layer_kind === 'backorder' ? 'row-critical' : undefined)} />
            <Pagination meta={layers.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
          </>
        )}
      </RequirePermission>
    </>
  )
}
