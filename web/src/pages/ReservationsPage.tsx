import { useMemo, useState } from 'react'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { FormField } from '../components/FormField'
import { ItemPicker } from '../components/ItemPicker'
import type { PickedItem } from '../components/ItemPicker'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import { BatchPicker } from '../documents/BatchPicker'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { useReferenceData } from '../documents/useReferenceData'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { errorMessage } from '../services/api'
import { reservationsApi } from '../services/stockApi'
import type { Reservation, ReservationFilters } from '../services/stockApi'
import { formatDateTime, formatQty, toNumber } from '../utils/format'
import '../documents/documents.css'

const FILTER_KEYS = ['status', 'item_id', 'warehouse_id', 'show'] as const

const CREATE_KEYS = ['documents.reservation.create', 'documents.create']
const RELEASE_KEYS = ['documents.reservation_release.create', 'documents.reservation.edit', 'documents.create']
const FULFIL_KEYS = ['documents.reservation.post', 'documents.reservation.edit', 'documents.create']

type Dialog = { kind: 'create' } | { kind: 'release'; row: Reservation } | { kind: 'fulfil'; row: Reservation } | null

function toServerTimestamp(local: string): string | null {
  if (!local) return null
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}:00` : local
}

export function ReservationsPage() {
  const { can } = useAccess()
  const { scope } = useCompany()
  const { warehouses, defaultWarehouseId } = useReferenceData()
  const params = useListParams({ sort: 'created_at', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const [tick, setTick] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [pickedItem, setPickedItem] = useState<PickedItem | null>(null)

  // create form
  const [item, setItem] = useState<PickedItem | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [batchId, setBatchId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [expires, setExpires] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [sourceId, setSourceId] = useState('')
  // release / fulfil
  const [partQty, setPartQty] = useState('')
  const [reason, setReason] = useState('')
  const [releaseRemainder, setReleaseRemainder] = useState(true)

  const listQuery = useMemo<ReservationFilters>(() => {
    const { show, ...rest } = query
    const q = { ...rest } as ReservationFilters
    if (!rest.status && show !== 'all') q.open = true
    return q
  }, [query])

  const list = useQuery((signal) => reservationsApi.list(listQuery, signal), [JSON.stringify(listQuery), scope?.cmp_id, scope?.fy_id, scope?.bo_id, tick], { enabled: scope !== null })

  const openCreate = () => {
    setItem(null)
    setWarehouseId(defaultWarehouseId)
    setBatchId(null)
    setQty('')
    setExpires('')
    setSourceType('')
    setSourceId('')
    setError(null)
    setDialog({ kind: 'create' })
  }

  const openRow = (kind: 'release' | 'fulfil', row: Reservation) => {
    setPartQty('')
    setReason('')
    setReleaseRemainder(true)
    setError(null)
    setDialog({ kind, row })
  }

  const confirm = async () => {
    if (!dialog) return
    setBusy(true)
    setError(null)
    try {
      if (dialog.kind === 'create') {
        const q = toNumber(qty)
        if (!item) throw new Error('Pick an item.')
        if (q === null || q <= 0) throw new Error('Quantity (base units) must be greater than zero.')
        const res = await reservationsApi.create({ item_id: item.item_id, qty: q, warehouse_id: warehouseId, batch_id: batchId, expires_at: toServerTimestamp(expires), source_document_type: sourceType.trim() || null, source_document_id: toNumber(sourceId) })
        setFlash(`Reserved ${formatQty(res.qty)} of ${res.item_name ?? item.item_name}${res.balance ? ` · available now ${formatQty(res.balance.available)}` : ''}.`)
      } else if (dialog.kind === 'release') {
        const res = await reservationsApi.release(dialog.row.reservation_id, { qty: toNumber(partQty), reason: reason.trim() || undefined })
        setFlash(`Released reservation #${res.reservation_id}${res.is_open ? ' partially' : ''}.`)
      } else {
        const res = await reservationsApi.fulfil(dialog.row.reservation_id, { qty: toNumber(partQty), release_remainder: releaseRemainder, reason: reason.trim() || undefined })
        setFlash(`Reservation #${res.reservation_id} ${res.status}.`)
      }
      setDialog(null)
      setTick((t) => t + 1)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo<Column<Reservation>[]>(
    () => [
      { key: 'item_name', header: 'Item', sortKey: 'item_name', render: (r) => <>{r.item_name ?? `Item #${r.item_id}`}{r.item_sku ? <span className="muted"> · {r.item_sku}</span> : null}</> },
      { key: 'warehouse_name', header: 'Warehouse', sortKey: 'warehouse_name', render: (r) => r.warehouse_name ?? (r.warehouse_id ? `#${r.warehouse_id}` : <span className="muted">any</span>) },
      { key: 'batch_no', header: 'Batch', render: (r) => r.batch_no ?? <span className="muted">—</span> },
      { key: 'qty', header: 'Reserved', sortKey: 'qty', align: 'right', render: (r) => `${formatQty(r.qty)} ${r.unit_symbol ?? ''}` },
      { key: 'fulfilled_qty', header: 'Fulfilled', align: 'right', render: (r) => formatQty(r.fulfilled_qty) },
      { key: 'open_qty', header: 'Open', align: 'right', render: (r) => <strong>{formatQty(r.open_qty)}</strong> },
      { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.is_expired ? 'expired' : r.status} tone={r.is_expired ? 'critical' : r.status === 'active' ? 'good' : r.status === 'partial' ? 'info' : 'neutral'} /> },
      { key: 'expires_at', header: 'Expires', sortKey: 'expires_at', render: (r) => formatDateTime(r.expires_at) },
      { key: 'source', header: 'Source', render: (r) => (r.source_document_type ? `${r.source_app} · ${r.source_document_type}${r.source_document_id ? ` #${r.source_document_id}` : ''}` : r.document_id ? `document #${r.document_id}` : <span className="muted">{r.source_app}</span>) },
      { key: 'created_at', header: 'Created', sortKey: 'created_at', render: (r) => formatDateTime(r.created_at) },
    ],
    [],
  )

  const dialogTitle = dialog?.kind === 'create' ? 'New reservation' : dialog?.kind === 'release' ? `Release reservation #${dialog.row.reservation_id}` : dialog?.kind === 'fulfil' ? `Fulfil reservation #${dialog.row.reservation_id}` : ''

  return (
    <div className="page">
      <PageHeader
        title="Reservations"
        subtitle="Soft allocations of available stock to an order or invoice draft. Quantities are in the item's base unit."
        actions={can(CREATE_KEYS) ? <button type="button" className="btn btn-primary" onClick={openCreate}>New reservation</button> : undefined}
      />
      <div className="toolbar">
        <select className="select" value={state.filters.status ?? (state.filters.show === 'all' ? 'all' : '')} onChange={(e) => { const v = e.target.value; if (v === 'all') { params.setFilter('status', ''); params.setFilter('show', 'all') } else { params.setFilter('show', ''); params.setFilter('status', v) } }} aria-label="Status">
          <option value="">Open (active, partial)</option>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="partial">Partially fulfilled</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="released">Released</option>
          <option value="expired">Expired</option>
        </select>
        <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
        <div className="grow" style={{ maxWidth: '20rem' }}>
          {state.filters.item_id && !pickedItem ? (
            <div className="typeahead-selected">
              <span>Item #{state.filters.item_id}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => params.setFilter('item_id', '')}>
                Clear
              </button>
            </div>
          ) : (
            <ItemPicker value={pickedItem} placeholder="Filter by item…" onChange={(it) => { setPickedItem(it); params.setFilter('item_id', it ? String(it.item_id) : '') }} />
          )}
        </div>
        {Object.keys(state.filters).length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPickedItem(null); params.reset() }}>
            Reset
          </button>
        ) : null}
      </div>
      {flash ? <Notice kind="success">{flash}</Notice> : null}
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(r) => r.reservation_id}
        loading={list.loading}
        error={list.error}
        emptyMessage="No reservations."
        sort={{ key: state.sort, order: state.order }}
        onSort={params.toggleSort}
        rowActions={(r) =>
          r.is_open ? (
            <>
              {can(RELEASE_KEYS) ? (
                <button type="button" className="btn btn-sm" onClick={() => openRow('release', r)}>
                  Release
                </button>
              ) : null}
              {can(FULFIL_KEYS) ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => openRow('fulfil', r)}>
                  Fulfil
                </button>
              ) : null}
            </>
          ) : null
        }
      />
      <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />

      <Modal
        open={dialog !== null}
        title={dialogTitle}
        onClose={() => setDialog(null)}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Working…' : dialog?.kind === 'create' ? 'Reserve' : dialog?.kind === 'release' ? 'Release' : 'Fulfil'}
            </button>
          </>
        }
      >
        {dialog?.kind === 'create' ? (
          <div className="form-grid">
            <FormField label="Item" required className="span-all">
              <ItemPicker value={item} onChange={(it) => { setItem(it); setBatchId(null) }} autoFocus />
            </FormField>
            <FormField label="Warehouse" htmlFor="res_wh" help="Empty = any warehouse (company-wide availability).">
              <WarehouseSelect id="res_wh" value={warehouseId} onChange={(id) => { setWarehouseId(id); setBatchId(null) }} warehouses={warehouses} emptyLabel="Any" />
            </FormField>
            {item && Number(item.track_batch) === 1 ? (
              <FormField label="Batch">
                <BatchPicker itemId={item.item_id} warehouseId={warehouseId} value={batchId} onChange={(b) => setBatchId(b?.batch_id ?? null)} allowCreate={false} />
              </FormField>
            ) : null}
            <FormField label={`Quantity${item?.unit_symbol ? ` (${item.unit_symbol})` : ''}`} htmlFor="res_qty" required help="Base units.">
              <input id="res_qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </FormField>
            <FormField label="Expires" htmlFor="res_exp" help="Optional; released automatically after this time.">
              <input id="res_exp" type="datetime-local" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </FormField>
            <FormField label="Source document type" htmlFor="res_src_type" help="e.g. sales.order">
              <input id="res_src_type" className="input" value={sourceType} onChange={(e) => setSourceType(e.target.value)} />
            </FormField>
            <FormField label="Source document id" htmlFor="res_src_id">
              <input id="res_src_id" className="input" inputMode="numeric" value={sourceId} onChange={(e) => setSourceId(e.target.value.replace(/[^\d]/g, ''))} />
            </FormField>
          </div>
        ) : dialog ? (
          <div className="form-grid">
            <div className="span-all" style={{ fontSize: '0.875rem' }}>
              {dialog.row.item_name ?? `Item #${dialog.row.item_id}`} · open <strong>{formatQty(dialog.row.open_qty)}</strong> {dialog.row.unit_symbol ?? ''}
              {dialog.row.warehouse_name ? ` · ${dialog.row.warehouse_name}` : ''}
            </div>
            <FormField label="Quantity" htmlFor="part_qty" help={`Leave empty to ${dialog.kind} the whole open quantity.`}>
              <input id="part_qty" className="input" inputMode="decimal" value={partQty} onChange={(e) => setPartQty(e.target.value)} autoFocus />
            </FormField>
            {dialog.kind === 'fulfil' ? (
              <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: '0.5rem' }}>
                <input type="checkbox" checked={releaseRemainder} onChange={(e) => setReleaseRemainder(e.target.checked)} />
                Release whatever remains open
              </label>
            ) : null}
            <FormField label="Reason (optional)" htmlFor="res_reason" className="span-all">
              <input id="res_reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </div>
        ) : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
      </Modal>
    </div>
  )
}
