import { useEffect, useMemo, useRef, useState } from 'react'
import { FormField } from '../../components/FormField'
import { Notice } from '../../components/Notice'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import { settingsApi } from '../../services/settingsApi'
import { formatDate, formatMoney, formatQty } from '../../utils/format'
import {
  ALLOCATION_BASES,
  BASIS_HINTS,
  BASIS_LABELS,
  COST_TYPE_LABELS,
  chargeAmount,
  chargesFromMetadata,
  chargesToPayload,
  newCharge,
  offeredCostTypes,
  previewAllocation,
} from '../landedCost'
import type { AllocationBasis, ChargeDraft, ChargePayload, LandedCostType, TargetLine } from '../landedCost'
import type { DocumentMetadata } from '../types'

interface LandedCostPanelProps {
  initial: DocumentMetadata
  disabled?: boolean
  onChange: (targetDocumentId: number | null, charges: ChargePayload[], partyRef: number | null) => void
}

/** Receipts a cost can be loaded onto: posted, valued and inward. */
const TARGET_TYPES = 'PURCHASE_RECEIPT,MATERIAL_RECEIPT,OPENING_STOCK,WRITE_IN,SALES_RETURN'
const TARGET_STATUSES = 'POSTED,PARTIALLY_FULFILLED,COMPLETED'

/**
 * The charges block, entered on the document the way a purchase voucher carries one: pick the
 * receipt, list the charges, choose how each is spread, and see the per-line split before saving.
 * Any line's share can be typed over, which switches that charge to "entered per line".
 *
 * The preview is the server's own arithmetic (src/documents/landedCost.ts mirrors
 * DocumentPostingService::allocateCharge, residual rule included), so the figures here are the
 * figures that end up in stock value. The server still validates everything and its 422 is the
 * authority.
 *
 * What it does NOT do, and says so on screen: stock already issued out of the receipt is not
 * re-costed. Only what is still on hand absorbs the charge, posting reports the remainder for the
 * operator to expense, and that remainder is not written onto the receipt's cost either — so the
 * same rupees can never be expensed here and capitalised there.
 *
 * The cost types on offer are the ones THIS COMPANY capitalises into stock (Inventory settings →
 * Landed cost). A type it has switched off is not offered, because the server refuses it with a
 * 422 — offering it would only teach the operator to type something that cannot be saved. The
 * server's refusal, not this list, is what enforces the policy.
 */
