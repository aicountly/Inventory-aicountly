import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { useCompany } from '../company/CompanyContext'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { Pagination } from '../components/Pagination'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import { WarehouseSelect } from '../documents/WarehouseSelect'
import { STATUS_LABELS, canCreate, packingActions } from '../documents/actions'
import type { PackingAction } from '../documents/actions'
import type { DocumentStatus } from '../documents/types'
import { useReferenceData } from '../documents/useReferenceData'
import { useListParams } from '../hooks/useListParams'
import { useQuery } from '../hooks/useQuery'
import { errorMessage } from '../services/api'
import { packingApi } from '../services/stockApi'
import type { PackingListRow } from '../services/stockApi'
import { formatDate, formatDateTime, formatInt, formatQty } from '../utils/format'
import '../documents/documents.css'

const FILTER_KEYS = ['status', 'doc_status', 'from', 'to', 'warehouse_id'] as const

const PACKING_TONE: Record<string, 'good' | 'warning' | 'neutral' | 'info'> = { open: 'good', locked: 'warning', consumed: 'info', unpacked: 'neutral' }

export function PackingListsPage() {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { scope } = useCompany()
  const { warehouses } = useReferenceData()
  const params = useListParams({ sort: 'document_date', order: 'desc', limit: 50, filterKeys: FILTER_KEYS })
  const { state, query } = params
  const [tick, setTick] = useState(0)
  const [dialog, setDialog] = useState<{ row: PackingListRow; action: PackingAction } | null>(null)
  const [notes, setNotes] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const list = useQuery((signal) => packingApi.list(query, signal), [JSON.stringify(query), scope?.cmp_id, scope?.fy_id, scope?.bo_id, tick], { enabled: scope !== null })

  const confirm = async () => {
    if (!dialog) return
    setBusy(true)
    setError(null)
    try {
      const id = dialog.row.document_id
      if (dialog.action === 'unpack') await packingApi.unpack(id, notes.trim() || undefined)
      else if (dialog.action === 'lock') await packingApi.lock(id, notes.trim() ? { external_ref: notes.trim() } : {})
      else await packingApi.unlock(id, { external_ref: notes.trim() || undefined, force })
      setFlash(`${dialog.row.document_no ?? `#${id}`}: ${dialog.action === 'unpack' ? 'unpacked' : dialog.action === 'lock' ? 'locked' : 'unlocked'}.`)
      setDialog(null)
      setNotes('')
      setForce(false)
      setTick((t) => t + 1)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo<Column<PackingListRow>[]>(
    () => [
      { key: 'document_date', header: 'Date', sortKey: 'document_date', render: (r) => formatDate(r.document_date) },
      { key: 'document_no', header: 'Number', sortKey: 'document_no', render: (r) => <span className="mono">{r.document_no ?? `#${r.document_id}`}</span> },
      { key: 'party_name', header: 'Consignee', sortKey: 'party_name', render: (r) => r.party_name ?? (r.consignee_ref ? `#${r.consignee_ref}` : <span className="muted">—</span>) },
      { key: 'status', header: 'Document', sortKey: 'status', render: (r) => <StatusBadge value={r.status} label={STATUS_LABELS[r.status as DocumentStatus] ?? r.status} /> },
      { key: 'packing_status', header: 'Packing', sortKey: 'packing_status', render: (r) => (r.packing_status ? <StatusBadge value={r.packing_status} tone={PACKING_TONE[r.packing_status]} /> : <span className="muted">not posted</span>) },
      { key: 'line_count', header: 'Lines', align: 'right', render: (r) => formatInt(r.line_count) },
      { key: 'total_base_qty', header: 'Base qty', align: 'right', render: (r) => formatQty(r.total_base_qty) },
      { key: 'locked_at', header: 'Locked by', sortKey: 'locked_at', render: (r) => (r.packing_status === 'locked' || r.packing_status === 'consumed' ? `${r.locked_by_external_ref ?? (r.locked_by_document_id ? `doc #${r.locked_by_document_id}` : '—')}${r.locked_at ? ` · ${formatDateTime(r.locked_at)}` : ''}` : <span className="muted">—</span>) },
    ],
    [],
  )

  return (
    <div className="page">
      <PageHeader
        title="Packing lists"
        subtitle="Packed stock is held from availability until it is sold or unpacked. Locking reserves a list for a sale being keyed."
        actions={canCreate('PACKING', can) ? <Link className="btn btn-primary" to="/documents/new/packing">New packing list</Link> : undefined}
      />
      <div className="toolbar">
        <SearchInput value={state.q} onChange={params.setQ} placeholder="Search number, consignee or lock ref…" />
        <select className="select" value={state.filters.status ?? ''} onChange={(e) => params.setFilter('status', e.target.value)} aria-label="Packing status">
          <option value="">Any packing state</option>
          <option value="open">Open</option>
          <option value="locked">Locked</option>
          <option value="consumed">Consumed</option>
          <option value="unpacked">Unpacked</option>
          <option value="none">Not posted</option>
        </select>
        <input type="date" className="input" value={state.filters.from ?? ''} onChange={(e) => params.setFilter('from', e.target.value)} aria-label="From date" />
        <input type="date" className="input" value={state.filters.to ?? ''} onChange={(e) => params.setFilter('to', e.target.value)} aria-label="To date" />
        <WarehouseSelect value={state.filters.warehouse_id ? Number(state.filters.warehouse_id) : null} onChange={(id) => params.setFilter('warehouse_id', id ? String(id) : '')} warehouses={warehouses} emptyLabel="All warehouses" />
        {state.q || Object.keys(state.filters).length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={params.reset}>
            Reset
          </button>
        ) : null}
      </div>
      {flash ? <Notice kind="success">{flash}</Notice> : null}
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(r) => r.document_id}
        loading={list.loading}
        error={list.error}
        emptyMessage="No packing lists match these filters."
        sort={{ key: state.sort, order: state.order }}
        onSort={params.toggleSort}
        onRowClick={(r) => navigate(`/documents/${r.document_id}`)}
        rowActions={(r) => (
          <>
            <Link className="btn btn-sm" to={`/documents/${r.document_id}`}>
              Open
            </Link>
            {['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'].includes(r.status)
              ? packingActions(r.packing_status, can).map((a) => (
                  <button key={a} type="button" className={`btn btn-sm${a === 'unpack' ? ' btn-danger' : ''}`} onClick={() => { setDialog({ row: r, action: a }); setNotes(''); setForce(false); setError(null) }}>
                    {a === 'unpack' ? 'Unpack' : a === 'lock' ? 'Lock' : 'Unlock'}
                  </button>
                ))
              : null}
          </>
        )}
      />
      <Pagination meta={list.data?.meta ?? null} onPage={params.setPage} onLimit={params.setLimit} limit={state.limit} />
      <Modal
        open={dialog !== null}
        title={dialog ? `${dialog.action === 'unpack' ? 'Unpack' : dialog.action === 'lock' ? 'Lock' : 'Unlock'} ${dialog.row.document_no ?? `#${dialog.row.document_id}`}` : ''}
        onClose={() => setDialog(null)}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)} disabled={busy}>
              Back
            </button>
            <button type="button" className={`btn ${dialog?.action === 'unpack' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </>
        }
      >
        {dialog?.action === 'unpack' ? <p style={{ margin: 0 }}>Packed goods go back to available stock; the list stays posted for the trail.</p> : null}
        {dialog?.action === 'unlock' ? (
          <label className="checkbox">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force unlock even if another sale holds it
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{dialog?.action === 'unpack' ? 'Reason (optional)' : 'Sale / draft reference (optional)'}</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </label>
        {error ? <Notice kind="error">{error}</Notice> : null}
      </Modal>
    </div>
  )
}
