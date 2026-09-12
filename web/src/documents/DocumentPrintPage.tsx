import { Link, useParams } from 'react-router-dom'
import { Notice } from '../components/Notice'
import { useQuery } from '../hooks/useQuery'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { formatDate, formatMoney, formatQty } from '../utils/format'
import { labelForCode } from './registry'
import { useReferenceData } from './useReferenceData'
import './documents.css'

type Row = Record<string, unknown>

const TITLE_KEYS = ['title', 'document_title', 'variant_label']

function text(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'object') return ''
  return String(v)
}

function first(row: Row, keys: string[]): unknown {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]
  return undefined
}

/** `/documents/:id/print` — the immutable print snapshot, or the live document when none was captured. */
export function DocumentPrintPage() {
  const { id } = useParams()
  const docId = Number(id)
  const { warehouseName } = useReferenceData()
  const snapshot = useQuery((signal) => documentsApi.printSnapshot(docId, signal), [docId], { enabled: Number.isFinite(docId) })
  const missing = !!snapshot.error && isApiError(snapshot.error) && snapshot.error.status === 404
  const live = useQuery((signal) => documentsApi.get(docId, signal), [docId], { enabled: missing })

  if (snapshot.loading || (missing && live.loading)) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (snapshot.error && !missing) {
    return (
      <div className="page">
        <Notice kind="error">{errorMessage(snapshot.error)}</Notice>
      </div>
    )
  }

  const snap = snapshot.data
  const doc = live.data
  if (!snap && !doc) {
    return (
      <div className="page">
        <Notice kind="error">{live.error ? errorMessage(live.error) : 'Nothing to print.'}</Notice>
      </div>
    )
  }

  const header: Row = snap?.header_snapshot ?? {}
  const sourceDest: Row = snap?.source_dest_snapshot ?? {}
  const lines: Row[] = snap ? (snap.item_lines_snapshot ?? []) : (doc?.lines ?? []).map((l) => ({ item_name: l.item_label ?? l.item_name, item_sku: l.item_sku, warehouse_name: l.warehouse_name ?? warehouseName(l.warehouse_id), batch_no: l.batch_no, qty: l.qty, unit_symbol: l.unit_symbol, rate: l.source_transaction_rate ?? l.valuation_rate, amount: l.source_transaction_amount ?? l.valuation_amount, direction: l.direction }))
  const footer: Row = snap?.footer_snapshot ?? {}
  const title = snap ? text(first(header, TITLE_KEYS)) || snap.document_variant.replace(/_/g, ' ') : `${doc?.document_type_label ?? labelForCode(doc?.document_type ?? '')}`
  const number = snap?.document_no ?? doc?.document_no ?? `#${docId}`
  const date = snap?.document_date ?? doc?.document_date ?? ''
  const metaPairs = Object.entries({ ...header, ...sourceDest }).filter(([k, v]) => text(v) !== '' && !TITLE_KEYS.includes(k))

  return (
    <div className="page">
      <div className="row no-print">
        <Link className="btn" to={`/documents/${docId}`}>
          ← Back to document
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
        {!snap ? <span className="hint">No print snapshot was captured for this document; showing the live document instead.</span> : <span className="hint">Immutable snapshot captured {formatDate(snap.created_at)} · template {snap.template_version}</span>}
      </div>
      <div className="print-sheet">
        <h1>{title}</h1>
        <div>
          <strong>{number}</strong> · {formatDate(date)}
          {doc?.party_name ? ` · ${doc.party_name}` : ''}
        </div>
        {metaPairs.length > 0 ? (
          <div className="print-meta">
            {metaPairs.map(([k, v]) => (
              <div key={k}>
                <span>{k.replace(/_/g, ' ')}: </span>
                {text(v)}
              </div>
            ))}
          </div>
        ) : null}
        {!snap && doc ? (
          <div className="print-meta">
            {doc.from_warehouse_id ? <div><span>From: </span>{warehouseName(doc.from_warehouse_id)}</div> : null}
            {doc.to_warehouse_id ? <div><span>To: </span>{warehouseName(doc.to_warehouse_id)}</div> : null}
            {doc.narration ? <div><span>Narration: </span>{doc.narration}</div> : null}
          </div>
        ) : null}
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Warehouse</th>
              <th>Batch</th>
              <th className="align-right">Qty</th>
              <th className="align-right">Rate</th>
              <th className="align-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {text(first(l, ['item_name', 'item_label', 'description', 'name']))}
                  {text(first(l, ['item_sku', 'sku'])) ? ` · ${text(first(l, ['item_sku', 'sku']))}` : ''}
                </td>
                <td>{text(first(l, ['warehouse_name', 'mc_name', 'warehouse']))}</td>
                <td>{text(first(l, ['batch_no', 'batch']))}</td>
                <td className="align-right">
                  {formatQty(first(l, ['qty', 'quantity']), '')} {text(first(l, ['unit_symbol', 'unit', 'uom']))}
                  {text(l.direction) && text(l.direction) !== 'none' ? ` (${text(l.direction)})` : ''}
                </td>
                <td className="align-right">{formatMoney(first(l, ['rate', 'unit_rate', 'valuation_rate']), '')}</td>
                <td className="align-right">{formatMoney(first(l, ['amount', 'line_amount', 'valuation_amount']), '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(footer).length > 0 ? (
          <div className="print-meta">
            {Object.entries(footer)
              .filter(([, v]) => text(v) !== '')
              .map(([k, v]) => (
                <div key={k}>
                  <span>{k.replace(/_/g, ' ')}: </span>
                  {text(v)}
                </div>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