export function LandedCostPanel({ initial, disabled, onChange }: LandedCostPanelProps) {
  const [targetId, setTargetId] = useState<number | null>(initial.target_document_id ? Number(initial.target_document_id) : null)
  const [charges, setCharges] = useState<ChargeDraft[]>(() => chargesFromMetadata(initial.charges))

  const policy = useQuery((signal) => settingsApi.landedCostPolicy(signal), [])
  const receipts = useQuery((signal) => documentsApi.list({ document_type: TARGET_TYPES, status: TARGET_STATUSES, limit: 50 }, signal), [])
  const target = useQuery((signal) => (targetId ? documentsApi.get(targetId, signal) : Promise.resolve(null)), [targetId], { enabled: targetId !== null })

  const lines = useMemo<TargetLine[]>(() => {
    const doc = target.data
    if (!doc) return []
    return doc.lines
      .filter((l) => l.direction === 'in' && (l.base_qty ?? 0) > 0 && l.valuation_rate !== null)
      .map((l) => ({
        line_id: l.line_id,
        label: l.item_label ?? l.item_name ?? `Item #${l.item_id}`,
        base_qty: l.base_qty,
        valuation_amount: l.valuation_amount ?? 0,
        unit_symbol: l.unit_symbol ?? null,
      }))
  }, [target.data])

  const preview = useMemo(() => previewAllocation(charges, lines), [charges, lines])

  // Push the payload up whenever anything changes. The panel owns the editable rows so typing is
  // never disturbed by a round trip through the normalised metadata.
  const last = useRef('')
  useEffect(() => {
    const payload = chargesToPayload(charges, lines)
    const signature = JSON.stringify([targetId, payload])
    if (signature === last.current) return
    last.current = signature
    onChange(targetId, payload, target.data?.party_ref ?? null)
  }, [charges, lines, targetId, target.data, onChange])

  const patch = (key: string, next: Partial<ChargeDraft>) => setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...next } : c)))

  /** Typing over one line's share is what turns a pro-rata charge into an entered-per-line one. */
  const overrideLine = (charge: ChargeDraft, lineId: number, value: string) => {
    const basis: AllocationBasis = charge.allocation_basis === 'direct' ? 'direct' : 'manual'
    const seeded: Record<number, string> = { ...charge.lines }
    if (charge.allocation_basis === 'value' || charge.allocation_basis === 'qty') {
      // Keep what the pro-rata split had worked out for every other line, so overriding one share
      // does not silently blank the rest.
      for (const l of lines) {
        const share = preview.byCharge[charge.key]?.[l.line_id]
        if (share !== undefined && seeded[l.line_id] === undefined) seeded[l.line_id] = String(share)
      }
    }
    if (value.trim() === '') delete seeded[lineId]
    else seeded[lineId] = value
    patch(charge.key, { allocation_basis: basis, lines: seeded })
  }

  const rows = receipts.data?.data ?? []
  const excludedLabels = (policy.data?.excluded_cost_types ?? []).map((t) => COST_TYPE_LABELS[t] ?? t).join(', ')
  const totalAllocated = preview.allocated
  const unallocated = Math.round((preview.total - totalAllocated) * 10000) / 10000

  return (
    <>
      <section className="form-section">
        <h2 className="form-section-title">Receipt being loaded</h2>
        <p className="form-section-subtitle">
          The charges below are added to what these goods cost, so closing stock and future COGS carry them. The invoice value and every GST figure are untouched — those belong to the
          purchase.
        </p>
        {receipts.error ? <Notice kind="error">{errorMessage(receipts.error)}</Notice> : null}
        <div className="form-grid">
          <FormField label="Receipt" htmlFor="landed_target" required help="Only posted receipts whose lines were valued can carry a cost.">
            <select
              id="landed_target"
              className="select"
              value={targetId ?? ''}
              disabled={disabled}
              onChange={(e) => setTargetId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{receipts.loading ? 'Loading…' : rows.length === 0 ? 'No posted receipts found' : 'Select…'}</option>
              {targetId !== null && !rows.some((r) => r.document_id === targetId) ? <option value={targetId}>Receipt #{targetId}</option> : null}
              {rows.map((r) => (
                <option key={r.document_id} value={r.document_id}>
                  {r.document_no ?? `#${r.document_id}`} · {formatDate(r.document_date)}
                  {r.party_name ? ` · ${r.party_name}` : ''}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {target.error ? <Notice kind="error">{errorMessage(target.error)}</Notice> : null}
        {targetId !== null && !target.loading && lines.length === 0 ? (
          <Notice kind="warning">That document has no valued inward line, so there is no cost of goods on it to add to.</Notice>
        ) : null}
      </section>

      <section className="form-section">
        <h2 className="form-section-title">Charges</h2>
        <p className="form-section-subtitle">Each charge is spread over the receipt&rsquo;s lines on the basis you pick. Type over any line&rsquo;s share to set it by hand.</p>
        <table className="panel-table">
          <thead>
            <tr>
              <th>Cost type</th>
              <th>Description</th>
              <th className="align-right">Amount</th>
              <th>Spread by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {charges.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No charges yet.
                </td>
              </tr>
            ) : null}
            {charges.map((charge, i) => (
              <tr key={charge.key}>
                <td>
                  <select
                    className="select"
                    value={charge.cost_type}
                    disabled={disabled}
                    aria-label={`Charge ${i + 1} cost type`}
                    onChange={(e) => patch(charge.key, { cost_type: e.target.value as LandedCostType })}
                  >
                    {offeredCostTypes(policy.data ?? null, charge.cost_type).map((t) => (
                      <option key={t} value={t}>
                        {COST_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input"
                    value={charge.description}
                    disabled={disabled}
                    maxLength={255}
                    aria-label={`Charge ${i + 1} description`}
                    placeholder="e.g. Road freight, LR 4471"
                    onChange={(e) => patch(charge.key, { description: e.target.value })}
                  />
                </td>
                <td className="qty-cell">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={charge.amount}
                    disabled={disabled}
                    aria-label={`Charge ${i + 1} amount`}
                    onChange={(e) => patch(charge.key, { amount: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="select"
                    value={charge.allocation_basis}
                    disabled={disabled}
                    aria-label={`Charge ${i + 1} allocation basis`}
                    title={BASIS_HINTS[charge.allocation_basis]}
                    onChange={(e) => patch(charge.key, { allocation_basis: e.target.value as AllocationBasis })}
                  >
                    {ALLOCATION_BASES.map((b) => (
                      <option key={b} value={b}>
                        {BASIS_LABELS[b]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={disabled}
                    aria-label={`Remove charge ${i + 1}`}
                    onClick={() => setCharges((cs) => cs.filter((c) => c.key !== charge.key))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="form-actions">
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setCharges((cs) => [...cs, newCharge({}, policy.data ?? null)])}>
            + Add charge
          </button>
          <span className="spacer" />
          <span className="hint">
            Charges <strong>{formatMoney(preview.total)}</strong>
            {Math.abs(unallocated) > 0.005 ? <> · not yet spread {formatMoney(unallocated)}</> : null}
          </span>
        </div>
        <p className="hint">{BASIS_HINTS.value} Weight is not offered: there is no item weight on the item master, so the control would silently fall back to another basis.</p>
        {excludedLabels !== '' ? (
          <p className="hint">
            This company does not capitalise {excludedLabels} into stock, so {policy.data && policy.data.excluded_cost_types.length > 1 ? 'those types are' : 'that type is'} not offered here — expense{' '}
            {policy.data && policy.data.excluded_cost_types.length > 1 ? 'those charges' : 'that charge'} in Books instead. Change it in Inventory settings. A non-creditable tax is always capitalised and
            cannot be switched off: tax that cannot be recovered is part of what the goods cost.
          </p>
        ) : null}
      </section>

      {lines.length > 0 ? (
        <section className="form-section">
          <h2 className="form-section-title">How it lands</h2>
          <p className="form-section-subtitle">
            What each line will be worth once the charges are allocated, if all of it lands. Stock already issued out of this receipt is not re-costed: only what is still on hand
            takes the charge, and posting reports the part it could not absorb for you to expense. That remainder is not added to the receipt's cost either, so it is never both
            expensed and carried in stock. A receipt inside a locked period cannot be loaded at all.
          </p>
          <table className="panel-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="align-right">Base qty</th>
                <th className="align-right">Value now</th>
                {charges.map((c, i) => (
                  <th key={c.key} className="align-right">
                    {COST_TYPE_LABELS[c.cost_type]}
                    {charges.filter((x) => x.cost_type === c.cost_type).length > 1 ? ` ${i + 1}` : ''}
                  </th>
                ))}
                <th className="align-right">Landed cost</th>
                <th className="align-right">New value</th>
                <th className="align-right">New unit cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const added = preview.perLine[l.line_id] ?? 0
                const newValue = Math.round((l.valuation_amount + added) * 10000) / 10000
                return (
                  <tr key={l.line_id}>
                    <td>{l.label}</td>
                    <td className="align-right">
                      {formatQty(l.base_qty)} {l.unit_symbol ?? ''}
                    </td>
                    <td className="align-right">{formatMoney(l.valuation_amount)}</td>
                    {charges.map((c) => {
                      const share = preview.byCharge[c.key]?.[l.line_id]
                      return (
                        <td key={c.key} className="qty-cell">
                          <input
                            className="input"
                            inputMode="decimal"
                            disabled={disabled || chargeAmount(c) <= 0}
                            aria-label={`${COST_TYPE_LABELS[c.cost_type]} on ${l.label}`}
                            value={c.lines[l.line_id] ?? (share !== undefined ? String(share) : '')}
                            onChange={(e) => overrideLine(c, l.line_id, e.target.value)}
                          />
                        </td>
                      )
                    })}
                    <td className="align-right">{added > 0 ? <strong>{formatMoney(added)}</strong> : <span className="muted">—</span>}</td>
                    <td className="align-right">{formatMoney(newValue)}</td>
                    <td className="align-right">{l.base_qty > 0 ? formatMoney(Math.round((newValue / l.base_qty) * 10000) / 10000) : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="align-right muted">
                  Allocated
                </td>
                {charges.map((c) => (
                  <td key={c.key} className="align-right">
                    {formatMoney(Object.values(preview.byCharge[c.key] ?? {}).reduce((a, b) => a + b, 0))}
                  </td>
                ))}
                <td className="align-right">
                  <strong>{formatMoney(totalAllocated)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          {Math.abs(unallocated) > 0.005 ? (
            <Notice kind="warning">
              {formatMoney(unallocated)} of the charges is not spread over any line. Check the basis or the per-line shares — a charge that is not allocated is a cost that never
              reaches stock value.
            </Notice>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
