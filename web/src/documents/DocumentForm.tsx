import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccess } from '../access/AccessContext'
import { FormField } from '../components/FormField'
import { Notice } from '../components/Notice'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { lookupApi } from '../services/lookupApi'
import type { AvailabilityCheckLine } from '../services/stockApi'
import { formatQty, todayIso, toNumber } from '../utils/format'
import { LineEditor, unitOptionsFrom } from './LineEditor'
import { PartyFields } from './PartyFields'
import { WarehouseSelect } from './WarehouseSelect'
import { canCreate, permissionKeysFor } from './actions'
import { countDifference, draftTotals, isBlankLine, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from './formModel'
import type { HeaderDraft, LineDraft, LineOrigin } from './formModel'
import { offendingDraftKeys, parseNegativeStock } from './negativeStock'
import type { NegativeStockDetail } from './negativeStock'
import { DeferredPurchasePanel } from './panels/DeferredPurchasePanel'
import { PhysicalCountPanel } from './panels/PhysicalCountPanel'
import { ProductionPanel } from './panels/ProductionPanel'
import { SettlementsPanel } from './panels/SettlementsPanel'
import type { DocumentTypeSpec } from './registry'
import type { InventoryDocument, JobWorkSettlement, PostingWarning } from './types'
import { useAvailability } from './useAvailability'
import type { AvailabilityEntry } from './useAvailability'
import { useReferenceData } from './useReferenceData'

export interface DocumentFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

/**
 * Create / edit any native document. The header and line columns follow the type spec; the
 * production, job-work, deferred-purchase and count panels generate lines that stay editable.
 *
 * Saving always creates or updates the draft first and posts second, so a negative-stock block
 * on posting leaves a saved draft (status FAILED) that can be posted with an override.
 */
export function DocumentForm({ spec, documentId, initial, onSaved }: DocumentFormProps) {
  const { warehouses, defaultWarehouseId, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? (spec.formKind === 'physical_count' || spec.formKind === 'production' ? [] : [newLine(spec)]))
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)

  // Pre-fill the default warehouse once reference data is known (new documents only).
  useEffect(() => {
    if (!documentId && header.default_warehouse_id === null && defaultWarehouseId !== null && spec.lineMode !== 'transfer') {
      setHeader((h) => ({ ...h, default_warehouse_id: defaultWarehouseId }))
      setLines((ls) => ls.map((l) => (l.warehouse_id === null && l.origin === 'manual' ? { ...l, warehouse_id: defaultWarehouseId } : l)))
    }
  }, [defaultWarehouseId, documentId, header.default_warehouse_id, spec.lineMode])

  // Editing: stored lines only know their own unit; fetch the items once so the unit dropdown,
  // batch picker and serial picker work exactly as they do on a new document.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!initial || hydrated.current) return undefined
    hydrated.current = true
    const ids = [...new Set(initial.lines.map((l) => l.item_id).filter((id): id is number => id !== null))]
    if (ids.length === 0) return undefined
    const controller = new AbortController()
    lookupApi
      .itemsByIds(ids, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const byId = new Map(items.map((it) => [it.item_id, it]))
        setLines((ls) =>
          ls.map((l) => {
            const it = l.item_id !== null ? byId.get(l.item_id) : undefined
            if (!it) return l
            const units = unitOptionsFrom(it)
            return {
              ...l,
              item_sku: l.item_sku ?? it.item_sku,
              track_batch: l.track_batch || Number(it.track_batch) === 1,
              track_serial: l.track_serial || Number(it.track_serial) === 1,
              units: units.length > l.units.length ? units : l.units,
            }
          }),
        )
      })
      .catch(() => {
        /* the stored unit still works; pickers just stay minimal */
      })
    return () => controller.abort()
  }, [initial])

  const patchHeader = (patch: Partial<HeaderDraft>) => setHeader((h) => ({ ...h, ...patch }))
  const replaceOrigin = (origins: LineOrigin[], generated: LineDraft[], keepManual = true) =>
    setLines((ls) => [...(keepManual ? ls.filter((l) => !origins.includes(l.origin) && !isBlankLine(l)) : []), ...generated])

  const partyRef = toNumber(header.party_ref)
  const partyRefNum = partyRef !== null && partyRef > 0 ? Math.floor(partyRef) : null

  const entries = useMemo<AvailabilityEntry[]>(() => {
    const out: AvailabilityEntry[] = []
    for (const l of lines) {
      if (!l.item_id) continue
      let qty = lineBaseQty(l)
      let dir: 'in' | 'out' | null = l.direction
      let warehouse = l.warehouse_id ?? header.default_warehouse_id
      if (spec.formKind === 'physical_count') {
        const d = countDifference(l.book_qty, l.physical_qty)
        if (d === null || d >= 0) continue
        qty = Math.abs(d)
        dir = 'out'
      } else if (spec.lineMode === 'transfer') {
        dir = 'out'
        warehouse = l.from_warehouse_id ?? header.from_warehouse_id
      } else if (['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind)) {
        dir = 'out'
      }
      if (dir !== 'out' || qty <= 0) continue
      const line: AvailabilityCheckLine = { item_id: l.item_id, warehouse_id: warehouse ?? null, batch_id: l.batch_id, qty }
      out.push({ key: l.key, line })
    }
    return out
  }, [lines, header.default_warehouse_id, header.from_warehouse_id, spec])
  const { results: availability, checking } = useAvailability(entries, spec.movesStock || ['job_work_out', 'packing', 'delivery_challan'].includes(spec.formKind))

  const offending = useMemo(() => new Set(negative ? offendingDraftKeys(lines, negative) : []), [negative, lines])
  const savedSettlements = useMemo(() => (header.metadata.job_work_settlements ?? []) as JobWorkSettlement[], [header.metadata.job_work_settlements])
  const totals = draftTotals(lines, spec)

  const submit = async (post: boolean) => {
    setErrors([])
    setApiError(null)
    setWarnings([])
    if (!post) setNegative(null)
    const errs = validateDraft(header, lines, spec)
    if (errs.length) {
      setErrors(errs)
      return
    }
    const payload = toPayload(header, lines, spec)
    setBusy(post ? 'post' : 'save')
    let id = savedId
    try {
      let doc: InventoryDocument
      if (id) {
        doc = await documentsApi.update(id, payload)
      } else {
        doc = await documentsApi.create(payload)
        id = doc.document_id
        setSavedId(id)
      }
      if (post) {
        doc = await documentsApi.post(doc.document_id, { negativeOverride: override && canOverride })
        setWarnings(doc.warnings ?? [])
      }
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        setApiError(describeError(err))
      }
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null
  const isTransfer = spec.lineMode === 'transfer'
  const stockEffectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint

  return (
    <form
      className="page"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      {refError ? <Notice kind="warning">{refError}</Notice> : null}
      <section className="form-section">
        <h2 className="form-section-title">{spec.label}</h2>
        <p className="form-section-subtitle">{spec.description}</p>
        <div className="form-grid">
          <FormField label="Document date" htmlFor="document_date" required>
            <input id="document_date" type="date" className="input" value={header.document_date} disabled={disabled} onChange={(e) => patchHeader({ document_date: e.target.value })} />
          </FormField>
          <FormField label="Document no." htmlFor="document_no" help="Leave empty to number automatically.">
            <input id="document_no" className="input" value={header.document_no} disabled={disabled} onChange={(e) => patchHeader({ document_no: e.target.value })} />
          </FormField>
          {spec.party ? <PartyFields role={spec.party} partyRef={header.party_ref} partyName={header.party_name} onChange={patchHeader} disabled={disabled} /> : null}
          {isTransfer ? (
            <>
              <FormField label="From warehouse" htmlFor="from_wh" required>
                <WarehouseSelect id="from_wh" value={header.from_warehouse_id} onChange={(id) => patchHeader({ from_warehouse_id: id })} warehouses={warehouses} disabled={disabled} />
              </FormField>
              <FormField label="To warehouse" htmlFor="to_wh" required>
                <WarehouseSelect id="to_wh" value={header.to_warehouse_id} onChange={(id) => patchHeader({ to_warehouse_id: id })} warehouses={warehouses} disabled={disabled} />
              </FormField>
            </>
          ) : spec.formKind !== 'production' ? (
            <FormField label="Default warehouse" htmlFor="default_wh" help="Pre-fills the warehouse on new lines.">
              <WarehouseSelect id="default_wh" value={header.default_warehouse_id} onChange={(id) => patchHeader({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="None" disabled={disabled} />
            </FormField>
          ) : null}
          {spec.stockEffects.length > 0 ? (
            <FormField label="Stock effect" htmlFor="stock_effect" help={stockEffectHint}>
              <select id="stock_effect" className="select" value={header.stock_effect} disabled={disabled} onChange={(e) => patchHeader({ stock_effect: e.target.value, metadata: { ...header.metadata, linked_source_document_id: undefined } })}>
                {spec.stockEffects.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          {spec.returnable ? (
            <>
              <FormField label="Returnable" htmlFor="returnable">
                <label className="checkbox" style={{ minHeight: '2.25rem' }}>
                  <input id="returnable" type="checkbox" checked={header.returnable} disabled={disabled} onChange={(e) => patchHeader({ returnable: e.target.checked })} />
                  Goods are expected back
                </label>
              </FormField>
              {header.returnable ? (
                <FormField label="Expected return" htmlFor="expected_return_date">
                  <input id="expected_return_date" type="date" className="input" value={header.expected_return_date} disabled={disabled} onChange={(e) => patchHeader({ expected_return_date: e.target.value })} />
                </FormField>
              ) : null}
            </>
          ) : null}
          {spec.reason ? (
            <>
              <FormField label="Reason code" htmlFor="reason_code">
                <input id="reason_code" className="input" value={header.reason_code} disabled={disabled} maxLength={32} onChange={(e) => patchHeader({ reason_code: e.target.value })} placeholder="e.g. DAMAGE" />
              </FormField>
              <FormField label="Movement reason" htmlFor="movement_reason">
                <input id="movement_reason" className="input" value={header.movement_reason} disabled={disabled} maxLength={64} onChange={(e) => patchHeader({ movement_reason: e.target.value })} />
              </FormField>
            </>
          ) : null}
          {spec.formKind === 'packing' ? (
            <FormField label="Box marks" htmlFor="box_marks" help="One per line.">
              <textarea id="box_marks" className="textarea" value={(header.metadata.box_marks ?? []).join('\n')} disabled={disabled} onChange={(e) => patchHeader({ metadata: { ...header.metadata, box_marks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } })} />
            </FormField>
          ) : null}
          <FormField label="Narration" htmlFor="narration" className="span-all">
            <textarea id="narration" className="textarea" value={header.narration} disabled={disabled} onChange={(e) => patchHeader({ narration: e.target.value })} />
          </FormField>
        </div>
      </section>

      {spec.formKind === 'production' ? (
        <ProductionPanel
          spec={spec}
          warehouses={warehouses}
          defaultWarehouseId={defaultWarehouseId}
          initial={header.metadata}
          disabled={disabled}
          onExplode={(generated, meta) => {
            replaceOrigin(['bom'], generated)
            patchHeader({ metadata: { ...header.metadata, ...meta }, default_warehouse_id: meta.warehouse_id })
          }}
        />
      ) : null}
      {spec.formKind === 'job_work_in' ? (
        <SettlementsPanel
          spec={spec}
          partyRef={partyRefNum}
          value={savedSettlements}
          disabled={disabled}
          onChange={(settlements, consumed, detectedParty) => {
            replaceOrigin(['settlement'], consumed)
            patchHeader({ metadata: { ...header.metadata, job_work_settlements: settlements }, ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}) })
          }}
        />
      ) : null}
      {spec.formKind === 'inward_challan' && header.stock_effect === 'settle_deferred' ? (
        <DeferredPurchasePanel
          spec={spec}
          partyRef={partyRefNum}
          linkedSourceDocumentId={header.metadata.linked_source_document_id ? Number(header.metadata.linked_source_document_id) : null}
          disabled={disabled}
          onChange={(docId, generated, detectedParty) => {
            replaceOrigin(['deferred'], generated)
            patchHeader({ metadata: { ...header.metadata, linked_source_document_id: docId ?? undefined }, ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}) })
          }}
        />
      ) : null}
      {spec.formKind === 'physical_count' ? <PhysicalCountPanel spec={spec} warehouses={warehouses} defaultWarehouseId={defaultWarehouseId} disabled={disabled} onLoad={(generated) => replaceOrigin(['count', 'manual'], generated, false)} /> : null}

      <section className="form-section">
        <h2 className="form-section-title">Lines</h2>
        {spec.formKind === 'revaluation' ? <p className="form-section-subtitle">Quantity is informational; the new unit cost re-prices every layer still holding the item in that warehouse.</p> : null}
        {spec.formKind === 'landed_cost' ? <p className="form-section-subtitle">Enter the received item, the quantity it covers and the landing cost to allocate as the amount.</p> : null}
        {refLoading && warehouses.length === 0 ? <span className="hint">Loading warehouses…</span> : null}
        <LineEditor spec={spec} header={header} lines={lines} onChange={setLines} warehouses={warehouses} availability={availability} checking={checking} offendingKeys={offending} disabled={disabled} />
      </section>

      {errors.length > 0 ? (
        <Notice kind="error" title="Please fix before saving">
          <ul className="warning-list">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {apiError && !negative ? <Notice kind="error">{apiError}</Notice> : null}
      {negative ? (
        <Notice kind="error" title="Insufficient stock">
          {apiError ? <div>{apiError}</div> : null}
          <ul className="warning-list">
            {negative.map((d, i) => (
              <li key={`${d.item_id}-${d.warehouse_id}-${i}`}>
                {d.item_name ?? `Item #${d.item_id}`}
                {d.warehouse_id ? ` · warehouse #${d.warehouse_id}` : ''}: on hand {formatQty(d.on_hand)}, required {formatQty(d.required)}, short by <strong>{formatQty(d.short_by)}</strong>
              </li>
            ))}
          </ul>
          {canOverride ? (
            <label className="checkbox" style={{ marginTop: '0.5rem' }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Post anyway and let stock go negative (override)
            </label>
          ) : (
            <div className="hint">Reduce the quantities or receive stock first. Posting into negative stock needs the "override negative-stock block" permission.</div>
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

      <div className="form-actions">
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          {totals.lines} line{totals.lines === 1 ? '' : 's'}
          {savedId ? ` · draft #${savedId}` : ''}
        </span>
        <span className="spacer" />
        <Link className="btn" to={savedId ? `/documents/${savedId}` : '/documents'}>
          Cancel
        </Link>
        <button type="submit" className="btn" disabled={disabled || !canSave}>
          {busy === 'save' ? 'Saving…' : savedId ? 'Save changes' : 'Save draft'}
        </button>
        {canPost ? (
          <button type="button" className="btn btn-primary" onClick={() => void submit(true)} disabled={disabled || (!canSave && !savedId)}>
            {busy === 'post' ? 'Posting…' : negative && override ? 'Post with override' : 'Save & post'}
          </button>
        ) : null}
      </div>
    </form>
  )
}
