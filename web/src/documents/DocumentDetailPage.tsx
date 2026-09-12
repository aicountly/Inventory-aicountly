import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useQuery } from '../hooks/useQuery'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import type { AuditRow } from '../services/documentsApi'
import { packingApi } from '../services/stockApi'
import { formatDate, formatDateTime, formatMoney, formatQty } from '../utils/format'
import { STATUS_LABELS, allowedActions, packingActions, statusTone } from './actions'
import type { DocumentAction, PackingAction } from './actions'
import { offendingLineIds, parseNegativeStock } from './negativeStock'
import type { NegativeStockDetail } from './negativeStock'
import { STOCK_EFFECT_LABELS, labelForCode, specForCode } from './registry'
import { buildTimeline } from './timeline'
import type { DocumentLine, DocumentStatus, InventoryDocument, PostingWarning } from './types'
import { useReferenceData } from './useReferenceData'
import './documents.css'

type Dialog = { kind: 'reverse' } | { kind: 'reject' } | { kind: 'cancel' } | { kind: 'unpack' } | { kind: 'lock' } | { kind: 'unlock' } | null

const ACTION_LABELS: Record<DocumentAction, string> = {
  edit: 'Edit',
  submit: 'Submit for approval',
  approve: 'Approve',
  reject: 'Reject',
  post: 'Post',
  cancel: 'Cancel document',
  reverse: 'Reverse',
}

function shortUuid(v: string | null | undefined): string {
  if (!v) return '—'
  return v.length > 12 ? `${v.slice(0, 8)}…` : v
}

function lineWarehouse(doc: InventoryDocument, l: DocumentLine, name: (id: number | null | undefined) => string): string {
  const from = l.warehouse_name ?? name(l.warehouse_id)
  if (doc.document_type === 'STOCK_TRANSFER' && l.dest_warehouse_id) return `${from} → ${l.dest_warehouse_name ?? name(l.dest_warehouse_id)}`
  return from || '—'
}

