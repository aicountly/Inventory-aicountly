import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FilePlus2, Keyboard, Save, Send } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAccess } from '../access/AccessContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FormField } from '../components/FormField'
import { Notice } from '../components/Notice'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { errorMessage, isApiError } from '../services/api'
import { documentsApi } from '../services/documentsApi'
import { lookupApi } from '../services/lookupApi'
import type { AvailabilityCheckLine } from '../services/stockApi'
import { Badge } from '../ui/Badge'
import type { BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useToast } from '../ui/ToastContext'
import { BreadcrumbHeader } from '../ui/shell/BreadcrumbHeader'
import { FormField as ShellFormField, FormSectionCard } from '../ui/shell/FormSectionCard'
import { ActionBarTotal, StickyActionBar } from '../ui/shell/StickyActionBar'
import { formatMoney, formatQty, todayIso, toNumber } from '../utils/format'
import { InventoryAssistantPanel } from './InventoryAssistantPanel'
import { LineEditor, unitOptionsFrom } from './LineEditor'
import { LineToolbar } from './LineToolbar'
import { PartyFields } from './PartyFields'
import { WarehouseSelect } from './WarehouseSelect'
import { STATUS_LABELS, canCreate, permissionKeysFor, statusTone } from './actions'
import { countDifference, draftTotals, isBlankLine, lineAmount, lineBaseQty, newHeader, newLine, toPayload, validateDraft } from './formModel'
import type { HeaderDraft, LineDraft, LineOrigin } from './formModel'
import { computeCostConfidence } from './lineFormInsights'
import { offendingDraftKeys, parseNegativeStock } from './negativeStock'
import type { NegativeStockDetail } from './negativeStock'
import { DeferredPurchasePanel } from './panels/DeferredPurchasePanel'
import { LandedCostPanel } from './panels/LandedCostPanel'
import { PhysicalCountPanel } from './panels/PhysicalCountPanel'
import { ProductionPanel } from './panels/ProductionPanel'
import { SettlementsPanel } from './panels/SettlementsPanel'
import type { DocumentTypeSpec, FormKind, LineMode } from './registry'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StockFormMetrics } from './StockFormMetrics'
import type { DocumentStatus, InventoryDocument, JobWorkSettlement, PostingWarning } from './types'
import { useAvailability } from './useAvailability'
import type { AvailabilityEntry } from './useAvailability'
import { useDocumentFormKeyboard } from './useDocumentFormKeyboard'
import { useReferenceCosts } from './useReferenceCosts'
import { useReferenceData } from './useReferenceData'

export interface DocumentFormProps {
  spec: DocumentTypeSpec
  /** Editing an existing draft. */
  documentId?: number
  documentStatus?: DocumentStatus
  documentVersion?: number
  initial?: { header: HeaderDraft; lines: LineDraft[] }
  /** Rendered inside the page's own gap rhythm, above the metrics — e.g. "editing returns this to draft". */
  topNotice?: ReactNode
  onSaved: (doc: InventoryDocument, posted: boolean) => void
}

function describeError(err: unknown): string {
  if (isApiError(err)) {
    const field = err.field
    return field ? `${err.message} (${field})` : err.message
  }
  return errorMessage(err)
}

const HERO_ICON: Partial<Record<FormKind, LucideIcon>> = { lines: FilePlus2 }

const ASIDE_TAGLINE: Partial<Record<LineMode, string>> = {
  fixed_in: 'Bring verified stock in with confidence.',
  fixed_out: 'Take stock out with a clean audit trail.',
  by_line: 'Adjust stock precisely, line by line.',
  transfer: 'Move stock between warehouses seamlessly.',
}

/** What the unsaved-changes guard diffs against — deliberately excludes derived / UI-only fields (units hydrated after load, the default-warehouse prefill) so those never trip a false "leave this page?" prompt. */
function headerSignature(h: HeaderDraft): string {
  return [h.document_date, h.document_no, h.party_ref, h.party_name, h.from_warehouse_id, h.to_warehouse_id, h.stock_effect, h.returnable, h.expected_return_date, h.reason_code, h.movement_reason, h.narration].join('|')
}
function lineSignature(l: LineDraft): string {
  return [l.item_id, l.warehouse_id, l.from_warehouse_id, l.batch_id, l.direction, l.qty, l.rate, l.amount, l.valuation_rate, l.book_qty, l.physical_qty, l.serials.map((s) => s.serial_id).join(','), l.description].join('|')
}
function activeLinesSignature(lines: LineDraft[]): string {
  return lines
    .filter((l) => !isBlankLine(l))
    .map(lineSignature)
    .join(';')
}

