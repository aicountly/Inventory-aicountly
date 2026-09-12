import { useEffect, useMemo, useState } from 'react'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { pendingApi } from '../../services/stockApi'
import type { PendingRow } from '../../services/stockApi'
import { formatDate, formatQty, toNumber } from '../../utils/format'
import { newLine } from '../formModel'
import type { LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { JobWorkSettlement } from '../types'

interface RowState {
  checked: boolean
  qty: string
  type: 'consumed' | 'returned'
}

interface SettlementsPanelProps {
  spec: DocumentTypeSpec
  partyRef: number | null
  value: JobWorkSettlement[]
  onChange: (settlements: JobWorkSettlement[], consumedLines: LineDraft[], partyRef: number | null) => void
  disabled?: boolean
}

function consumedLine(spec: DocumentTypeSpec, row: PendingRow, qty: number): LineDraft {
  return newLine(spec, {
    key: `settle-${row.pending_id}`,
    item_id: row.item_id,
    item_name: row.item_name ?? `Item #${row.item_id}`,
    units: row.unit_id ? [{ unit_id: row.unit_id, unit_symbol: row.unit_symbol, conversion_factor: 1, is_default: true }] : [],
    unit_id: row.unit_id,
    warehouse_id: row.warehouse_id,
    direction: 'out',
    qty: String(qty),
    description: `Consumed by job worker · ${row.document_no ?? `#${row.document_id}`}`,
    origin: 'settlement',
    metadata: { settlement_pending_id: row.pending_id },
  })
}

/**
 * Job work inward: settle material sent out earlier. Each open job-work pending quantity can be
 * settled as `consumed` (material used by the job worker — an OUT line is added so it is valued
 * and expensed) or `returned` (came back unused — no movement). Finished goods are entered as
 * ordinary IN lines below.
 */
export function SettlementsPanel({ spec, partyRef, value, onChange, disabled }: SettlementsPanelProps) {
  const pending = useQuery((signal) => pendingApi.list({ kind: 'job_work', direction: 'out', party_ref: partyRef ?? undefined }, signal), [partyRef])
  const rows = useMemo(() => pending.data?.data ?? [], [pending.data])
  const [state, setState] = useState<Record<number, RowState>>({})

  // Seed from the saved settlements (edit mode). Returns the same state object when there is
  // nothing to add, so a caller passing a fresh array each render cannot loop.
  useEffect(() => {
    if (value.length === 0) return
    setState((s) => {
      let next: Record<number, RowState> | null = null
      for (const v of value) {
        if (s[v.pending_id]) continue
        next ??= { ...s }
        next[v.pending_id] = { checked: true, qty: String(v.qty), type: v.settlement_type }
      }
      return next ?? s
    })
  }, [value])

  const emit = (next: Record<number, RowState>) => {
    const settlements: JobWorkSettlement[] = []
    const lines: LineDraft[] = []
    let detectedParty: number | null = null
    for (const row of rows) {
      const st = next[row.pending_id]
      if (!st?.checked) continue
      const qty = toNumber(st.qty)
      if (qty === null || qty <= 0) continue
      settlements.push({ pending_id: row.pending_id, qty, settlement_type: st.type })
      if (st.type === 'consumed') lines.push(consumedLine(spec, row, qty))
      if (detectedParty === null && row.party_ref) detectedParty = row.party_ref
    }
    onChange(settlements, lines, detectedParty)
  }

  const patch = (row: PendingRow, p: Partial<RowState>) => {
    const current = state[row.pending_id] ?? { checked: false, qty: String(row.qty_open), type: 'consumed' as const }
    const next = { ...state, [row.pending_id]: { ...current, ...p } }
    setState(next)
    emit(next)
  }

  return (
    <section className="form-section">
      <h2 className="form-section-title">Material with the job worker</h2>
      <p className="form-section-subtitle">
        Tick what this inward settles. <strong>Consumed</strong> adds an out line (valued, expensed); <strong>returned</strong> just closes the pending quantity.
        {partyRef ? '' : ' Enter the job worker ledger id above to narrow the list.'}
      </p>
      {pending.error ? <Notice kind="error">{errorMessage(pending.error)}</Notice> : null}
      {!pending.loading && rows.length === 0 ? <div className="empty-state">No open job-work quantities{partyRef ? ' for this job worker' : ''}.</div> : null}
      {rows.length > 0 ? (
        <table className="panel-table">
          <thead>
            <tr>
              <th />
              <th>Outward</th>
              <th>Item</th>
              <th>Warehouse</th>
              <th className="align-right">Open</th>
              <th className="align-right">Settle</th>
              <th>As</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const st = state[row.pending_id]
              return (
                <tr key={row.pending_id}>
                  <td>
                    <input type="checkbox" checked={!!st?.checked} disabled={disabled} aria-label={`Settle pending ${row.pending_id}`} onChange={(e) => patch(row, { checked: e.target.checked })} />
                  </td>
                  <td>
                    {row.document_no ?? `#${row.document_id}`}
                    <div className="hint">{formatDate(row.document_date)}{row.party_ref ? ` · party ${row.party_ref}` : ''}</div>
                  </td>
                  <td>{row.item_name ?? `Item #${row.item_id}`}</td>
                  <td>{row.warehouse_name ?? '—'}</td>
                  <td className="align-right">
                    {formatQty(row.qty_open)} {row.unit_symbol ?? ''}
                  </td>
                  <td className="qty-cell">
                    <input className="input" inputMode="decimal" value={st?.qty ?? String(row.qty_open)} disabled={disabled || !st?.checked} aria-label="Settle quantity" onChange={(e) => patch(row, { qty: e.target.value })} />
                  </td>
                  <td>
                    <select className="select" value={st?.type ?? 'consumed'} disabled={disabled || !st?.checked} aria-label="Settlement type" onChange={(e) => patch(row, { type: e.target.value === 'returned' ? 'returned' : 'consumed' })}>
                      <option value="consumed">Consumed</option>
                      <option value="returned">Returned</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