export function DocumentDetailPage() {
  const { id } = useParams()
  const docId = Number(id)
  const { can } = useAccess()
  const { warehouseName } = useReferenceData()
  const [tick, setTick] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notes, setNotes] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])

  const query = useQuery((signal) => documentsApi.get(docId, signal), [docId, tick], { enabled: Number.isFinite(docId) })
  const doc = query.data
  const isPacking = doc?.document_type === 'PACKING'
  const packing = useQuery((signal) => packingApi.get(docId, signal), [docId, tick, isPacking], { enabled: isPacking })
  const canAudit = can('audit.read')
  const audit = useQuery((signal) => documentsApi.auditTrail(docId, signal), [docId, tick], { enabled: canAudit && Number.isFinite(docId) })

  const spec = specForCode(doc?.document_type)
  const actions = doc ? allowedActions(doc.status, doc.document_type, can) : []
  const packingMeta = packing.data?.packing ?? null
  const pActions = isPacking && doc && ['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'].includes(doc.status) ? packingActions(packingMeta?.packing_status, can) : []
  const timeline = useMemo(() => (doc ? buildTimeline(doc, doc.approvals ?? [], (audit.data?.data ?? []) as AuditRow[]) : []), [doc, audit.data])
  const offending = useMemo(() => new Set(doc && negative ? offendingLineIds(doc.lines, negative) : []), [doc, negative])

  const refresh = () => setTick((t) => t + 1)

  const run = async (label: string, fn: () => Promise<InventoryDocument>, success: string) => {
    setBusy(label)
    setActionError(null)
    setFlash(null)
    try {
      const result = await fn()
      setWarnings(result.warnings ?? [])
      setFlash(result.duplicate ? `${success} (already done).` : success)
      setDialog(null)
      setNotes('')
      setForce(false)
      setNegative(null)
      setOverride(false)
      refresh()
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setActionError(errorMessage(err))
        setDialog(null)
      } else {
        setActionError(isApiError(err) && err.details && typeof err.details === 'object' && 'status' in err.details ? `${err.message} (status ${String(err.details.status)})` : errorMessage(err))
      }
    } finally {
      setBusy(null)
    }
  }

  const doAction = (action: DocumentAction) => {
    if (!doc) return
    switch (action) {
      case 'submit':
        return void run('submit', () => documentsApi.submit(doc.document_id), 'Submitted for approval.')
      case 'approve':
        return void run('approve', () => documentsApi.approve(doc.document_id), 'Approved.')
      case 'post':
        return void run('post', () => documentsApi.post(doc.document_id, { negativeOverride: override }), 'Posted.')
      case 'reject':
      case 'cancel':
      case 'reverse':
        setNotes('')
        setDialog({ kind: action })
        return
      default:
        return
    }
  }

  const doPacking = (action: PackingAction) => {
    setNotes('')
    setForce(false)
    setDialog({ kind: action })
  }

  const confirmDialog = () => {
    if (!doc || !dialog) return
    switch (dialog.kind) {
      case 'reverse':
        return void run('reverse', () => documentsApi.reverse(doc.document_id, notes.trim()), 'Reversed with compensating movements.')
      case 'reject':
        return void run('reject', () => documentsApi.reject(doc.document_id, notes), 'Rejected back to draft.')
      case 'cancel':
        return void run('cancel', () => documentsApi.cancel(doc.document_id, notes), 'Cancelled.')
      case 'unpack':
        return void run('unpack', () => packingApi.unpack(doc.document_id, notes.trim() || undefined), 'Unpacked: goods are available again.')
      case 'lock':
        return void run('lock', () => packingApi.lock(doc.document_id, notes.trim() ? { external_ref: notes.trim() } : {}), 'Packing list locked.')
      case 'unlock':
        return void run('unlock', () => packingApi.unlock(doc.document_id, { external_ref: notes.trim() || undefined, force }), 'Packing list unlocked.')
    }
  }

  if (!Number.isFinite(docId)) {
    return (
      <div className="page">
        <Notice kind="error">Invalid document id.</Notice>
      </div>
    )
  }
  if (query.error && !doc) {
    return (
      <div className="page">
        <PageHeader title="Document" breadcrumbs={[{ label: 'Documents', to: '/documents' }]} />
        <Notice kind="error">{errorMessage(query.error)}</Notice>
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="page">
        <PageHeader title="Loading…" breadcrumbs={[{ label: 'Documents', to: '/documents' }]} />
      </div>
    )
  }

  const title = `${doc.document_type_label ?? labelForCode(doc.document_type)} ${doc.document_no ?? `#${doc.document_id}`}`
  const statusLabel = STATUS_LABELS[doc.status as DocumentStatus] ?? doc.status
  const badgeTone = statusTone(doc.status)
  const showBook = doc.lines.some((l) => l.book_qty !== null || l.physical_qty !== null)
  const showSerials = doc.lines.some((l) => l.serials.length > 0)
  const valuationTotal = doc.lines.reduce((s, l) => s + (l.direction === 'in' ? 1 : l.direction === 'out' ? -1 : 0) * (Number(l.valuation_amount) || 0), 0)
  const dialogTitle = dialog ? { reverse: 'Reverse document', reject: 'Reject document', cancel: 'Cancel document', unpack: 'Unpack goods', lock: 'Lock packing list', unlock: 'Unlock packing list' }[dialog.kind] : ''

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="doc-title-row">
            {title}
            <StatusBadge value={doc.status} label={statusLabel} tone={badgeTone === 'success' ? 'good' : badgeTone === 'danger' ? 'critical' : badgeTone === 'warning' ? 'warning' : badgeTone === 'info' ? 'info' : 'neutral'} />
          </span>
        }
        subtitle={`${formatDate(doc.document_date)} · ${doc.source_app === 'inventory' ? 'Entered in Inventory' : `From ${doc.source_app}${doc.source_document_no ? ` ${doc.source_document_no}` : ''}`} · v${doc.version}`}
        breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: doc.document_no ?? `#${doc.document_id}` }]}
        actions={
          <div className="doc-actions">
            <Link className="btn" to={`/documents/${doc.document_id}/print`}>
              Print view
            </Link>
            {actions.map((a) =>
              a === 'edit' ? (
                spec ? (
                  <Link key={a} className="btn" to={`/documents/${doc.document_id}/edit`}>
                    Edit
                  </Link>
                ) : null
              ) : (
                <button key={a} type="button" className={`btn ${a === 'post' ? 'btn-primary' : a === 'reverse' || a === 'cancel' ? 'btn-danger' : ''}`} onClick={() => doAction(a)} disabled={busy !== null}>
                  {busy === a ? 'Working…' : ACTION_LABELS[a]}
                </button>
              ),
            )}
            {pActions.map((a) => (
              <button key={a} type="button" className={`btn ${a === 'unpack' ? 'btn-danger' : ''}`} onClick={() => doPacking(a)} disabled={busy !== null}>
                {a === 'unpack' ? 'Unpack' : a === 'lock' ? 'Lock' : 'Unlock'}
              </button>
            ))}
          </div>
        }
      />

      {flash ? <Notice kind="success">{flash}</Notice> : null}
      {actionError && !negative ? <Notice kind="error">{actionError}</Notice> : null}
      {negative ? (
        <Notice kind="error" title="Insufficient stock — not posted">
          <ul className="warning-list">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · ${warehouseName(d.warehouse_id)}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {can('stock.negative_override') ? (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <label className="checkbox">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Post anyway and let stock go negative (override)
              </label>
              <button type="button" className="btn btn-sm btn-primary" disabled={!override || busy !== null} onClick={() => doAction('post')}>
                Post with override
              </button>
            </div>
          ) : (
            <div className="hint">Reduce the quantities (edit) or receive stock first. Posting into negative stock needs the "override negative-stock block" permission.</div>
          )}
        </Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice kind="warning" title="Posted with warnings">
          <ul className="warning-list">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {doc.status === 'FAILED' && doc.failure_reason ? <Notice kind="error" title="Last posting attempt failed">{doc.failure_reason}</Notice> : null}
      {(doc.status === 'CANCELLED' || doc.status === 'REVERSED') && doc.cancel_reason ? <Notice kind="warning" title={doc.status === 'REVERSED' ? 'Reversed' : 'Cancelled'}>{doc.cancel_reason}</Notice> : null}
      {doc.reversed_by_document_id ? (
        <Notice kind="info">
          Replaced by <Link to={`/documents/${doc.reversed_by_document_id}`}>document #{doc.reversed_by_document_id}</Link>.
        </Notice>
      ) : null}

      <div className="card">
        <div className="card-body">
          <h2 className="card-title">Details</h2>
          <dl className="doc-kv">
            <div>
              <dt>Type</dt>
              <dd>{doc.document_type_label ?? labelForCode(doc.document_type)}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{formatDate(doc.document_date)}</dd>
            </div>
            {doc.party_name || doc.party_ref ? (
              <div>
                <dt>{spec?.party === 'consignee' ? 'Consignee' : spec?.party === 'job_worker' ? 'Job worker' : 'Party'}</dt>
                <dd>
                  {doc.party_name ?? '—'}
                  {doc.party_ref ? <span className="muted"> · #{doc.party_ref}</span> : null}
                </dd>
              </div>
            ) : null}
            {doc.from_warehouse_id ? (
              <div>
                <dt>From warehouse</dt>
                <dd>{warehouseName(doc.from_warehouse_id)}</dd>
              </div>
            ) : null}
            {doc.to_warehouse_id ? (
              <div>
                <dt>To warehouse</dt>
                <dd>{warehouseName(doc.to_warehouse_id)}</dd>
              </div>
            ) : null}
            {doc.stock_effect ? (
              <div>
                <dt>Stock effect</dt>
                <dd>{STOCK_EFFECT_LABELS[doc.stock_effect] ?? doc.stock_effect}</dd>
              </div>
            ) : null}
            {doc.returnable !== null ? (
              <div>
                <dt>Returnable</dt>
                <dd>{doc.returnable ? `Yes${doc.expected_return_date ? ` · by ${formatDate(doc.expected_return_date)}` : ''}` : 'No'}</dd>
              </div>
            ) : null}
            {doc.reason_code || doc.movement_reason ? (
              <div>
                <dt>Reason</dt>
                <dd>{[doc.reason_code, doc.movement_reason].filter(Boolean).join(' · ')}</dd>
              </div>
            ) : null}
            {doc.source_app !== 'inventory' || doc.source_document_type ? (
              <div>
                <dt>Source</dt>
                <dd>
                  {doc.source_app}
                  {doc.source_document_type ? ` · ${doc.source_document_type}` : ''}
                  {doc.source_document_no ? ` · ${doc.source_document_no}` : doc.source_document_id ? ` · #${doc.source_document_id}` : ''}
                  {doc.source_document_date ? ` · ${formatDate(doc.source_document_date)}` : ''}
                </dd>
              </div>
            ) : null}
            {doc.currency_code !== 'INR' || Number(doc.exchange_rate) !== 1 ? (
              <div>
                <dt>Currency</dt>
                <dd>
                  {doc.currency_code} @ {formatQty(doc.exchange_rate)}
                </dd>
              </div>
            ) : null}
            {doc.metadata?.bom_id ? (
              <div>
                <dt>Bill of materials</dt>
                <dd>
                  BOM #{String(doc.metadata.bom_id)} · run {formatQty(doc.metadata.production_qty)} @ {formatMoney(doc.metadata.finished_rate)}
                </dd>
              </div>
            ) : null}
            {doc.reverses_document_id ? (
              <div>
                <dt>Reverses</dt>
                <dd>
                  <Link to={`/documents/${doc.reverses_document_id}`}>#{doc.reverses_document_id}</Link>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>UUID</dt>
              <dd className="mono" title={doc.document_uuid}>
                {shortUuid(doc.document_uuid)}
              </dd>
            </div>
            {doc.narration ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Narration</dt>
                <dd>{doc.narration}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <h2 className="card-title">Lines</h2>
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Warehouse</th>
                <th>Batch</th>
                <th>Dir.</th>
                <th className="align-right">Qty</th>
                <th className="align-right">Base qty</th>
                {showBook ? (
                  <>
                    <th className="align-right">Book</th>
                    <th className="align-right">Counted</th>
                  </>
                ) : null}
                <th className="align-right">Rate</th>
                <th className="align-right">Amount</th>
                <th className="align-right">Val. rate</th>
                <th className="align-right">Val. amount</th>
                <th>Method</th>
                {showSerials ? <th>Serials</th> : null}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={l.line_id} className={offending.has(l.line_id) ? 'line-offending' : undefined}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {l.item_label ?? l.item_name ?? `Item #${l.item_id}`}
                    {l.item_sku ? <span className="muted"> · {l.item_sku}</span> : null}
                    {l.description ? <div className="hint">{l.description}</div> : null}
                  </td>
                  <td>{lineWarehouse(doc, l, warehouseName)}</td>
                  <td>{l.batch_no ?? <span className="muted">—</span>}</td>
                  <td>{l.direction === 'none' ? <span className="muted">—</span> : l.direction}</td>
                  <td className="align-right nowrap">
                    {formatQty(l.qty)} {l.unit_symbol ?? ''}
                  </td>
                  <td className="align-right">{formatQty(l.base_qty)}</td>
                  {showBook ? (
                    <>
                      <td className="align-right">{formatQty(l.book_qty)}</td>
                      <td className="align-right">{formatQty(l.physical_qty)}</td>
                    </>
                  ) : null}
                  <td className="align-right">{l.source_transaction_rate !== null ? formatMoney(l.source_transaction_rate) : <span className="muted">—</span>}</td>
                  <td className="align-right">{l.source_transaction_amount !== null ? formatMoney(l.source_transaction_amount) : <span className="muted">—</span>}</td>
                  <td className="align-right">{l.valuation_rate !== null ? formatMoney(l.valuation_rate) : <span className="muted">—</span>}</td>
                  <td className="align-right">{l.valuation_amount !== null ? formatMoney(l.valuation_amount) : <span className="muted">—</span>}</td>
                  <td className="muted">{l.valuation_method_applied ?? '—'}</td>
                  {showSerials ? <td title={l.serials.map((s) => s.serial_no).join(', ')}>{l.serials.length > 0 ? `${l.serials.length}` : <span className="muted">—</span>}</td> : null}
                </tr>
              ))}
            </tbody>
            {doc.lines.some((l) => l.valuation_amount !== null) ? (
              <tfoot>
                <tr>
                  <td colSpan={showBook ? 12 : 10} className="align-right muted">
                    Net stock value change
                  </td>
                  <td className="align-right">
                    <strong>{formatMoney(valuationTotal)}</strong>
                  </td>
                  <td colSpan={showSerials ? 2 : 1} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
        <div className="card">
          <div className="card-body">
            <h2 className="card-title">Accounting effects</h2>
            {doc.accounting_effects.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                {['POSTED', 'COMPLETED', 'PARTIALLY_FULFILLED'].includes(doc.status) ? 'No accounting effect (status change or zero value).' : 'Computed when the document is posted; Books maps each effect to its ledgers.'}
              </p>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>Effect</th>
                    <th>Line / item</th>
                    <th className="align-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.accounting_effects.map((e, i) => (
                    <tr key={`${e.effect}-${e.line_id ?? i}`}>
                      <td>{e.effect.replace(/_/g, ' ')}</td>
                      <td className="muted">{e.line_id ? `line ${doc.lines.findIndex((l) => l.line_id === e.line_id) + 1 || e.line_id}${e.base_qty ? ` · ${formatQty(e.base_qty)} @ ${formatMoney(e.valuation_rate)}` : ''}` : 'document'}</td>
                      <td className="align-right">{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <h2 className="card-title">Approvals &amp; history</h2>
            <ul className="timeline">
              {timeline.map((ev, i) => (
                <li key={`${ev.when}-${ev.label}-${i}`}>
                  <span className={`tl-dot ${ev.tone}`} aria-hidden />
                  <div>
                    <div>
                      <strong>{ev.label}</strong>
                      {ev.actor ? <span className="muted"> · {shortUuid(ev.actor)}</span> : null}
                    </div>
                    <div className="tl-when">{formatDateTime(ev.when)}</div>
                    {ev.note ? <div className="tl-note">{ev.note}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
            {!canAudit ? <p className="hint" style={{ marginBottom: 0 }}>Edits and failed attempts appear here with the audit-trail permission.</p> : null}
          </div>
        </div>
        {isPacking ? (
          <div className="card">
            <div className="card-body">
              <h2 className="card-title">Packing state</h2>
              {packingMeta ? (
                <dl className="doc-kv">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusBadge value={packingMeta.packing_status} tone={packingMeta.packing_status === 'open' ? 'good' : packingMeta.packing_status === 'locked' ? 'warning' : 'neutral'} />
                    </dd>
                  </div>
                  <div>
                    <dt>Locked by</dt>
                    <dd>{packingMeta.locked_by_external_ref ?? (packingMeta.locked_by_document_id ? `document #${packingMeta.locked_by_document_id}` : '—')}</dd>
                  </div>
                  <div>
                    <dt>Locked at</dt>
                    <dd>{formatDateTime(packingMeta.locked_at)}</dd>
                  </div>
                  <div>
                    <dt>Box marks</dt>
                    <dd>{Array.isArray(packingMeta.box_marks) && packingMeta.box_marks.length ? packingMeta.box_marks.join(', ') : '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                  {packing.loading ? 'Loading…' : 'Packed stock is held once the list is posted.'}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={dialog !== null}
        title={dialogTitle}
        onClose={() => setDialog(null)}
        busy={busy !== null}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDialog(null)} disabled={busy !== null}>
              Back
            </button>
            <button type="button" className={`btn ${dialog?.kind === 'reverse' || dialog?.kind === 'cancel' || dialog?.kind === 'unpack' ? 'btn-danger' : 'btn-primary'}`} onClick={confirmDialog} disabled={busy !== null || (dialog?.kind === 'reverse' && !notes.trim())}>
              {busy ? 'Working…' : dialogTitle}
            </button>
          </>
        }
      >
        {dialog?.kind === 'reverse' ? <p style={{ margin: 0 }}>Compensating stock movements are written for every line and valuation layers are restored; later issues are re-costed from this date. The document itself is kept for audit.</p> : null}
        {dialog?.kind === 'unpack' ? <p style={{ margin: 0 }}>Packed goods return to available stock. The list stays posted so the pack / unpack trail is complete.</p> : null}
        {dialog?.kind === 'unlock' ? (
          <label className="checkbox">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force unlock even if another sale holds it
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{dialog?.kind === 'reverse' ? 'Reason (required)' : dialog?.kind === 'lock' || dialog?.kind === 'unlock' ? 'Sale / draft reference (optional)' : 'Notes (optional)'}</span>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </label>
        {actionError ? <Notice kind="error">{actionError}</Notice> : null}
      </Modal>
    </div>
  )
}
