import { useMemo } from 'react'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { pendingApi } from '../../services/stockApi'
import type { PendingRow } from '../../services/stockApi'
import { formatDate, formatQty } from '../../utils/format'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

interface DeferredPurchasePanelProps {
  spec: DocumentTypeSpec
  partyRef: number | null
  linkedSourceDocumentId: number | null
  onChange: (documentId: number | null, lines: LineDraft[], partyRef: number | null) => void
  disabled?: boolean
}

interface Group {
  document_id: number
  document_no: string | null
  document_date: string | null
  party_ref: number | null
  rows: PendingRow[]
}

function linesFor(spec: DocumentTypeSpec, group: Group): LineDraft[] {
  return group.rows.map((row) =>
    newLine(spec, {
      key: `deferred-${row.pending_id}`,
      item_id: row.item_id,
      item_name: row.item_name ?? `Item #${row.item_id}`,
      units: row.unit_id ? [{ unit_id: row.unit_id, unit_symbol: row.unit_symbol, conversion_factor: 1, is_default: true }] : [],
      unit_id: row.unit_id,
      warehouse_id: row.warehouse_id,
      qty: String(row.qty_open),
      description: `Against ${group.document_no ?? `purchase #${group.document_id}`} · open ${formatQty(row.qty_open)}`,
      origin: 'deferred',
      metadata: { settlement_pending_id: row.pending_id },
    }),
  )
}

/**
 * Inward challan with `stock_effect = settle_deferred`: receive goods against a purchase that
 * was invoiced with deferred inward. Picks the open deferred-purchase document; its open
 * quantities become the lines (editable, never above what is open).
 */
export function DeferredPurchasePanel({ spec, partyRef, linkedSourceDocumentId, onChange, disabled }: DeferredPurchasePanelProps) {
  const pending = useQuery((signal) => pendingApi.list({ kind: 'deferred_purchase', direction: 'in', party_ref: partyRef ?? undefined }, signal), [partyRef])
  const groups = useMemo<Group[]>(() => {
    const map = new Map<number, Group>()
    for (const row of pending.data?.data ?? []) {
      const g = map.get(row.document_id) ?? { document_id: row.document_id, document_no: row.document_no, document_date: row.document_date, party_ref: row.party_ref, rows: [] }
      g.rows.push(row)
      map.set(row.document_id, g)
    }
    return [...map.values()]
  }, [pending.data])

  const selected = groups.find((g) => g.document_id === linkedSourceDocumentId) ?? null

  return (
    <section className="form-section">
      <h2 className="form-section-title">Deferred purchase being received</h2>
      <p className="form-section-subtitle">Open quantities of the purchase become the lines below; the receipt settles them and moves stock in.</p>
      {pending.error ? <Notice kind="error">{errorMessage(pending.error)}</Notice> : null}
      <div className="form-grid">
        <FormField label="Purchase" htmlFor="deferred_doc" required>
          <select
            id="deferred_doc"
            className="select"
            value={linkedSourceDocumentId ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value === '' ? null : Number(e.target.value)
              const g = groups.find((x) => x.document_id === id) ?? null
              onChange(id, g ? linesFor(spec, g) : [], g?.party_ref ?? null)
            }}
          >
            <option value="">{pending.loading ? 'Loading…' : groups.length === 0 ? 'No deferred purchases open' : 'Select…'}</option>
            {linkedSourceDocumentId && !groups.some((g) => g.document_id === linkedSourceDocumentId) ? <option value={linkedSourceDocumentId}>Purchase #{linkedSourceDocumentId}</option> : null}
            {groups.map((g) => (
              <option key={g.document_id} value={g.document_id}>
                {g.document_no ?? `#${g.document_id}`} · {formatDate(g.document_date)} · {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      {selected ? (
        <table className="panel-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Warehouse</th>
              <th className="align-right">Invoiced</th>
              <th className="align-right">Received</th>
              <th className="align-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {selected.rows.map((r) => (
              <tr key={r.pending_id}>
                <td>{r.item_name ?? `Item #${r.item_id}`}</td>
                <td>{r.warehouse_name ?? '—'}</td>
                <td className="align-right">{formatQty(r.qty_original)}</td>
                <td className="align-right">{formatQty(r.qty_settled)}</td>
                <td className="align-right">
                  <strong>{formatQty(r.qty_open)}</strong> {r.unit_symbol ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