/**
 * Create / edit any native document. The header and line columns follow the type spec; the
 * production, job-work, deferred-purchase and count panels generate lines that stay editable.
 *
 * "lines"-form types (opening stock, stock journal, write-off, write-in, consumption, material
 * issue / receipt, assembly, disassembly, batch / serial adjustment) get the full premium
 * workspace — metrics, the AI assistant panel, fast entry tools. Every other type keeps its
 * existing header fields and panels exactly as they were; only the sticky action bar, the
 * unsaved-changes guard and the hero are shared by all of them.
 *
 * Saving always creates or updates the draft first and posts second, so a negative-stock block
 * on posting leaves a saved draft (status FAILED) that can be posted with an override.
 */
export function DocumentForm({ spec, documentId, documentStatus, documentVersion, initial, topNotice, onSaved }: DocumentFormProps) {
  const { warehouses, defaultWarehouseId, warehouseName, loading: refLoading, error: refError } = useReferenceData()
  const { can } = useAccess()
  const toast = useToast()
  const [header, setHeader] = useState<HeaderDraft>(() => initial?.header ?? newHeader(spec, todayIso()))
  const [lines, setLines] = useState<LineDraft[]>(() => initial?.lines ?? (['physical_count', 'production', 'landed_cost'].includes(spec.formKind) ? [] : [newLine(spec)]))
  const [savedId, setSavedId] = useState<number | null>(documentId ?? null)
  const [errors, setErrors] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [negative, setNegative] = useState<NegativeStockDetail[] | null>(null)
  const [override, setOverride] = useState(false)
  const [warnings, setWarnings] = useState<PostingWarning[]>([])
  const [busy, setBusy] = useState<'save' | 'post' | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [autoNumber, setAutoNumber] = useState(() => !documentId && (initial?.header.document_no ?? '').trim() === '')
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const linesWrapRef = useRef<HTMLDivElement>(null)

  const canOverride = can('stock.negative_override')
  const canPost = can(permissionKeysFor('post', spec.code))
  const canSave = savedId ? can(permissionKeysFor('edit', spec.code)) : canCreate(spec.code, can)
  const isEditing = documentId !== undefined
  const isLinesForm = spec.formKind === 'lines'

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

  // ---- costing (AI assistant + metrics) --------------------------------------------------
  const itemIds = useMemo(() => [...new Set(lines.map((l) => l.item_id).filter((id): id is number => id !== null))], [lines])
  const refCosts = useReferenceCosts(itemIds, header.default_warehouse_id, isLinesForm && spec.valuation)
  const costConfidence = useMemo(() => computeCostConfidence(spec, lines, refCosts.costs), [spec, lines, refCosts.costs])
  const applyReferenceCost = () => {
    setLines((ls) =>
      ls.map((l) => {
        if (!l.item_id || (toNumber(l.rate) ?? 0) > 0) return l
        const ref = refCosts.costs.get(l.item_id)
        if (!ref || ref <= 0) return l
        return { ...l, rate: String(ref), amount: String(lineAmount(l.qty, ref) ?? '') }
      }),
    )
  }

  // ---- unsaved-changes guard --------------------------------------------------------------
  const baselineRef = useRef({ header: headerSignature(header), lines: activeLinesSignature(lines) })
  const isDirty = busy === null && (headerSignature(header) !== baselineRef.current.header || activeLinesSignature(lines) !== baselineRef.current.lines)
  useUnsavedChanges({ when: isDirty, onBlocked: (_to, proceed) => setPendingNav(() => proceed) })

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
    const hadExisting = savedId !== null
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
      toast.success(post ? 'Document posted successfully.' : hadExisting ? 'Changes saved.' : 'Draft saved.')
      onSaved(doc, post)
    } catch (err) {
      const neg = parseNegativeStock(err)
      if (neg) {
        setNegative(neg)
        setApiError(id ? `Draft #${id} is saved but could not be posted: ${errorMessage(err)}` : errorMessage(err))
      } else {
        const message = describeError(err)
        setApiError(message)
        toast.error(message)
      }
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null
  const isTransfer = spec.lineMode === 'transfer'
  const stockEffectHint = spec.stockEffects.find((s) => s.value === header.stock_effect)?.hint

  useDocumentFormKeyboard({
    enabled: !disabled,
    onSaveDraft: canSave ? () => void submit(false) : undefined,
    onSavePost: canPost && (canSave || !!savedId) ? () => void submit(true) : undefined,
    onAddLine: isLinesForm ? () => setLines((ls) => [...ls, newLine(spec, { warehouse_id: header.default_warehouse_id })]) : undefined,
    onSearchItems: isLinesForm ? () => linesWrapRef.current?.querySelector<HTMLInputElement>('.typeahead input')?.focus() : undefined,
  })

  // ---- hero -------------------------------------------------------------------------------
  const status: DocumentStatus = documentStatus ?? 'DRAFT'
  const heroIcon = HERO_ICON[spec.formKind] ?? FilePlus2
  const tagline = ASIDE_TAGLINE[spec.lineMode] ?? 'Simple. Accurate. Always in control.'
  const chips: { label: string; tone: BadgeTone }[] = [{ label: STATUS_LABELS[status] ?? status, tone: statusTone(status) as BadgeTone }]
  if (!isEditing && header.document_no.trim() === '') chips.push({ label: 'Auto Numbering', tone: 'success' })
  if (header.default_warehouse_id) chips.push({ label: `Warehouse: ${warehouseName(header.default_warehouse_id)}`, tone: 'neutral' })
  if (spec.valuation) chips.push({ label: 'Cost Review', tone: 'info' })

  const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')
  const saveKbd = mac ? '⌘S' : 'Ctrl+S'
  const postKbd = mac ? '⌘⏎' : 'Ctrl+Enter'

  // ---- sections -----------------------------------------------------------------------------
  // Built as plain JSX values, not nested render functions, so the two layouts below (the 2-col
  // "lines" workspace vs. every other type's single column) can compose the same section content
  // without an extra wrapper div breaking the .page flex gap that spaces them.
  const documentDetailsSection = isLinesForm ? (
    <FormSectionCard
      icon={heroIcon}
      title="Document Details"
      description={`Basic information for this ${spec.label.toLowerCase()} entry.`}
      action={
        !isEditing ? (
          <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
            Auto number on save
            <input
              type="checkbox"
              className="accent-primary"
              checked={autoNumber}
              disabled={disabled}
              onChange={(e) => {
                const on = e.target.checked
                setAutoNumber(on)
                if (on) patchHeader({ document_no: '' })
              }}
            />
          </label>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <ShellFormField label="Document date" htmlFor="document_date" required>
          <input id="document_date" type="date" className="input" value={header.document_date} disabled={disabled} onChange={(e) => patchHeader({ document_date: e.target.value })} />
        </ShellFormField>
        <ShellFormField label="Document no." htmlFor="document_no" hint={autoNumber ? 'Leave empty to number automatically.' : 'Custom document number.'}>
          <input
            id="document_no"
            className="input"
            value={header.document_no}
            placeholder={autoNumber ? 'Auto-generated on save' : undefined}
            disabled={disabled || autoNumber}
            onChange={(e) => patchHeader({ document_no: e.target.value })}
          />
        </ShellFormField>
        <ShellFormField label="Default warehouse" htmlFor="default_wh" hint="Pre-fills the warehouse on new lines.">
          <WarehouseSelect id="default_wh" value={header.default_warehouse_id} onChange={(id) => patchHeader({ default_warehouse_id: id })} warehouses={warehouses} emptyLabel="None" disabled={disabled} />
        </ShellFormField>
        {spec.reason ? (
          <>
            <ShellFormField label="Reason code" htmlFor="reason_code">
              <input id="reason_code" className="input" value={header.reason_code} disabled={disabled} maxLength={32} onChange={(e) => patchHeader({ reason_code: e.target.value })} placeholder="e.g. DAMAGE" />
            </ShellFormField>
            <ShellFormField label="Movement reason" htmlFor="movement_reason">
              <input id="movement_reason" className="input" value={header.movement_reason} disabled={disabled} maxLength={64} onChange={(e) => patchHeader({ movement_reason: e.target.value })} />
            </ShellFormField>
          </>
        ) : null}
      </div>
    </FormSectionCard>
  ) : (
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
  )

  const narrationCard = isLinesForm ? (
    <FormSectionCard title="Narration" description="Add a note for reference (optional).">
      <div className="relative">
        <textarea
          id="narration"
          className="textarea pr-14"
          style={{ minHeight: '4.5rem' }}
          value={header.narration}
          disabled={disabled}
          maxLength={500}
          placeholder="e.g. Stock found during physical verification in warehouse."
          onChange={(e) => patchHeader({ narration: e.target.value })}
        />
        <span className="absolute bottom-2 right-2.5 text-[10px] text-gray-400 tabular-nums">{header.narration.length}/500</span>
      </div>
    </FormSectionCard>
  ) : null

  const panelsSection = (
    <>
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
      {spec.formKind === 'landed_cost' ? (
        <LandedCostPanel
          initial={header.metadata}
          disabled={disabled}
          onChange={(targetId, charges, detectedParty) =>
            patchHeader({
              metadata: { ...header.metadata, target_document_id: targetId ?? undefined, charges },
              ...(header.party_ref === '' && detectedParty ? { party_ref: String(detectedParty) } : {}),
            })
          }
        />
      ) : null}
    </>
  )

  // A landed cost allocation has no item lines: a freight bill names no item and no quantity.
  // What it carries is the receipt it loads and the charges, which the panel above collects.
  const linesSection =
    spec.formKind === 'landed_cost' ? null : isLinesForm ? (
      <FormSectionCard
        title="Line Items"
        description={`Add items to be ${spec.lineMode === 'fixed_out' ? 'taken out of' : 'written in to'} stock.`}
        action={<LineToolbar spec={spec} warehouseId={header.default_warehouse_id} disabled={disabled} onAppend={(newLines) => setLines((ls) => [...ls, ...newLines])} />}
      >
        {refLoading && warehouses.length === 0 ? <span className="hint">Loading warehouses…</span> : null}
        <div ref={linesWrapRef}>
          <LineEditor spec={spec} header={header} lines={lines} onChange={setLines} warehouses={warehouses} availability={availability} checking={checking} offendingKeys={offending} disabled={disabled} />
        </div>
      </FormSectionCard>
    ) : (
      <section className="form-section">
        <h2 className="form-section-title">Lines</h2>
        {spec.formKind === 'revaluation' ? <p className="form-section-subtitle">Quantity is informational; the new unit cost re-prices every layer still holding the item in that warehouse.</p> : null}
        {refLoading && warehouses.length === 0 ? <span className="hint">Loading warehouses…</span> : null}
        <LineEditor spec={spec} header={header} lines={lines} onChange={setLines} warehouses={warehouses} availability={availability} checking={checking} offendingKeys={offending} disabled={disabled} />
      </section>
    )

  return (
    <>
      <form
        className="page"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(false)
        }}
      >
        <BreadcrumbHeader
          breadcrumbs={[{ label: 'Documents', to: '/documents' }, { label: spec.label }]}
          icon={heroIcon}
          title={isEditing ? `Edit ${spec.label}` : spec.label}
          description={spec.description}
          meta={
            isEditing ? (
              <span className="text-xs text-gray-500">
                {header.document_no || `#${documentId}`}
                {documentVersion ? ` · Version ${documentVersion}` : ''}
              </span>
            ) : undefined
          }
          badge={
            <span className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <Badge key={c.label} tone={c.tone} size="sm">
                  {c.label}
                </Badge>
              ))}
            </span>
          }
          aside={
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-700 leading-snug">{tagline}</p>
              <p className="text-xs text-gray-400 mt-0.5">Simple. Accurate. Always in control.</p>
            </div>
          }
          actions={
            <Button variant="secondary" size="sm" icon={Keyboard} onClick={() => setShowShortcuts(true)}>
              Shortcuts
            </Button>
          }
          escBack={false}
        />

        {topNotice}
        {refError ? <Notice kind="warning">{refError}</Notice> : null}

        {isLinesForm ? <StockFormMetrics spec={spec} totals={totals} reasonCode={header.reason_code.trim()} costConfidence={costConfidence} /> : null}

        {isLinesForm ? (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <div className="min-w-0 flex flex-col gap-4">
              {documentDetailsSection}
              {narrationCard}
              {panelsSection}
              {linesSection}
            </div>
            <InventoryAssistantPanel
              className="xl:sticky xl:top-4"
              spec={spec}
              header={header}
              lines={lines}
              costConfidence={costConfidence}
              referenceCosts={refCosts.costs}
              referenceMethods={refCosts.methods}
              negativeLineKeys={offending}
              onApplyReferenceCost={applyReferenceCost}
              disabled={disabled}
            />
          </div>
        ) : (
          <>
            {documentDetailsSection}
            {panelsSection}
            {linesSection}
          </>
        )}

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

        <StickyActionBar
          totals={
            <>
              <ActionBarTotal label="Lines" value={totals.lines} />
              {spec.rate ? <ActionBarTotal label="Amount" value={`₹ ${formatMoney(totals.amount)}`} /> : null}
              {savedId ? <span className="text-xs text-gray-400">Draft #{savedId}</span> : null}
            </>
          }
        >
          <Link className="btn" to={savedId ? `/documents/${savedId}` : '/documents'}>
            Cancel
          </Link>
          <Button type="submit" variant="outline" icon={Save} loading={busy === 'save'} disabled={disabled || !canSave} kbd={saveKbd}>
            {savedId ? 'Save changes' : 'Save Draft'}
          </Button>
          {canPost ? (
            <Button type="button" variant="primary" icon={Send} loading={busy === 'post'} onClick={() => void submit(true)} disabled={disabled || (!canSave && !savedId)} kbd={postKbd}>
              {negative && override ? 'Post with override' : 'Save & Post'}
            </Button>
          ) : null}
        </StickyActionBar>
      </form>

      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <ConfirmDialog
        open={pendingNav !== null}
        title="Unsaved changes"
        message="You have unsaved changes. Leave this page? Changes will be lost."
        confirmLabel="Leave page"
        danger
        onConfirm={() => {
          const proceed = pendingNav
          setPendingNav(null)
          proceed?.()
        }}
        onCancel={() => setPendingNav(null)}
      />
    </>
  )
}
